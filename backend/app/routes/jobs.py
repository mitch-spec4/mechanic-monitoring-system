from flask import Blueprint, jsonify

from app import db
from app.models.constants import DEFAULT_PRIORITY, PRIORITIES
from app.models.customer import Customer
from app.models.job import Job
from app.models.location import LocationPoint
from app.models.machine import Machine
from app.models.media import JobFile
from app.models.user import User
from app.models.worksheet import WorkEntry
from app.services.location import open_shift, stamp_job
from app.services.notifications import notify, notify_bosses
from app.services.signature import SIGNATURE_FIELDS, SIGNATURE_PROBLEM, apply_signature, read_signature
from app.services.worksheet import (
    completion_problems,
    copy_checklist,
    delete_job_children,
    fill_service_record,
    record_event,
    start_timer,
    stop_timer,
)
from app.utils.auth import current_user, roles
from app.utils.validation import ValidationError, choice, integer, iso_date, json_body, text

bp = Blueprint("jobs", __name__)

# Allowed status changes. Completed and Cancelled are final.
TRANSITIONS = {
    "Pending": {"Assigned", "Cancelled"},
    "Assigned": {"Accepted", "In Progress", "Pending", "Cancelled"},
    "Accepted": {"In Progress", "Cancelled"},
    "In Progress": {"Paused", "Completed", "Cancelled"},
    "Paused": {"In Progress", "Cancelled"},
    "Completed": set(),
    "Cancelled": set(),
}
# Mechanics move their own work forward; they cannot decline, cancel or unassign.
MECHANIC_TRANSITIONS = {
    ("Assigned", "Accepted"),
    ("Assigned", "In Progress"),
    ("Accepted", "In Progress"),
    ("In Progress", "Paused"),
    ("In Progress", "Completed"),
    ("Paused", "In Progress"),
}
REASSIGNABLE = {"Pending", "Assigned", "Accepted", "Paused"}
DELETABLE = {"Pending", "Assigned"}
# A mechanic's phone sends its position with Start, Resume and Complete.
LOCATION_FIELDS = {"latitude", "longitude", "accuracy", "location_error"}
STAMPED = {"In Progress": "job_start", "Completed": "job_complete"}


def out(job):
    return {
        "id": job.id,
        "title": job.title,
        "description": job.description,
        "priority": job.priority,
        "status": job.status,
        "job_type": job.job_type,
        "location": job.location,
        "due_date": job.due_date.isoformat() if job.due_date else None,
        "customer_id": job.customer_id,
        "machine_id": job.machine_id,
        "mechanic_id": job.mechanic_id,
    }


def find_machine(company_id, machine_id, customer_id=None):
    machine = Machine.query.filter_by(id=machine_id, company_id=company_id).first()
    if not machine:
        raise ValidationError("Machine not found", 404)
    if customer_id and machine.customer_id != customer_id:
        raise ValidationError("Machine does not belong to the selected customer")
    return machine


def find_mechanic(company_id, mechanic_id):
    mechanic = User.query.filter_by(id=mechanic_id, company_id=company_id, role="mechanic").first()
    if not mechanic:
        raise ValidationError("Mechanic not found", 404)
    return mechanic


@bp.get("")
@roles("boss", "mechanic", "customer")
def list_jobs():
    user = current_user()
    query = Job.query.filter_by(company_id=user.company_id)
    if user.role == "mechanic":
        query = query.filter_by(mechanic_id=user.id)
    if user.role == "customer":
        query = query.filter_by(customer_id=user.customer_id)
    return jsonify(jobs=[out(job) for job in query.order_by(Job.id.desc()).all()])


