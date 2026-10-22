from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from flask import Blueprint, jsonify

from app import db
from app.models.customer import Customer
from app.models.job import Job
from app.models.machine import Machine
from app.models.service_record import ServiceRecord
from app.models.user import User
from app.models.worksheet import JobChecklistItem, JobEvent, JobPart, WorkEntry
from app.services.worksheet import FINISHED, completion_problems, format_quantity, record_event
from app.utils.auth import current_user, roles
from app.utils.time import utcnow
from app.utils.validation import ValidationError, json_body, text

bp = Blueprint("worksheet", __name__)
MAX_ENTRY_HOURS = 24
CLOCK_SKEW = timedelta(minutes=5)


def iso(value):
    return value.isoformat() if value else None


def hours_between(start, end):
    return round(max((end - start).total_seconds(), 0) / 3600, 2)


def load_job(jid):
    """A job the current user may see: any job in their company for a boss, their own jobs
    for a mechanic, and their company's jobs for a customer."""
    user = current_user()
    query = Job.query.filter_by(id=jid, company_id=user.company_id)
    if user.role == "mechanic":
        query = query.filter_by(mechanic_id=user.id)
    if user.role == "customer":
        query = query.filter_by(customer_id=user.customer_id)
    return query.first_or_404()


def editable_job(jid):
    """A job whose worksheet the current mechanic may change."""
    job = load_job(jid)
    if job.status in FINISHED:
        raise ValidationError(f"This job is {job.status.lower()}; its worksheet can no longer be changed.", 409)
    return job


def names_for(ids):
    ids = {i for i in ids if i}
    return {user.id: user.name for user in User.query.filter(User.id.in_(ids)).all()} if ids else {}


def entry_out(entry, names, now):
    end = entry.ended_at or now
    return {
        "id": entry.id,
        "mechanic": names.get(entry.mechanic_id),
        "started_at": iso(entry.started_at),
        "ended_at": iso(entry.ended_at),
        "running": entry.ended_at is None,
        "hours": hours_between(entry.started_at, end),
        "site": entry.site,
        "work_done": entry.work_done,
    }


def job_detail(job, user):
    now = utcnow()
    entries = WorkEntry.query.filter_by(job_id=job.id).order_by(WorkEntry.started_at).all()
    parts = JobPart.query.filter_by(job_id=job.id).order_by(JobPart.id).all()
    checklist = JobChecklistItem.query.filter_by(job_id=job.id).order_by(JobChecklistItem.position, JobChecklistItem.id).all()
    events = JobEvent.query.filter_by(job_id=job.id).order_by(JobEvent.created_at, JobEvent.id).all()
    record = ServiceRecord.query.filter_by(job_id=job.id).first()
    names = names_for(
        [job.mechanic_id]
        + [e.mechanic_id for e in entries]
        + [e.user_id for e in events]
        + [p.added_by for p in parts]
        + [c.done_by for c in checklist]
    )
    machine = db.session.get(Machine, job.machine_id) if job.machine_id else None
    customer = db.session.get(Customer, job.customer_id) if job.customer_id else None
    detail = {
        "id": job.id,
        "title": job.title,
        "description": job.description,
        "status": job.status,
        "priority": job.priority,
        "job_type": job.job_type,
        "location": job.location,
        "due_date": iso(job.due_date),
        "customer": {"id": customer.id, "name": customer.name} if customer else None,
        "machine": {"id": machine.id, "name": machine.name, "serial_no": machine.serial_no} if machine else None,
        "mechanic": {"id": job.mechanic_id, "name": names.get(job.mechanic_id)} if job.mechanic_id else None,
        "parts": [
            {"id": p.id, "name": p.name, "quantity": float(p.quantity), "label": format_quantity(p.quantity), "added_by": names.get(p.added_by)}
            for p in parts
        ],
        "checklist": [
            {
                "id": c.id,
                "label": c.label,
                "required": c.required,
                "done": c.done,
                "note": c.note,
                "done_by": names.get(c.done_by),
                "done_at": iso(c.done_at),
            }
            for c in checklist
        ],
        "work_done": [e.work_done for e in entries if (e.work_done or "").strip()],
        "record": (
            {
                "id": record.id,
                "service_type": record.service_type,
                "problem": record.problem,
                "solution": record.solution,
                "advice": record.advice,
                "work_done": record.work_done,
                "parts_replaced": record.parts_replaced,
            }
            if record
            else None
        ),
    }
    if user.role == "customer":
        # Customers see what was done; hours, internal history, and who ticked what stay with the company.
        for item in detail["checklist"]:
            item.pop("done_by")
            item.pop("done_at")
            item.pop("note")
        for part in detail["parts"]:
            part.pop("added_by")
        return detail
    entry_rows = [entry_out(e, names, now) for e in entries]
    detail.update(
        entries=entry_rows,
        total_hours=round(sum(row["hours"] for row in entry_rows), 2),
        timer_running=any(row["running"] for row in entry_rows),
        history=[
            {
                "id": e.id,
                "action": e.action,
                "from_status": e.from_status,
                "to_status": e.to_status,
                "note": e.note,
                "user": names.get(e.user_id),
                "created_at": iso(e.created_at),
            }
            for e in events
        ],
        can_edit=user.role == "mechanic" and job.status not in FINISHED,
        completion_blockers=completion_problems(job) if job.status not in FINISHED else [],
    )
    return detail


