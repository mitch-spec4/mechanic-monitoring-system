import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from flask import Blueprint, abort, jsonify

from app import db
from app.models.customer import Customer
from app.models.job import Job
from app.models.location import LocationPoint
from app.models.media import JobFile
from app.models.machine import Machine
from app.models.service_record import ServiceRecord
from app.models.user import User
from app.models.worksheet import JobChecklistItem, JobEvent, JobPart, WorkEntry
from app.services.billing import has_feature, require_feature
from app.services.costing import job_costing
from app.services.location import point_out
from app.services.routing import site_positions
from app.services.sync import happened_at, synced_late
from app.services.worksheet import (
    FINISHED,
    completion_problems,
    format_quantity,
    handed_over,
    last_status_event,
    reassigned_problem,
    record_event,
)
from app.services.catalog import service_summary
from app.utils.auth import current_user, roles
from app.utils.time import utcnow
from app.utils.validation import ValidationError, integer, json_body, money, text
from app.i18n import N_, _, local_time

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


UPLOAD_STATUSES = ("In Progress", "Paused")


def worksheet_job(jid, uploads=False, notes=False):
    """The job whose worksheet the current mechanic changes, as it was when they made the change.

    While the job is theirs and unfinished, anything goes. Work done offline before the job was
    reassigned or cancelled is still kept (time, photos, notes, parts, ticks); anything made after
    that is refused, saying what happened. A completed job's worksheet stays locked, except for
    photos and videos taken before it was completed: they upload when the phone has a good signal.
    """
    user = current_user()
    job = Job.query.filter_by(id=jid, company_id=user.company_id).first_or_404()
    at = happened_at()
    mine = job.mechanic_id == user.id
    if not mine:
        left = handed_over(job, user)
        if not left:
            abort(404)
        if at >= left.created_at:
            raise reassigned_problem(job, left)
    if notes:
        return job
    if job.status == "Cancelled":
        cancelled = last_status_event(job, "Cancelled")
        if cancelled and at < cancelled.created_at:
            return job
        raise ValidationError(_("This job was cancelled at {time}, so its worksheet can no longer be changed.", time=local_time(cancelled.created_at if cancelled else None)), 409)
    if job.status in FINISHED:
        completed = last_status_event(job, "Completed")
        if uploads and completed and at < completed.created_at:
            return job
        raise ValidationError(_("This job is finished ({status}), so its worksheet can no longer be changed.", status=_(job.status)), 409)
    # Media is about the work itself (work made before a reassignment counts, whatever the job's status now).
    if uploads and mine and job.status not in UPLOAD_STATUSES:
        raise ValidationError(_("Add photos and videos while the job is in progress or paused."), 409)
    return job


def version(item, values, label=None):
    """A worksheet item's content for the history, as JSON: the app shows it in the reader's language."""
    values = {field: iso(value) if isinstance(value, datetime) else value for field, value in values.items()}
    return json.dumps({"item": item, "label": label, "values": values}, ensure_ascii=False)


def newer_change_kept(job, user, changed_at, item, values, label=None):
    """Last change wins, by when it was made. A change made offline before a newer one isn't
    applied, but it goes into the job's history so nothing is lost silently."""
    if changed_at is None or happened_at() >= changed_at:
        return False
    record_event(job, user, "change_not_applied", note=version(item, values, label))
    db.session.commit()
    return True


