"""Photos and videos on a job's worksheet, and serving every job file after an access check."""
import uuid

from flask import Blueprint, Response, current_app, jsonify, redirect, request, send_file

from app import db
from app.models.media import JobFile
from app.routes.worksheet import job_detail, load_job
from app.services.billing import check_storage
from app.services.report_pdf import build_report
from app.services.storage import StorageError, read_upload_token, storage
from app.services.worksheet import record_event
from app.utils.auth import current_user, roles
from app.utils.validation import ValidationError, choice, integer, json_body, text

bp = Blueprint("media", __name__)

PHOTO_KINDS = ("before", "after", "other")
UPLOAD_KINDS = PHOTO_KINDS + ("video",)
PHOTO_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
VIDEO_TYPES = {"video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "video/3gpp": ".3gp"}
UPLOAD_STATUSES = ("In Progress", "Paused")
KIND_LABEL = {"before": "before photo", "after": "after photo", "other": "photo", "video": "video"}


def max_bytes(kind):
    megabytes = current_app.config["MAX_VIDEO_MB"] if kind == "video" else current_app.config["MAX_PHOTO_MB"]
    return megabytes * 1024 * 1024


def media_limits():
    config = current_app.config
    return {"photo_mb": config["MAX_PHOTO_MB"], "video_mb": config["MAX_VIDEO_MB"], "video_seconds": config["MAX_VIDEO_SECONDS"]}


def new_key(job, extension):
    return f"{job.company_id}/jobs/{job.id}/{uuid.uuid4().hex}{extension}"


def uploadable_job(jid):
    """Only the assigned mechanic adds media, and only while work is under way."""
    job = load_job(jid)
    if job.status not in UPLOAD_STATUSES:
        raise ValidationError("Add photos and videos while the job is in progress or paused.", 409)
    return job


@bp.post("/jobs/<int:jid>/files")
@roles("mechanic")
def request_upload(jid):
    """Step 1: reserve a file and get where to upload it (the bucket, or this app)."""
    user = current_user()
    job = uploadable_job(jid)
    data = json_body()
    kind = choice(data, "kind", UPLOAD_KINDS, "Kind")
    if not kind:
        raise ValidationError("Kind is required")
    content_type = text(data, "content_type", "File type", required=True, max_length=80).lower()
    allowed = VIDEO_TYPES if kind == "video" else PHOTO_TYPES
    if content_type not in allowed:
        raise ValidationError(f"Unsupported file type for a {KIND_LABEL[kind]}: {content_type}", 415)
    size = integer(data, "size", "Size", required=True, minimum=1)
    limit = max_bytes(kind)
    if size > limit:
        raise ValidationError(f"This {KIND_LABEL[kind]} is too large; the limit is {limit // (1024 * 1024)} MB.", 413)
    check_storage(job.company_id, size)
    record = JobFile(
        company_id=job.company_id,
        job_id=job.id,
        uploaded_by=user.id,
        kind=kind,
        content_type=content_type,
        size_bytes=size,
        storage_key=new_key(job, allowed[content_type]),
        original_name=text(data, "name", "Name", max_length=200),
    )
    db.session.add(record)
    db.session.flush()
    target = storage().upload_target(record.storage_key, content_type, size, limit, record.id)
    db.session.commit()
    return jsonify(file_id=record.id, upload=target), 201


@bp.put("/files/upload/<token>")
def local_upload(token):
    """Step 2 in local mode: the signed token in the URL stands in for the bucket's signed link."""
    try:
        claims = read_upload_token(token)
    except StorageError as error:
        raise ValidationError(str(error), 403) from None
    record = db.session.get(JobFile, claims["file"])
    if not record or record.status != "pending" or record.storage_key != claims["key"]:
        raise ValidationError("Upload not found", 404)
    if (request.content_length or 0) > claims["max"]:
        raise ValidationError("File is too large", 413)
    try:
        storage().save_stream(record.storage_key, request.stream, claims["max"])
    except StorageError as error:
        raise ValidationError(str(error), 413) from None
    return "", 204


@bp.post("/files/<int:fid>/confirm")
@roles("mechanic")
def confirm_upload(fid):
    """Step 3: check the upload arrived and is within limits, then show it on the job."""
    user = current_user()
    record = JobFile.query.filter_by(id=fid, uploaded_by=user.id, company_id=user.company_id).first_or_404()
    job = uploadable_job(record.job_id)
    if record.status == "ready":
        return jsonify(job=job_detail(job, user))
    size = storage().size(record.storage_key)
    if not size:
        raise ValidationError("The upload didn't arrive. Please try again.", 409)
    if size > max_bytes(record.kind):
        storage().delete(record.storage_key)
        db.session.delete(record)
        db.session.commit()
        raise ValidationError("The file is larger than the limit", 413)
    try:
        # Checked again here: uploads started together all passed the check when they were reserved.
        check_storage(record.company_id, size, lock=True)
    except ValidationError:
        storage().delete(record.storage_key)
        db.session.delete(record)
        db.session.commit()
        raise
    record.size_bytes = size
    record.status = "ready"
    record_event(job, user, "file_added", note=f"Added a {KIND_LABEL[record.kind]}")
    db.session.commit()
    return jsonify(job=job_detail(job, user))


@bp.delete("/files/<int:fid>")
@roles("mechanic")
def delete_file(fid):
    user = current_user()
    record = JobFile.query.filter_by(id=fid, uploaded_by=user.id, company_id=user.company_id).first_or_404()
    if record.kind == "signature":
        raise ValidationError("Signatures can't be deleted", 409)
    job = uploadable_job(record.job_id)
    if record.status == "ready":
        record_event(job, user, "file_removed", note=f"Removed a {KIND_LABEL[record.kind]}")
    storage().delete(record.storage_key)
    db.session.delete(record)
    db.session.commit()
    return jsonify(job=job_detail(job, user))


@bp.get("/files/<int:fid>")
@roles("boss", "mechanic", "customer")
def get_file(fid):
    """Hand out a file only to someone who can see its job (company and role checked by load_job)."""
    user = current_user()
    record = JobFile.query.filter_by(id=fid, company_id=user.company_id, status="ready").first_or_404()
    load_job(record.job_id)
    attachment = request.args.get("download") == "1"
    name = record.original_name or f"{record.kind}-{record.id}"
    url = storage().download_url(record.storage_key, name, record.content_type, attachment)
    if url:
        return redirect(url, code=302)
    path = storage().local_path(record.storage_key)
    if not path.is_file():
        raise ValidationError("This file is no longer available", 404)
    response = send_file(
        path,
        mimetype=record.content_type,
        as_attachment=attachment,
        download_name=name,
        conditional=True,
    )
    response.headers["Cache-Control"] = "private, max-age=300"
    # Uploaded bytes are never treated as a page on this site, whatever they contain.
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'"
    return response


@bp.get("/jobs/<int:jid>/report.pdf")
@roles("boss", "mechanic", "customer")
def job_report(jid):
    """The customer-facing PDF report of a completed job."""
    job = load_job(jid)
    if job.status != "Completed":
        raise ValidationError("The report is available once the job is completed.", 409)
    pdf = build_report(job)
    attachment = "attachment" if request.args.get("download") == "1" else "inline"
    return Response(
        pdf,
        mimetype="application/pdf",
        headers={"Content-Disposition": f'{attachment}; filename="job-{job.id}-report.pdf"', "Cache-Control": "private, no-store"},
    )
