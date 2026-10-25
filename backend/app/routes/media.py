"""Photos and videos on a job's worksheet, and serving every job file after an access check."""
import uuid

from flask import Blueprint, Response, current_app, jsonify, redirect, request, send_file

from app import db
from app.models.forms import FormSubmission, FormTemplate, FormVersion
from app.models.media import JobFile
from app.routes.worksheet import job_detail, load_job, worksheet_job
from app.services.billing import check_storage, require_feature
from app.services.data_export import file_for_link
from app.services.forms import forms_for_job, latest_version
from app.services.report_pdf import build_report
from app.services.storage import StorageError, read_upload_token, storage
from app.services.sync import happened_at, request_key
from app.services.worksheet import record_event
from app.utils.auth import current_user, roles
from app.utils.validation import ValidationError, choice, integer, json_body, text
from app.i18n import N_, _

bp = Blueprint("media", __name__)

PHOTO_KINDS = ("before", "after", "other")
# A photo answering a form's question comes with `form_field` ("<form id>:<question id>").
UPLOAD_KINDS = PHOTO_KINDS + ("video", "form_photo")
PHOTO_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
VIDEO_TYPES = {"video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "video/3gpp": ".3gp"}
KIND_LABEL = {"before": N_("before photo"), "after": N_("after photo"), "other": N_("photo"), "video": N_("video"), "form_photo": N_("form photo")}


def max_bytes(kind):
    megabytes = current_app.config["MAX_VIDEO_MB"] if kind == "video" else current_app.config["MAX_PHOTO_MB"]
    return megabytes * 1024 * 1024


def media_limits():
    config = current_app.config
    return {"photo_mb": config["MAX_PHOTO_MB"], "video_mb": config["MAX_VIDEO_MB"], "video_seconds": config["MAX_VIDEO_SECONDS"]}


def photo_question(job, data):
    """The form question a form photo answers: a photo question of a form on this job."""
    raw = data.get("form_field")
    form_id, _sep, field_id = raw.partition(":") if isinstance(raw, str) else ("", "", "")
    form = FormTemplate.query.filter_by(id=int(form_id), company_id=job.company_id).first() if form_id.isdigit() else None
    if not form or form not in forms_for_job(job):
        raise ValidationError(_("This photo isn't for a form on this job"), 404)
    submission = FormSubmission.query.filter_by(job_id=job.id, form_id=form.id).first()
    version = db.session.get(FormVersion, submission.version_id) if submission else latest_version(form)
    if not any(field["id"] == field_id and field["type"] == "photo" for field in version.fields):
        raise ValidationError(_("This form has no photo question {id}", id=field_id), 404)
    return f"{form.id}:{field_id}"


def new_key(job, extension):
    return f"{job.company_id}/jobs/{job.id}/{uuid.uuid4().hex}{extension}"


@bp.post("/jobs/<int:jid>/files")
@roles("mechanic")
def request_upload(jid):
    """Step 1: reserve a file and get where to upload it (the bucket, or this app)."""
    user = current_user()
    job = worksheet_job(jid, uploads=True)
    key = request_key()
    if key:
        # The phone asks again for a photo it reserved before (the answer was lost, or the upload
        # failed): the same file, with a fresh upload link, never a second copy.
        earlier = JobFile.query.filter_by(uploaded_by=user.id, client_key=key).first()
        if earlier and earlier.job_id != job.id:
            raise ValidationError(_("This change's ID was already used for a different change."), 422)
        if earlier and earlier.status == "ready":
            return jsonify(file_id=earlier.id, ready=True)
        if earlier:
            target = storage().upload_target(earlier.storage_key, earlier.content_type, earlier.size_bytes, max_bytes(earlier.kind), earlier.id)
            return jsonify(file_id=earlier.id, upload=target)
    data = json_body()
    kind = choice(data, "kind", UPLOAD_KINDS, "Kind")
    if not kind:
        raise ValidationError(_("Kind is required"))
    content_type = text(data, "content_type", "File type", required=True, max_length=80).lower()
    allowed = VIDEO_TYPES if kind == "video" else PHOTO_TYPES
    if content_type not in allowed:
        raise ValidationError(_("This type of file can't be added as a {kind}: {content_type}", kind=_(KIND_LABEL[kind]), content_type=content_type), 415)
    if kind == "form_photo":
        require_feature(job.company_id, "forms")
    form_field = photo_question(job, data) if kind == "form_photo" else None
    size = integer(data, "size", "Size", required=True, minimum=1)
    limit = max_bytes(kind)
    if size > limit:
        raise ValidationError(_("This {kind} is too large; the limit is {size} MB.", kind=_(KIND_LABEL[kind]), size=limit // (1024 * 1024)), 413)
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
        created_at=happened_at(),
        client_key=key,
        form_field=form_field,
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
        raise ValidationError(_("Upload not found"), 404)
    if (request.content_length or 0) > claims["max"]:
        raise ValidationError(_("File is too large"), 413)
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
    record = JobFile.query.filter(JobFile.id == fid, JobFile.uploaded_by == user.id, JobFile.company_id == user.company_id, JobFile.job_id.isnot(None)).first_or_404()
    job = worksheet_job(record.job_id, uploads=True)
    if record.status == "ready":
        return jsonify(job=job_detail(job, user))
    size = storage().size(record.storage_key)
    if not size:
        raise ValidationError(_("The upload didn't arrive. Please try again."), 409)
    if size > max_bytes(record.kind):
        storage().delete(record.storage_key)
        db.session.delete(record)
        db.session.commit()
        raise ValidationError(_("The file is larger than the limit"), 413)
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
    record = JobFile.query.filter(JobFile.id == fid, JobFile.uploaded_by == user.id, JobFile.company_id == user.company_id, JobFile.job_id.isnot(None)).first_or_404()
    if record.kind in ("signature", "form_signature"):
        raise ValidationError(_("Signatures can't be deleted"), 409)
    job = worksheet_job(record.job_id, uploads=True)
    if record.status == "ready":
        record_event(job, user, "file_removed", note=f"Removed a {KIND_LABEL[record.kind]}")
    storage().delete(record.storage_key)
    db.session.delete(record)
    db.session.commit()
    return jsonify(job=job_detail(job, user))


@bp.get("/files/<int:fid>")
@roles("boss", "mechanic", "customer")
def get_file(fid):
    """Hand out a file only to someone who can see its job (company and role checked by load_job),
    or its equipment."""
    user = current_user()
    record = JobFile.query.filter_by(id=fid, company_id=user.company_id, status="ready").first_or_404()
    if record.machine_id:
        # An equipment document: whoever can see the equipment. Only photos open in the browser;
        # other documents download.
        from app.routes.equipment import visible_machine

        visible_machine(record.machine_id)
        return serve_file(record, attachment=request.args.get("download") == "1" or not record.content_type.startswith("image/"))
    load_job(record.job_id)
    return serve_file(record, attachment=request.args.get("download") == "1")


@bp.get("/files/export/<token>")
def exported_file(token):
    """A file listed in a company's data export. The signed link is the permission, for 7 days."""
    record = file_for_link(token)
    if not record:
        raise ValidationError(_("This download link has expired. Export the data again for new links."), 404)
    return serve_file(record, attachment=True)


def serve_file(record, attachment):
    name = record.original_name or f"{record.kind}-{record.id}"
    url = storage().download_url(record.storage_key, name, record.content_type, attachment)
    if url:
        return redirect(url, code=302)
    path = storage().local_path(record.storage_key)
    if not path.is_file():
        raise ValidationError(_("This file is no longer available"), 404)
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
        raise ValidationError(_("The report is available once the job is completed."), 409)
    pdf = build_report(job)
    attachment = "attachment" if request.args.get("download") == "1" else "inline"
    return Response(
        pdf,
        mimetype="application/pdf",
        headers={"Content-Disposition": f'{attachment}; filename="job-{job.id}-report.pdf"', "Cache-Control": "private, no-store"},
    )