def keep_replaced(job, user, item, before, after, label=None):
    """A change made offline replaced what was saved before it reached the server: the earlier
    version goes into the history."""
    if synced_late() and before != after and any(value not in (None, "") for value in before.values()):
        record_event(job, user, "replaced", note=version(item, before, label))


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
    files = JobFile.query.filter_by(job_id=job.id, status="ready").order_by(JobFile.created_at, JobFile.id).all()
    names = names_for(
        [job.mechanic_id]
        + [e.mechanic_id for e in entries]
        + [e.user_id for e in events]
        + [p.added_by for p in parts]
        + [c.done_by for c in checklist]
        + [f.uploaded_by for f in files]
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
        "request_id": job.request_id,
        "visit": job.visit,
        "scheduled_start": iso(job.scheduled_start),
        "scheduled_end": iso(job.scheduled_end),
        "on_the_way_at": iso(job.on_the_way_at),
        # The service it was made from (with the skills the work needs) and how long it should take.
        "service": service_summary(job),
        "estimated_minutes": job.estimated_minutes,
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
        "files": [
            {
                "id": f.id,
                "kind": f.kind,
                "content_type": f.content_type,
                "size_bytes": f.size_bytes,
                "url": f"/api/files/{f.id}",
                "created_at": iso(f.created_at),
                "uploaded_by": names.get(f.uploaded_by),
            }
            for f in files
            if f.kind != "signature"
        ],
        "signature": signature_out(job, files),
        # The PDF report exists once the job is completed.
        "report_url": f"/api/jobs/{job.id}/report.pdf" if job.status == "Completed" else None,
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
        for file in detail["files"]:
            file.pop("uploaded_by")
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
                # Made offline: when it reached the server.
                "synced_at": iso(e.synced_at),
            }
            for e in events
        ],
        # Where the mechanic was when they started, resumed and completed the job.
        locations=[
            point_out(p)
            for p in LocationPoint.query.filter(LocationPoint.job_id == job.id, LocationPoint.kind != "live")
            .order_by(LocationPoint.recorded_at, LocationPoint.id)
            .all()
        ],
        can_edit=user.role == "mechanic" and job.status not in FINISHED,
        can_upload=user.role == "mechanic" and job.status in ("In Progress", "Paused"),
        media_limits=media_limits(),
        completion_blockers=completion_problems(job) if job.status not in FINISHED else [],
        # Where it is (its equipment's site), for directions.
        position=job_position(job),
    )
    if user.role == "boss" and has_feature(job.company_id, "costing"):
        # What it cost and what it made: managers only, on plans with job costing.
        detail["costing"] = job_costing(job, now)
    return detail


def job_position(job):
    position = site_positions([job]).get(job.id)
    return {"latitude": position[0], "longitude": position[1]} if position else None


def signature_out(job, files):
    image = next((f for f in reversed(files) if f.kind == "signature"), None)
    if job.signed_at:
        return {"name": job.signed_by_name, "signed_at": iso(job.signed_at), "url": f"/api/files/{image.id}" if image else None}
    if job.no_signature_reason:
        return {"not_signed_reason": job.no_signature_reason}
    return None


def media_limits():
    from app.routes.media import media_limits as limits

    return limits()


@bp.get("/<int:jid>")
@roles("boss", "mechanic", "customer")
def get_job(jid):
    return jsonify(job=job_detail(load_job(jid), current_user()))


def parse_time(data, field, label, required=False):
    value = data.get(field)
    if value in (None, ""):
        if required:
            raise ValidationError(_("{label} is required", label=_(label)))
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise ValidationError(_("{label} must be a date and time", label=_(label))) from None
    if moment.tzinfo:
        moment = moment.astimezone(timezone.utc).replace(tzinfo=None)
    if moment > utcnow() + CLOCK_SKEW:
        raise ValidationError(_("{label} cannot be in the future", label=_(label)))
    return moment


def check_overlap(job, started_at, ended_at, exclude_id=None):
    """Time on one job can't be counted twice: refuse entries that overlap another one."""
    end = ended_at or utcnow()
    for other in WorkEntry.query.filter(WorkEntry.job_id == job.id, WorkEntry.id != (exclude_id or 0)).all():
        other_end = other.ended_at or utcnow()
        if other.started_at < end and other_end > started_at:
            raise ValidationError(_("This overlaps another time entry on this job, started {start}", start=local_time(other.started_at)), 409)


def check_span(started_at, ended_at):
    if ended_at is None:
        return
    if ended_at <= started_at:
        raise ValidationError(_("End time must be after the start time"))
    if ended_at - started_at > timedelta(hours=MAX_ENTRY_HOURS):
        raise ValidationError(_("A single time entry can be at most {count} hours", count=MAX_ENTRY_HOURS))


