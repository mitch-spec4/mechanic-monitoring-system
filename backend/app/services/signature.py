"""Customer sign-off when a job is completed: a drawn signature with the signer's name, or the
reason nobody could sign. Sent with the request that completes the job, so a refused
completion stores nothing."""
import base64
import binascii
import uuid

from app import db
from app.models.media import JobFile
from app.services.storage import storage
from app.services.worksheet import record_event
from app.utils.time import utcnow
from app.utils.validation import ValidationError, text

SIGNATURE_FIELDS = {"signature", "no_signature_reason"}
SIGNATURE_PROBLEM = "Get the customer's signature, or record why they couldn't sign"
MAX_SIGNATURE_BYTES = 512 * 1024
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def read_signature(data):
    """Validate the sign-off sent with a completion. None when there is none."""
    signature = data.get("signature")
    if signature is not None:
        if not isinstance(signature, dict):
            raise ValidationError("Signature must include a name and an image")
        name = text(signature, "name", "Signer's name", required=True, max_length=120)
        image = signature.get("image")
        if not isinstance(image, str) or not image.startswith("data:image/png;base64,"):
            raise ValidationError("Signature image must be a PNG")
        try:
            png = base64.b64decode(image.split(",", 1)[1], validate=True)
        except (binascii.Error, ValueError):
            raise ValidationError("Signature image is not valid") from None
        if not png.startswith(PNG_MAGIC) or len(png) > MAX_SIGNATURE_BYTES:
            raise ValidationError("Signature image is not valid")
        return {"name": name, "png": png}
    reason = text(data, "no_signature_reason", "Reason", max_length=500)
    return {"reason": reason} if reason else None


def apply_signature(job, user, sign_off):
    if "png" in sign_off:
        key = f"{job.company_id}/jobs/{job.id}/signature-{uuid.uuid4().hex}.png"
        storage().put(key, sign_off["png"], "image/png")
        db.session.add(
            JobFile(
                company_id=job.company_id,
                job_id=job.id,
                uploaded_by=user.id,
                kind="signature",
                content_type="image/png",
                size_bytes=len(sign_off["png"]),
                storage_key=key,
                original_name="signature.png",
                status="ready",
            )
        )
        job.signed_by_name = sign_off["name"]
        job.signed_at = utcnow()
        job.no_signature_reason = None
        record_event(job, user, "signed", note=f"Signed by {sign_off['name']}")
    else:
        job.no_signature_reason = sign_off["reason"]
        job.signed_by_name = None
        job.signed_at = None
        record_event(job, user, "not_signed", note=sign_off["reason"])
