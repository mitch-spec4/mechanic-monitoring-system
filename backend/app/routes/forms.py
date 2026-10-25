"""Custom forms: managers build them; technicians (and managers) fill them in on jobs, offline too;
a completed form is a PDF certificate (app/services/forms.py, app/services/form_pdf.py)."""
import io
import uuid

from flask import Blueprint, jsonify, send_file
from werkzeug.exceptions import NotFound

from app import db
from app.models.forms import FormSubmission, FormTemplate, FormVersion
from app.models.job import Job
from app.models.media import JobFile
from app.models.service import ServiceTemplate
from app.routes.worksheet import FINISHED, job_detail, load_job, newer_change_kept, worksheet_job
from app.services import forms as form_rules
from app.services.billing import require_feature
from app.services.form_pdf import build_certificate
from app.services.storage import storage
from app.services.sync import happened_at
from app.services.worksheet import record_event
from app.utils.auth import current_user, roles
from app.utils.validation import ValidationError, json_body, text
from app.i18n import _

bp = Blueprint("forms", __name__)


def form_out(form, counts=True):
    version = form_rules.latest_version(form)
    data = {
        "id": form.id,
        "name": form.name,
        "description": form.description,
        "job_types": form.job_types or [],
        "service_ids": form.service_ids or [],
        "required": form.required,
        "customer_visible": form.customer_visible,
        "active": form.active,
        "version": {"id": version.id, "number": version.number, "fields": version.fields} if version else None,
    }
    if counts:
        data["submissions"] = FormSubmission.query.filter_by(form_id=form.id).count()
    return data


def read_attachments(data, company_id, form=None):
    """Which jobs get the form: job types (as typed on jobs and checklists) and services."""
    if "job_types" in data:
        types = data.get("job_types") or []
        if not isinstance(types, list) or any(not isinstance(value, str) for value in types):
            raise ValidationError(_("Job types must be a list"))
        types = list(dict.fromkeys(value.strip()[:80] for value in types if value.strip()))
        if form:
            form.job_types = types
        else:
            data["_job_types"] = types
    if "service_ids" in data:
        ids = data.get("service_ids") or []
        if not isinstance(ids, list) or any(not isinstance(value, int) or isinstance(value, bool) for value in ids):
            raise ValidationError(_("Services must be a list"))
        ids = list(dict.fromkeys(ids))
        found = {s.id for s in ServiceTemplate.query.filter(ServiceTemplate.company_id == company_id, ServiceTemplate.id.in_(ids or [0])).all()}
        if set(ids) - found:
            raise ValidationError(_("Service not found"), 404)
        if form:
            form.service_ids = ids
        else:
            data["_service_ids"] = ids


def unique_name(company_id, name, exclude_id=None):
    query = FormTemplate.query.filter(FormTemplate.company_id == company_id, db.func.lower(FormTemplate.name) == name.lower())
    if exclude_id:
        query = query.filter(FormTemplate.id != exclude_id)
    if query.first():
        raise ValidationError(_("There is already a form called {name}", name=name), 409)


def load_form(fid, company_id):
    return FormTemplate.query.filter_by(id=fid, company_id=company_id).first_or_404()


@bp.get("/forms")
@roles("boss")
def list_forms():
    user = current_user()
    require_feature(user.company_id, "forms")
    forms = FormTemplate.query.filter_by(company_id=user.company_id).order_by(db.func.lower(FormTemplate.name)).all()
    return jsonify(forms=[form_out(form) for form in forms])


@bp.post("/forms")
@roles("boss")
def create_form():
    user = current_user()
    require_feature(user.company_id, "forms")
    if FormTemplate.query.filter_by(company_id=user.company_id).count() >= form_rules.MAX_FORMS:
        raise ValidationError(_("A company can have at most {count} forms", count=form_rules.MAX_FORMS), 409)
    data = json_body()
    name = text(data, "name", "Name", required=True, max_length=120)
    unique_name(user.company_id, name)
    fields = form_rules.read_fields(data.get("fields"))
    read_attachments(data, user.company_id)
    form = FormTemplate(
        company_id=user.company_id,
        name=name,
        description=text(data, "description", "Description"),
        job_types=data.get("_job_types", []),
        service_ids=data.get("_service_ids", []),
        required=data.get("required") is True,
        customer_visible=data.get("customer_visible") is True,
        active=data.get("active", True) is not False,
    )
    db.session.add(form)
    db.session.flush()
    db.session.add(FormVersion(form_id=form.id, number=1, fields=fields, created_by=user.id))
    db.session.commit()
    return jsonify(form=form_out(form)), 201


@bp.patch("/forms/<int:fid>")
@roles("boss")
def update_form(fid):
    """Settings change in place. New questions are a new version once the current one has been
    filled in, so what was filled in keeps the questions it answered."""
    user = current_user()
    require_feature(user.company_id, "forms")
    form = load_form(fid, user.company_id)
    data = json_body()
    if "name" in data:
        name = text(data, "name", "Name", required=True, max_length=120)
        unique_name(user.company_id, name, exclude_id=form.id)
        form.name = name
    if "description" in data:
        form.description = text(data, "description", "Description")
    read_attachments(data, user.company_id, form)
    for flag in ("required", "customer_visible", "active"):
        if flag in data:
            setattr(form, flag, data[flag] is True)
    if "fields" in data:
        fields = form_rules.read_fields(data["fields"])
        current = form_rules.latest_version(form)
        if fields != current.fields:
            if FormSubmission.query.filter_by(version_id=current.id).first():
                db.session.add(FormVersion(form_id=form.id, number=current.number + 1, fields=fields, created_by=user.id))
            else:
                current.fields = fields
    db.session.commit()
    return jsonify(form=form_out(form))