@bp.post("/<int:jid>/entries")
@roles("mechanic")
def add_entry(jid):
    """Add a finished stretch of work by hand (the running timer is managed by Start/Pause)."""
    user = current_user()
    job = worksheet_job(jid)
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
        updated_at=happened_at(),
    )
    db.session.add(entry)
    record_event(job, user, "time_added", note=f"Added {hours_between(started_at, ended_at)} h")
    db.session.commit()
    return jsonify(job=job_detail(job, user)), 201


ENTRY_FIELDS = ("started_at", "ended_at", "site", "work_done")


@bp.patch("/<int:jid>/entries/<int:eid>")
@roles("mechanic")
def update_entry(jid, eid):
    user = current_user()
    job = worksheet_job(jid)
    entry = WorkEntry.query.filter_by(id=eid, job_id=job.id, mechanic_id=user.id).first_or_404()
    data = json_body()
    sent = {field: data[field] for field in ENTRY_FIELDS if field in data}
    if newer_change_kept(job, user, entry.updated_at, "entry", sent, iso(entry.started_at)):
        return jsonify(job=job_detail(job, user))
    before = {field: getattr(entry, field) for field in ENTRY_FIELDS}
    if "work_done" in data:
        entry.work_done = text(data, "work_done", "Work done")
    if "site" in data:
        entry.site = text(data, "site", "Site", max_length=200)
    if "started_at" in data or "ended_at" in data:
        started_at = parse_time(data, "started_at", "Start time") or entry.started_at
        ended_at = parse_time(data, "ended_at", "End time") if "ended_at" in data else entry.ended_at
        if entry.ended_at is None and ended_at is not None:
            raise ValidationError(_("Use Pause or Complete to stop the running timer"))
        if entry.ended_at is not None and ended_at is None:
            raise ValidationError(_("End time is required"))
        check_span(started_at, ended_at)
        check_overlap(job, started_at, ended_at, exclude_id=entry.id)
        if (started_at, ended_at) != (entry.started_at, entry.ended_at):
            record_event(job, user, "time_corrected")
        entry.started_at, entry.ended_at = started_at, ended_at
    after = {field: getattr(entry, field) for field in ENTRY_FIELDS}
    changed = [field for field in ENTRY_FIELDS if before[field] != after[field]]
    keep_replaced(job, user, "entry", {field: before[field] for field in changed}, {field: after[field] for field in changed}, iso(before["started_at"]))
    entry.updated_at = happened_at()
    db.session.commit()
    return jsonify(job=job_detail(job, user))


def parse_quantity(data):
    value = data.get("quantity", 1)
    try:
        quantity = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        raise ValidationError(_("Quantity must be a number")) from None
    if not quantity.is_finite() or quantity <= 0 or quantity > 100000:
        raise ValidationError(_("Quantity must be more than 0"))
    return quantity.quantize(Decimal("0.01"))


@bp.post("/<int:jid>/parts")
@roles("mechanic")
def add_part(jid):
    user = current_user()
    job = worksheet_job(jid)
    data = json_body()
    part = JobPart(
        job_id=job.id,
        name=text(data, "name", "Part name", required=True, max_length=160),
        quantity=parse_quantity(data),
        added_by=user.id,
        created_at=happened_at(),
    )
    db.session.add(part)
    record_event(job, user, "part_added", note=f"{part.name} ×{format_quantity(part.quantity)}")
    db.session.commit()
    return jsonify(job=job_detail(job, user)), 201


@bp.delete("/<int:jid>/parts/<int:pid>")
@roles("mechanic")
def remove_part(jid, pid):
    user = current_user()
    job = worksheet_job(jid)
    part = JobPart.query.filter_by(id=pid, job_id=job.id).first()
    if not part:
        # Already gone (removed on another phone, or this removal was sent twice): nothing to do.
        return jsonify(job=job_detail(job, user))
    record_event(job, user, "part_removed", note=f"{part.name} ×{format_quantity(part.quantity)}")
    db.session.delete(part)
    db.session.commit()
    return jsonify(job=job_detail(job, user))


