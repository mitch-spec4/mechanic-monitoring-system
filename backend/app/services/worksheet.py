"""Worksheet rules shared by the job and worksheet routes: timer, history, checklist, completion."""
from app import db
from app.models.service_record import ServiceRecord
from app.models.worksheet import (
    ChecklistTemplate,
    ChecklistTemplateItem,
    JobChecklistItem,
    JobEvent,
    JobPart,
    WorkEntry,
)
from app.models.user import User
from app.services.sync import happened_at, synced_late
from app.utils.validation import ValidationError
from app.i18n import _, local_time

FINISHED = ("Completed", "Cancelled")


def record_event(job, user, action, from_status=None, to_status=None, note=None, previous_mechanic_id=None):
    """Add a line to the job's history, dated when the change was made (offline changes too)."""
    db.session.add(
        JobEvent(
            job_id=job.id,
            user_id=user.id if user else None,
            action=action,
            from_status=from_status,
            to_status=to_status,
            note=note,
            created_at=happened_at(),
            synced_at=synced_late(),
            previous_mechanic_id=previous_mechanic_id,
        )
    )


def last_status_event(job, status=None):
    query = JobEvent.query.filter(JobEvent.job_id == job.id, JobEvent.to_status.isnot(None))
    if status:
        query = query.filter(JobEvent.to_status == status)
    return query.order_by(JobEvent.created_at.desc(), JobEvent.id.desc()).first()


def handed_over(job, user):
    """When the job last left this mechanic (reassigned or unassigned), or None if it never did."""
    return (
        JobEvent.query.filter_by(job_id=job.id, previous_mechanic_id=user.id)
        .order_by(JobEvent.created_at.desc(), JobEvent.id.desc())
        .first()
    )


def reassigned_problem(job, event):
    if job.mechanic_id:
        name = db.session.get(User, job.mechanic_id).name
        return ValidationError(_("Reassigned to {name} at {time}", name=name, time=local_time(event.created_at)), 409)
    return ValidationError(_("Unassigned by your manager at {time}", time=local_time(event.created_at)), 409)


def open_entry(job):
    return WorkEntry.query.filter_by(job_id=job.id, ended_at=None).first()


def start_timer(job, mechanic_id):
    """Open a time entry unless one is already running, from when work started."""
    if not open_entry(job):
        db.session.add(WorkEntry(job_id=job.id, mechanic_id=mechanic_id, started_at=happened_at(), site=job.location))


def stop_timer(job):
    now = happened_at()
    for entry in WorkEntry.query.filter_by(job_id=job.id, ended_at=None).all():
        entry.ended_at = max(now, entry.started_at)


def copy_checklist(job):
    """Copy the job type's checklist onto the job once it has a technician, so their phone has it
    before work starts (it can be ticked offline), or else when work starts."""
    if not job.job_type or JobChecklistItem.query.filter_by(job_id=job.id).first():
        return
    template = ChecklistTemplate.query.filter_by(company_id=job.company_id, job_type=job.job_type).first()
    if not template:
        return
    items = ChecklistTemplateItem.query.filter_by(template_id=template.id).order_by(ChecklistTemplateItem.position)
    for item in items:
        db.session.add(JobChecklistItem(job_id=job.id, label=item.label, required=item.required, position=item.position))


def refresh_checklist(job):
    """The job type changed before work started: the checklist follows it, unless something is ticked."""
    items = JobChecklistItem.query.filter_by(job_id=job.id)
    if WorkEntry.query.filter_by(job_id=job.id).first() or items.filter_by(done=True).first():
        return
    items.delete(synchronize_session=False)
    if job.mechanic_id:
        copy_checklist(job)


def completion_problems(job):
    """What still stops this job from being completed (empty when it can be)."""
    problems = []
    entries = WorkEntry.query.filter_by(job_id=job.id).all()
    if not entries:
        problems.append(_("Start work so the worksheet has a time entry"))
    elif not any((entry.work_done or "").strip() for entry in entries):
        problems.append(_("Describe the work done on the worksheet"))
    missing = JobChecklistItem.query.filter_by(job_id=job.id, required=True, done=False).count()
    if missing:
        problems.append(_("Tick 1 required checklist item") if missing == 1 else _("Tick {count} required checklist items", count=missing))
    return problems


def fill_service_record(job):
    """Create or complete the job's service record from the worksheet, without overwriting
    anything the mechanic wrote. Jobs without a machine have no service record."""
    if not job.machine_id:
        return None
    record = ServiceRecord.query.filter_by(job_id=job.id).first()
    if not record:
        record = ServiceRecord(
            job_id=job.id,
            machine_id=job.machine_id,
            customer_id=job.customer_id,
            mechanic_id=job.mechanic_id,
            company_id=job.company_id,
            service_type=job.job_type or "Service",
        )
        db.session.add(record)
    entries = WorkEntry.query.filter_by(job_id=job.id).order_by(WorkEntry.started_at).all()
    notes = [entry.work_done.strip() for entry in entries if (entry.work_done or "").strip()]
    if not record.problem:
        record.problem = job.description
    if not record.work_done and notes:
        record.work_done = "\n".join(notes)
    parts = JobPart.query.filter_by(job_id=job.id).order_by(JobPart.id).all()
    if parts:
        record.parts_replaced = ", ".join(f"{part.name} ×{format_quantity(part.quantity)}" for part in parts)
    record.service_date = happened_at()
    return record


def format_quantity(value):
    number = float(value)
    return str(int(number)) if number.is_integer() else f"{number:g}"


def delete_job_children(job):
    """Remove everything attached to a job that never started (used when deleting it)."""
    for model in (JobEvent, JobChecklistItem, JobPart, WorkEntry):
        model.query.filter_by(job_id=job.id).delete()