@bp.get("/<int:jid>")
@roles("boss", "mechanic", "customer")
def get_job(jid):
    return jsonify(job=job_detail(load_job(jid), current_user()))


def parse_time(data, field, label, required=False):
    value = data.get(field)
    if value in (None, ""):
        if required:
            raise ValidationError(f"{label} is required")
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise ValidationError(f"{label} must be a date and time") from None
    if moment.tzinfo:
        moment = moment.astimezone(timezone.utc).replace(tzinfo=None)
    if moment > utcnow() + CLOCK_SKEW:
        raise ValidationError(f"{label} cannot be in the future")
    return moment


def check_overlap(job, started_at, ended_at, exclude_id=None):
    """Time on one job can't be counted twice: refuse entries that overlap another one."""
    end = ended_at or utcnow()
    for other in WorkEntry.query.filter(WorkEntry.job_id == job.id, WorkEntry.id != (exclude_id or 0)).all():
        other_end = other.ended_at or utcnow()
        if other.started_at < end and other_end > started_at:
            span = f"{other.started_at:%d %b %H:%M}–{'now' if other.ended_at is None else f'{other_end:%H:%M}'} UTC"
            raise ValidationError(f"This overlaps another time entry on this job ({span})", 409)


def check_span(started_at, ended_at):
    if ended_at is None:
        return
    if ended_at <= started_at:
        raise ValidationError("End time must be after the start time")
    if ended_at - started_at > timedelta(hours=MAX_ENTRY_HOURS):
        raise ValidationError(f"A single time entry can be at most {MAX_ENTRY_HOURS} hours")


@bp.post("/<int:jid>/entries")
@roles("mechanic")
def add_entry(jid):
    """Add a finished stretch of work by hand (the running timer is managed by Start/Pause)."""
    user = current_user()
    job = editable_job(jid)
    data = json_body()
    started_at = parse_time(data, "started_at", "Start time", required=True)
    ended_at = parse_time(data, "ended_at", "End time", required=True)
    check_span(started_at, ended_at)
    check_overlap(job, started_at, ended_at)
    entry = WorkEntry(
        job_id=job.id,
        mechanic_id=user.id,
        started_at=started_at,
        ended_at=ended_at,
        site=text(data, "site", "Site", max_length=200) or job.location,
        work_done=text(data, "work_done", "Work done"),
    )
    db.session.add(entry)
    record_event(job, user, "time_added", note=f"Added {hours_between(started_at, ended_at)} h")
    db.session.commit()
    return jsonify(job=job_detail(job, user)), 201