@bp.post("")
@roles("boss")
def create_job():
    user = current_user()
    data = json_body()
    title = text(data, "title", required=True, max_length=200)
    description = text(data, "description", required=True)
    priority = choice(data, "priority", PRIORITIES, default=DEFAULT_PRIORITY)
    mechanic_id = integer(data, "mechanic_id", "Mechanic")
    customer_id = integer(data, "customer_id", "Customer")
    machine_id = integer(data, "machine_id", "Machine")

    if mechanic_id:
        find_mechanic(user.company_id, mechanic_id)
    if customer_id and not Customer.query.filter_by(id=customer_id, company_id=user.company_id).first():
        raise ValidationError("Customer not found", 404)
    machine = find_machine(user.company_id, machine_id, customer_id) if machine_id else None
    if machine:
        customer_id = machine.customer_id

    job = Job(
        company_id=user.company_id,
        title=title,
        description=description,
        priority=priority,
        job_type=text(data, "job_type", "Job type", max_length=80),
        location=text(data, "location", max_length=200),
        due_date=iso_date(data, "due_date", "Due date"),
        customer_id=customer_id,
        machine_id=machine.id if machine else None,
        mechanic_id=mechanic_id,
        status="Assigned" if mechanic_id else "Pending",
    )
    db.session.add(job)
    db.session.flush()
    record_event(job, user, "created", to_status=job.status)
    if job.mechanic_id:
        mechanic = db.session.get(User, job.mechanic_id)
        record_event(job, user, "assigned", note=f"Assigned to {mechanic.name}")
        notify(job.mechanic_id, "New task assigned", f"{job.title} was assigned to you.", "job")
    db.session.commit()
    return jsonify(job=out(job)), 201


@bp.patch("/<int:jid>")
@roles("boss", "mechanic")
def update_job(jid):
    user = current_user()
    job = Job.query.filter_by(id=jid, company_id=user.company_id).first_or_404()
    data = json_body()
    old_status = job.status

    if user.role == "mechanic":
        if job.mechanic_id != user.id:
            return jsonify(error="Forbidden"), 403
        if set(data) - ({"status"} | LOCATION_FIELDS | SIGNATURE_FIELDS) or "status" not in data:
            return jsonify(error="Mechanics can only update job status"), 403

    if user.role == "boss":
        edited = edit_details(job, data)
        if edited:
            record_event(job, user, "updated", note="Changed " + ", ".join(edited))
        if "mechanic_id" in data:
            assign_mechanic(job, integer(data, "mechanic_id", "Mechanic"), user)

    if "status" in data:
        new_status = data["status"]
        if new_status not in TRANSITIONS:
            raise ValidationError("Invalid status")
        if new_status != job.status:
            if new_status not in TRANSITIONS[job.status]:
                raise ValidationError(f"A job that is {job.status} cannot be moved to {new_status}", 409)
            if user.role == "mechanic" and (job.status, new_status) not in MECHANIC_TRANSITIONS:
                raise ValidationError("Mechanics cannot decline or cancel jobs", 403)
            if new_status == "Assigned" and not job.mechanic_id:
                raise ValidationError("Assign a mechanic first", 409)
            if new_status == "In Progress":
                require_clocked_in(job, user)
            sign_off = None
            if new_status == "Completed":
                problems = completion_problems(job)
                sign_off = read_signature(data)
                if not sign_off:
                    problems.append(SIGNATURE_PROBLEM)
                if problems:
                    raise ValidationError(
                        "Can't complete yet: " + "; ".join(problems) + ".",
                        409,
                        blockers=problems,
                        # Only the customer's sign-off is missing: the app opens the signature pad.
                        needs_signature=problems == [SIGNATURE_PROBLEM],
                    )
            change_status(job, user, new_status)
            if sign_off:
                apply_signature(job, user, sign_off)
            if new_status in STAMPED:
                stamp_job(user, job, STAMPED[new_status], data)

    if old_status != job.status and user.role == "mechanic":
        notify_bosses(job.company_id, "Job status updated", f"{job.title} is now {job.status}.", "status")
    if old_status != job.status and job.status == "Cancelled" and job.mechanic_id:
        notify(job.mechanic_id, "Job cancelled", f"{job.title} was cancelled by your manager.", "job")
    db.session.commit()
    return jsonify(job=out(job))


