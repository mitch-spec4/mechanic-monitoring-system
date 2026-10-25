"""Custom forms: what a question is, which forms a job gets, checking answers, and what a filled
form looks like on the job (app/models/forms.py).

A question (one item of a version's `fields`):

    {"id": "pressure", "type": "number", "label": "Oil pressure (bar)", "required": true,
     "help": "...", "options": [...], "show_if": {"field": "load_test", "equals": "yes"}}

- `type`: heading (a section title, no answer), text, number, yesno ("yes" or "no"), choice (one
  of `options`), date ("YYYY-MM-DD"), photo (one or more photos, stored as job files), or
  signature (a drawn signature with the signer's name, stored as a job file).
- `show_if`: the question is only asked when an earlier yes/no or choice question has that
  answer. A hidden question is never required, and its answer is dropped.
"""
import re
from datetime import date

from app import db
from app.models.forms import FormSubmission, FormTemplate, FormVersion
from app.models.media import JobFile
from app.models.user import User
from app.services.signature import read_signature
from app.utils.validation import ValidationError
from app.i18n import _

FIELD_TYPES = ("heading", "text", "number", "yesno", "choice", "date", "photo", "signature")
# Types whose answer decides whether a later question is shown.
CONDITION_TYPES = ("yesno", "choice")
ID_PATTERN = re.compile(r"^[a-z0-9_-]{1,40}$")
MAX_FIELDS = 100
MAX_OPTIONS = 30
MAX_TEXT = 5000
MAX_FORMS = 100


def clean_text(value, limit):
    return value.strip()[:limit] if isinstance(value, str) else ""


def read_fields(value):
    """A form's questions as the builder sent them, checked and tidied. Raises on anything wrong."""
    if not isinstance(value, list) or not value:
        raise ValidationError(_("Add at least one question"))
    if len(value) > MAX_FIELDS:
        raise ValidationError(_("A form can have at most {count} questions", count=MAX_FIELDS))
    fields, seen = [], {}
    for number, raw in enumerate(value, start=1):
        if not isinstance(raw, dict):
            raise ValidationError(_("Question {number} isn't valid", number=number))
        field_id = raw.get("id") if isinstance(raw.get("id"), str) else ""
        if not ID_PATTERN.match(field_id) or field_id in seen:
            raise ValidationError(_("Question {number} needs its own ID", number=number))
        kind = raw.get("type")
        if kind not in FIELD_TYPES:
            raise ValidationError(_("Question {number} has an unknown type", number=number))
        label = clean_text(raw.get("label"), 200)
        if not label:
            raise ValidationError(_("Question {number} needs a label", number=number))
        field = {"id": field_id, "type": kind, "label": label}
        help_text = clean_text(raw.get("help"), 300)
        if help_text:
            field["help"] = help_text
        if kind != "heading":
            field["required"] = raw.get("required") is True
        if kind == "text" and raw.get("long") is True:
            field["long"] = True
        if kind == "choice":
            options = [clean_text(option, 100) for option in raw.get("options") or [] if clean_text(option, 100)]
            options = list(dict.fromkeys(options))
            if len(options) < 2 or len(options) > MAX_OPTIONS:
                raise ValidationError(_("\"{label}\" needs between 2 and {count} choices", label=label, count=MAX_OPTIONS))
            field["options"] = options
        condition = raw.get("show_if")
        if condition:
            source = seen.get(condition.get("field")) if isinstance(condition, dict) else None
            if not source or source["type"] not in CONDITION_TYPES:
                raise ValidationError(_("\"{label}\" can only depend on an earlier yes/no or choice question", label=label))
            allowed = ("yes", "no") if source["type"] == "yesno" else source["options"]
            if condition.get("equals") not in allowed:
                raise ValidationError(_("\"{label}\" depends on an answer its question doesn't have", label=label))
            field["show_if"] = {"field": source["id"], "equals": condition["equals"]}
        seen[field_id] = field
        fields.append(field)
    if all(field["type"] == "heading" for field in fields):
        raise ValidationError(_("Add at least one question"))
    return fields


def latest_version(form):
    return FormVersion.query.filter_by(form_id=form.id).order_by(FormVersion.number.desc()).first()


def visible(fields, answers):
    """The questions shown for these answers, in order."""
    shown = {}
    for field in fields:
        condition = field.get("show_if")
        if condition and (condition["field"] not in shown or answers.get(condition["field"]) != condition["equals"]):
            continue
        shown[field["id"]] = field
    return list(shown.values())


def form_files(job_id, form_id):
    """The photos and signatures answering a form's questions on a job, by question."""
    files = JobFile.query.filter(JobFile.job_id == job_id, JobFile.status == "ready", JobFile.form_field.like(f"{form_id}:%")).order_by(JobFile.created_at, JobFile.id)
    found = {}
    for record in files.all():
        found.setdefault(record.form_field.split(":", 1)[1], []).append(record)
    return found