@bp.patch("/<int:jid>/entries/<int:eid>")
@roles("mechanic")
def update_entry(jid, eid):
    user = current_user()
    job = editable_job(jid)
    entry = WorkEntry.query.filter_by(id=eid, job_id=job.id, mechanic_id=user.id).first_or_404()
    data = json_body()
    if "work_done" in data:
        entry.work_done = text(data, "work_done", "Work done")
    if "site" in data:
        entry.site = text(data, "site", "Site", max_length=200)
    if "started_at" in data or "ended_at" in data:
        started_at = parse_time(data, "started_at", "Start time") or entry.started_at
        ended_at = parse_time(data, "ended_at", "End time") if "ended_at" in data else entry.ended_at
        if entry.ended_at is None and ended_at is not None:
            raise ValidationError("Use Pause or Complete to stop the running timer")
        if entry.ended_at is not None and ended_at is None:
            raise ValidationError("End time is required")
        check_span(started_at, ended_at)
        check_overlap(job, started_at, ended_at, exclude_id=entry.id)
        if (started_at, ended_at) != (entry.started_at, entry.ended_at):
            record_event(job, user, "time_corrected")
        entry.started_at, entry.ended_at = started_at, ended_at
    db.session.commit()
    return jsonify(job=job_detail(job, user))


def parse_quantity(data):
    value = data.get("quantity", 1)
    try:
        quantity = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        raise ValidationError("Quantity must be a number") from None
    if not quantity.is_finite() or quantity <= 0 or quantity > 100000:
        raise ValidationError("Quantity must be more than 0")
    return quantity.quantize(Decimal("0.01"))


@bp.post("/<int:jid>/parts")
@roles("mechanic")
def add_part(jid):
    user = current_user()
    job = editable_job(jid)
    data = json_body()
    part = JobPart(
        job_id=job.id,
        name=text(data, "name", "Part name", required=True, max_length=160),
        quantity=parse_quantity(data),
        added_by=user.id,
    )
    db.session.add(part)
    record_event(job, user, "part_added", note=f"{part.name} ×{format_quantity(part.quantity)}")
    db.session.commit()
    return jsonify(job=job_detail(job, user)), 201


@bp.delete("/<int:jid>/parts/<int:pid>")
@roles("mechanic")
def remove_part(jid, pid):
    user = current_user()
    job = editable_job(jid)
    part = JobPart.query.filter_by(id=pid, job_id=job.id).first_or_404()
    record_event(job, user, "part_removed", note=f"{part.name} ×{format_quantity(part.quantity)}")
    db.session.delete(part)
    db.session.commit()
    return jsonify(job=job_detail(job, user))


@bp.patch("/<int:jid>/checklist/<int:item_id>")
@roles("mechanic")
def update_checklist_item(jid, item_id):
    user = current_user()
    job = editable_job(jid)
    item = JobChecklistItem.query.filter_by(id=item_id, job_id=job.id).first_or_404()
    data = json_body()
    if "note" in data:
        item.note = text(data, "note", "Note")
    if "done" in data:
        if not isinstance(data["done"], bool):
            raise ValidationError("Done must be true or false")
        if data["done"] != item.done:
            item.done = data["done"]
            item.done_by = user.id if item.done else None
            item.done_at = utcnow() if item.done else None
            record_event(job, user, "checked" if item.done else "unchecked", note=item.label)
    db.session.commit()
    return jsonify(job=job_detail(job, user))


@bp.put("/<int:jid>/record")
@roles("mechanic")
def save_record(jid):
    """The customer-facing service summary for this job."""
    user = current_user()
    job = editable_job(jid)
    if not job.machine_id:
        raise ValidationError("This job has no machine, so it has no service record. Ask your manager to link one.")
    data = json_body()
    record = ServiceRecord.query.filter_by(job_id=job.id).first()
    if not record:
        record = ServiceRecord(
            job_id=job.id,
            machine_id=job.machine_id,
            customer_id=job.customer_id,
            mechanic_id=user.id,
            company_id=job.company_id,
            service_type=job.job_type or "Service",
        )
        db.session.add(record)
    if "service_type" in data:
        record.service_type = text(data, "service_type", "Service type", required=True, max_length=80)
    for field in ("problem", "solution", "advice"):
        if field in data:
            setattr(record, field, text(data, field))
    db.session.commit()
    return jsonify(job=job_detail(job, user))


@bp.post("/<int:jid>/notes")
@roles("boss", "mechanic")
def add_note(jid):
    """A note on the job's history (managers and the assigned mechanic; never deleted)."""
    user = current_user()
    job = load_job(jid)
    note = text(json_body(), "note", "Note", required=True, max_length=2000)
    record_event(job, user, "note", note=note)
    db.session.commit()
    return jsonify(job=job_detail(job, user)), 201
