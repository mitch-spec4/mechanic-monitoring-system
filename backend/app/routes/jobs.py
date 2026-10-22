from flask import Blueprint, jsonify

from app import db
from app.models.constants import DEFAULT_PRIORITY, PRIORITIES
from app.models.customer import Customer
from app.models.job import Job
from app.models.machine import Machine
from app.models.user import User
from app.services.notifications import notify, notify_bosses
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


def out(job):
    return {
        "id": job.id,
        "title": job.title,
        "description": job.description,
        "priority": job.priority,
        "status": job.status,
        "location": job.location,
        "due_date": job.due_date.isoformat() if job.due_date else None,
        "customer_id": job.customer_id,
        "machine_id": job.machine_id,
        "mechanic_id": job.mechanic_id,
    }


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
    machine = None
    if machine_id:
        machine = Machine.query.filter_by(id=machine_id, company_id=user.company_id).first()
        if not machine:
            raise ValidationError("Machine not found", 404)
        if customer_id and machine.customer_id != customer_id:
            raise ValidationError("Machine does not belong to the selected customer")
        customer_id = machine.customer_id

    job = Job(
        company_id=user.company_id,
        title=title,
        description=description,
        priority=priority,
        location=text(data, "location", max_length=200),
        due_date=iso_date(data, "due_date", "Due date"),
        customer_id=customer_id,
        machine_id=machine.id if machine else None,
        mechanic_id=mechanic_id,
        status="Assigned" if mechanic_id else "Pending",
    )
    db.session.add(job)
    db.session.flush()
    if job.mechanic_id:
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
        if set(data) - {"status"} or "status" not in data:
            return jsonify(error="Mechanics can only update job status"), 403

    if user.role == "boss":
        if "title" in data:
            job.title = text(data, "title", required=True, max_length=200)
        if "description" in data:
            job.description = text(data, "description", required=True)
        if "priority" in data:
            job.priority = choice(data, "priority", PRIORITIES, default=job.priority)
        if "location" in data:
            job.location = text(data, "location", max_length=200)
        if "due_date" in data:
            job.due_date = iso_date(data, "due_date", "Due date")
        if "mechanic_id" in data:
            assign_mechanic(job, integer(data, "mechanic_id", "Mechanic"))

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
            job.status = new_status

    if old_status != job.status and user.role == "mechanic":
        notify_bosses(job.company_id, "Job status updated", f"{job.title} is now {job.status}.", "status")
    if old_status != job.status and job.status == "Cancelled" and job.mechanic_id:
        notify(job.mechanic_id, "Job cancelled", f"{job.title} was cancelled by your manager.", "job")
    db.session.commit()
    return jsonify(job=out(job))


def assign_mechanic(job, mechanic_id):
    if mechanic_id == job.mechanic_id:
        return
    if job.status not in REASSIGNABLE:
        raise ValidationError(f"A job that is {job.status} cannot be reassigned", 409)
    if mechanic_id:
        find_mechanic(job.company_id, mechanic_id)
        job.mechanic_id = mechanic_id
        job.status = "Assigned"
        notify(mechanic_id, "New task assigned", f"{job.title} was assigned to you.", "job")
    else:
        job.mechanic_id = None
        job.status = "Pending"


@bp.delete("/<int:jid>")
@roles("boss")
def delete_job(jid):
    job = Job.query.filter_by(id=jid, company_id=current_user().company_id).first_or_404()
    if job.status not in DELETABLE:
        return jsonify(error="Only jobs that have not started can be deleted. Cancel this job instead."), 409
    db.session.delete(job)
    db.session.commit()
    return jsonify(ok=True)