EDITABLE_FIELDS = ("title", "description", "priority", "job_type", "location", "due_date", "machine_id")


def edit_details(job, data):
    """Apply a manager's edits and return the names of the fields that changed."""
    before = {field: getattr(job, field) for field in EDITABLE_FIELDS}
    if "title" in data:
        job.title = text(data, "title", required=True, max_length=200)
    if "description" in data:
        job.description = text(data, "description", required=True)
    if "priority" in data:
        job.priority = choice(data, "priority", PRIORITIES, default=job.priority)
    if "job_type" in data:
        job.job_type = text(data, "job_type", "Job type", max_length=80)
    if "location" in data:
        job.location = text(data, "location", max_length=200)
    if "due_date" in data:
        job.due_date = iso_date(data, "due_date", "Due date")
    if "machine_id" in data:
        machine_id = integer(data, "machine_id", "Machine")
        if job.status in FINISHED_STATUSES and machine_id != job.machine_id:
            raise ValidationError("The machine on a finished job cannot be changed", 409)
        machine = find_machine(job.company_id, machine_id, job.customer_id) if machine_id else None
        job.machine_id = machine.id if machine else None
        if machine:
            job.customer_id = machine.customer_id
    return [field.replace("_id", "").replace("_", " ") for field in EDITABLE_FIELDS if getattr(job, field) != before[field]]


FINISHED_STATUSES = {"Completed", "Cancelled"}


def change_status(job, user, new_status):
    """Move a job to a new status, keeping the worksheet timer and history in step."""
    old_status = job.status
    job.status = new_status
    record_event(job, user, "status", from_status=old_status, to_status=new_status)
    if new_status == "In Progress":
        copy_checklist(job)
        start_timer(job, job.mechanic_id)
    elif new_status in {"Paused", "Completed", "Cancelled"}:
        stop_timer(job)
    if new_status == "Completed":
        fill_service_record(job)


def require_clocked_in(job, user):
    """Job time only runs while the assigned mechanic is on the clock."""
    mechanic = db.session.get(User, job.mechanic_id) if job.mechanic_id else None
    if mechanic and not open_shift(mechanic):
        if user.id == mechanic.id:
            raise ValidationError("Clock in before starting work", 409)
        raise ValidationError(f"{mechanic.name} isn't clocked in, so this job can't be started", 409)


def assign_mechanic(job, mechanic_id, user):
    if mechanic_id == job.mechanic_id:
        return
    if job.status not in REASSIGNABLE:
        raise ValidationError(f"A job that is {job.status} cannot be reassigned", 409)
    old_status = job.status
    if mechanic_id:
        mechanic = find_mechanic(job.company_id, mechanic_id)
        job.mechanic_id = mechanic_id
        job.status = "Assigned"
        record_event(job, user, "assigned", from_status=old_status, to_status=job.status, note=f"Assigned to {mechanic.name}")
        notify(mechanic_id, "New task assigned", f"{job.title} was assigned to you.", "job")
    else:
        job.mechanic_id = None
        job.status = "Pending"
        record_event(job, user, "unassigned", from_status=old_status, to_status=job.status)


def has_recorded_work(job):
    return any(model.query.filter_by(job_id=job.id).first() for model in (WorkEntry, LocationPoint, JobFile))


@bp.delete("/<int:jid>")
@roles("boss")
def delete_job(jid):
    job = Job.query.filter_by(id=jid, company_id=current_user().company_id).first_or_404()
    # A paused job that was reassigned is "Assigned" again, but its recorded work must stay.
    if job.status not in DELETABLE or has_recorded_work(job):
        return jsonify(error="Only jobs that have not started can be deleted. Cancel this job instead."), 409
    delete_job_children(job)
    db.session.delete(job)
    db.session.commit()
    return jsonify(ok=True)