@bp.delete("/forms/<int:fid>")
@roles("boss")
def delete_form(fid):
    user = current_user()
    form = load_form(fid, user.company_id)
    if FormSubmission.query.filter_by(form_id=form.id).first():
        raise ValidationError(_("This form was filled in on jobs. Turn it off instead, so they keep it."), 409)
    FormVersion.query.filter_by(form_id=form.id).delete()
    db.session.delete(form)
    db.session.commit()
    return jsonify(ok=True)


def refused_answers(fields, sent):
    """A change that a newer one beat, for the job's history: each answer under its question."""
    labels = {field["id"]: field["label"] for field in fields}
    if not isinstance(sent, dict):
        return {}
    return {labels[key]: value.get("name") if isinstance(value, dict) else value for key, value in sent.items() if key in labels and value not in (None, "")}


def form_job(jid, user):
    """The job whose form is filled in: a technician's own (as the worksheet allows), or any
    unfinished job in the company for a manager."""
    if user.role == "mechanic":
        return worksheet_job(jid)
    job = Job.query.filter_by(id=jid, company_id=user.company_id).first_or_404()
    if job.status in FINISHED:
        raise ValidationError(_("This job is finished, so its forms can no longer be changed."), 409)
    return job


def store_signature(job, user, form, field_id, signature):
    key = f"{job.company_id}/jobs/{job.id}/form-{form.id}-{uuid.uuid4().hex}.png"
    storage().put(key, signature["png"], "image/png")
    db.session.add(
        JobFile(
            company_id=job.company_id,
            job_id=job.id,
            uploaded_by=user.id,
            kind="form_signature",
            content_type="image/png",
            size_bytes=len(signature["png"]),
            storage_key=key,
            original_name="signature.png",
            status="ready",
            created_at=happened_at(),
            form_field=f"{form.id}:{field_id}",
        )
    )


@bp.put("/jobs/<int:jid>/forms/<int:fid>")
@roles("boss", "mechanic")
def save_answers(jid, fid):
    """Save a form's answers on a job (from the phone's queue too). `complete: true` also marks it
    completed, once every required question that's shown is answered. Last change wins, by when
    it was made; a completed form can still be corrected until the job is finished."""
    user = current_user()
    job = form_job(jid, user)
    require_feature(job.company_id, "forms")
    form = load_form(fid, job.company_id)
    if form not in form_rules.forms_for_job(job):
        raise NotFound()
    data = json_body()
    submission = FormSubmission.query.filter_by(job_id=job.id, form_id=form.id).first()
    if submission:
        version = db.session.get(FormVersion, submission.version_id)
        if newer_change_kept(job, user, submission.updated_at, "form", refused_answers(version.fields, data.get("answers")), label=form.name):
            return jsonify(job=job_detail(job, user))
    else:
        # The version the phone showed (it may have been cached before the form changed).
        asked = data.get("version_id")
        version = (
            FormVersion.query.filter_by(id=asked, form_id=form.id).first() if isinstance(asked, int) and not isinstance(asked, bool) else None
        ) or form_rules.latest_version(form)
        submission = FormSubmission(company_id=job.company_id, job_id=job.id, form_id=form.id, version_id=version.id, machine_id=job.machine_id)
        db.session.add(submission)
    answers, signatures = form_rules.read_answers(version.fields, data.get("answers") or {}, submission.answers)
    for field_id, signature in signatures.items():
        answers[field_id] = {"name": signature["name"]}
    complete = data.get("complete") is True
    # A completed form stays complete: a change can't leave a required question unanswered.
    if complete or submission.status == "completed":
        # Checked before anything is stored, so a refused completion leaves no files behind.
        missing = form_rules.missing_answers(version.fields, answers, form_rules.form_files(job.id, form.id))
        if missing:
            db.session.rollback()
            raise ValidationError(_("Answer every required question first: {questions}.", questions="; ".join(missing)), 409, missing=missing)
    for field_id, signature in signatures.items():
        store_signature(job, user, form, field_id, signature)
    if complete:
        if submission.status != "completed":
            submission.status = "completed"
            submission.completed_at = happened_at()
            submission.completed_by = user.id
            record_event(job, user, "form_completed", note=form.name)
    elif submission.id is None or submission.status == "draft":
        submission.status = "draft"
    submission.answers = answers
    submission.updated_at = happened_at()
    submission.updated_by = user.id
    db.session.commit()
    return jsonify(job=job_detail(job, user))


@bp.get("/jobs/<int:jid>/forms/<int:fid>/certificate.pdf")
@roles("boss", "mechanic", "customer")
def certificate(jid, fid):
    user = current_user()
    job = load_job(jid)
    submission = FormSubmission.query.filter_by(job_id=job.id, form_id=fid, status="completed").first_or_404()
    form = db.session.get(FormTemplate, submission.form_id)
    if user.role == "customer" and not form.customer_visible:
        raise NotFound()
    safe = "".join(char if char.isalnum() else "-" for char in form.name).strip("-")[:40] or "form"
    return send_file(
        io.BytesIO(build_certificate(job, form, submission)),
        mimetype="application/pdf",
        as_attachment=False,
        download_name=f"{safe}-job-{job.id}.pdf",
        max_age=0,
        etag=False,
        last_modified=None,
    )