def read_answers(fields, data, existing):
    """The answers sent, checked against the version's questions. Signatures come back as
    {"name", "png"} to store; everything else as the value to keep. Questions not sent keep
    their earlier answers."""
    if not isinstance(data, dict):
        raise ValidationError(_("Answers must be an object"))
    by_id = {field["id"]: field for field in fields}
    answers, signatures = dict(existing or {}), {}
    for field_id, value in data.items():
        field = by_id.get(field_id)
        if not field or field["type"] in ("heading", "photo"):
            raise ValidationError(_("This form has no question {id}", id=field_id))
        label = field["label"]
        if value in (None, ""):
            answers.pop(field_id, None)
            continue
        kind = field["type"]
        if kind == "text":
            if not isinstance(value, str) or len(value) > MAX_TEXT:
                raise ValidationError(_("\"{label}\" must be text of up to {count} characters", label=label, count=MAX_TEXT))
            answers[field_id] = value.strip()
        elif kind == "number":
            try:
                number = float(value)
            except (TypeError, ValueError):
                raise ValidationError(_("\"{label}\" must be a number", label=label)) from None
            if isinstance(value, bool) or number != number or abs(number) > 1e12:
                raise ValidationError(_("\"{label}\" must be a number", label=label))
            answers[field_id] = int(number) if number.is_integer() else number
        elif kind == "yesno":
            if value not in ("yes", "no"):
                raise ValidationError(_("\"{label}\" must be yes or no", label=label))
            answers[field_id] = value
        elif kind == "choice":
            if value not in field["options"]:
                raise ValidationError(_("\"{label}\" must be one of its choices", label=label))
            answers[field_id] = value
        elif kind == "date":
            try:
                answers[field_id] = date.fromisoformat(str(value)).isoformat()
            except ValueError:
                raise ValidationError(_("\"{label}\" must be a date", label=label)) from None
        elif kind == "signature":
            if isinstance(value, dict) and "image" not in value and isinstance(value.get("name"), str) and field_id in answers:
                continue  # already signed: the phone sent back what it was given
            signature = read_signature({"signature": value}) if isinstance(value, dict) else None
            if not signature or "png" not in signature:
                raise ValidationError(_("\"{label}\" needs a drawn signature and a name", label=label))
            signatures[field_id] = signature
    # Answers to questions now hidden are dropped.
    shown = {field["id"] for field in visible(fields, answers)}
    answers = {key: value for key, value in answers.items() if key in shown}
    signatures = {key: value for key, value in signatures.items() if key in shown}
    return answers, signatures


def missing_answers(fields, answers, files):
    """The labels of required questions shown and not answered yet."""
    missing = []
    for field in visible(fields, answers):
        if not field.get("required"):
            continue
        if field["type"] == "photo":
            if not files.get(field["id"]):
                missing.append(field["label"])
        elif field["id"] not in answers:
            missing.append(field["label"])
    return missing


def forms_for_job(job, attached=True):
    """The forms a job gets: active forms attached to its job type or its service, and any form
    already filled in on it (even if it was detached or turned off since). Without `attached`
    (a plan without forms), only the ones already filled in."""
    filled = {submission.form_id for submission in FormSubmission.query.filter_by(job_id=job.id).all()}
    forms = []
    for form in FormTemplate.query.filter_by(company_id=job.company_id).order_by(FormTemplate.name, FormTemplate.id).all():
        attached_now = attached and form.active and (
            (job.job_type and job.job_type in (form.job_types or [])) or (job.service_id and job.service_id in (form.service_ids or []))
        )
        if attached_now or form.id in filled:
            forms.append(form)
    return forms


def unfinished_required(job):
    """Required forms on the job not completed yet (their names)."""
    names = []
    for form in forms_for_job(job):
        if not form.required:
            continue
        submission = FormSubmission.query.filter_by(job_id=job.id, form_id=form.id).first()
        if not submission or submission.status != "completed":
            names.append(form.name)
    return names


def iso(value):
    return value.isoformat() if value else None


def job_form_out(job, form, viewer):
    """A form on a job as the job's page shows it: its questions (the version it was filled in
    with, or the latest) and what was filled in. Customers only get a completed certificate."""
    submission = FormSubmission.query.filter_by(job_id=job.id, form_id=form.id).first()
    version = db.session.get(FormVersion, submission.version_id) if submission else latest_version(form)
    completed = bool(submission and submission.status == "completed")
    out = {
        "form_id": form.id,
        "name": form.name,
        "description": form.description,
        "required": form.required,
        "customer_visible": form.customer_visible,
        "pdf_url": f"/api/jobs/{job.id}/forms/{form.id}/certificate.pdf" if completed else None,
        "completed_at": iso(submission.completed_at) if completed else None,
    }
    if viewer.role == "customer":
        return out
    files = form_files(job.id, form.id) if submission else {}
    people = {}
    if submission:
        ids = {submission.updated_by, submission.completed_by} - {None}
        people = {user.id: user.name for user in User.query.filter(User.id.in_(ids)).all()} if ids else {}
    out["version"] = {"id": version.id, "number": version.number, "fields": version.fields} if version else None
    out["submission"] = (
        {
            "status": submission.status,
            "answers": submission.answers or {},
            "updated_at": iso(submission.updated_at),
            "updated_by": people.get(submission.updated_by),
            "completed_by": people.get(submission.completed_by),
            "photos": {
                field_id: [{"id": f.id, "url": f"/api/files/{f.id}", "content_type": f.content_type} for f in records if f.kind == "form_photo"]
                for field_id, records in files.items()
            },
            "signatures": {
                field_id: {"url": f"/api/files/{records[-1].id}", "name": (submission.answers or {}).get(field_id, {}).get("name"), "signed_at": iso(records[-1].created_at)}
                for field_id, records in files.items()
                if records[-1].kind == "form_signature"
            },
        }
        if submission
        else None
    )
    return out


def job_forms(job, viewer, attached=True):
    forms = forms_for_job(job, attached)
    out = [job_form_out(job, form, viewer) for form in forms]
    if viewer.role == "customer":
        return [form for form in out if form["customer_visible"] and form["pdf_url"]]
    return out