@bp.patch("/<int:jid>/costing")
@roles("boss")
def update_costing(jid):
    """What the customer is charged ({charged}), and what parts cost ({parts: [{id, unit_cost}]})."""
    user = current_user()
    job = load_job(jid)
    require_feature(job.company_id, "costing")
    data = json_body()
    if "charged" in data:
        job.charged_cents = money(data, "charged", N_("Charged"))
    if "parts" in data:
        rows = data["parts"]
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValidationError(_("Send the parts as a list."))
        parts = {part.id: part for part in JobPart.query.filter_by(job_id=job.id).all()}
        for row in rows:
            part = parts.get(integer(row, "id", "Part", required=True))
            if not part:
                raise ValidationError(_("Part not found"), 404)
            part.unit_cost_cents = money(row, "unit_cost", N_("Cost of one"))
    db.session.commit()
    return jsonify(job=job_detail(job, user))


@bp.patch("/<int:jid>/checklist/<int:item_id>")
@roles("mechanic")
def update_checklist_item(jid, item_id):
    user = current_user()
    job = worksheet_job(jid)
    item = JobChecklistItem.query.filter_by(id=item_id, job_id=job.id).first_or_404()
    data = json_body()
    if "done" in data and not isinstance(data["done"], bool):
        raise ValidationError(_("Done must be true or false"))
    sent = {field: data[field] for field in ("done", "note") if field in data}
    if newer_change_kept(job, user, item.changed_at, "checklist", sent, item.label):
        return jsonify(job=job_detail(job, user))
    if "note" in data:
        note = text(data, "note", "Note")
        # Ticks have their own history lines; a note written over keeps the earlier one there.
        keep_replaced(job, user, "checklist", {"note": item.note}, {"note": note}, item.label)
        item.note = note
        item.changed_at = happened_at()
    if "done" in data and data["done"] != item.done:
        item.done = data["done"]
        item.done_by = user.id if item.done else None
        item.done_at = happened_at() if item.done else None
        item.changed_at = happened_at()
        record_event(job, user, "checked" if item.done else "unchecked", note=item.label)
    db.session.commit()
    return jsonify(job=job_detail(job, user))


SUMMARY_FIELDS = ("service_type", "problem", "solution", "advice")


@bp.put("/<int:jid>/record")
@roles("mechanic")
def save_record(jid):
    """The customer-facing service summary for this job."""
    user = current_user()
    job = worksheet_job(jid)
    if not job.machine_id:
        raise ValidationError(_("This job has no equipment, so it has no service record. Ask your manager to link one."))
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
    elif newer_change_kept(job, user, record.updated_at, "summary", {field: data[field] for field in SUMMARY_FIELDS if field in data}):
        return jsonify(job=job_detail(job, user))
    before = {field: getattr(record, field) for field in SUMMARY_FIELDS}
    if "service_type" in data:
        record.service_type = text(data, "service_type", "Service type", required=True, max_length=80)
    for field in ("problem", "solution", "advice"):
        if field in data:
            setattr(record, field, text(data, field))
    if record.updated_at:
        keep_replaced(job, user, "summary", before, {field: getattr(record, field) for field in SUMMARY_FIELDS})
    record.updated_at = happened_at()
    db.session.commit()
    return jsonify(job=job_detail(job, user))


@bp.post("/<int:jid>/notes")
@roles("boss", "mechanic")
def add_note(jid):
    """A note on the job's history (managers and the assigned mechanic; never deleted)."""
    user = current_user()
    job = worksheet_job(jid, notes=True) if user.role == "mechanic" else load_job(jid)
    note = text(json_body(), "note", "Note", required=True, max_length=2000)
    record_event(job, user, "note", note=note)
    db.session.commit()
    return jsonify(job=job_detail(job, user)), 201
