from flask import Blueprint, jsonify

from app import db
from app.models.constants import DEFAULT_PRIORITY, PRIORITIES
from app.models.customer import Customer
from app.models.equipment import Site
from app.models.job import Job
from app.models.location import LocationPoint
from app.models.machine import Machine
from app.models.request import ServiceRequest
from app.models.media import JobFile
from app.models.user import User
from app.models.worksheet import WorkEntry
from app.services.billing import require_active
from app.services.booking import tell_customer, visit_moved
from app.services.equipment import plan_job_moved, site_label
from app.services.location import shift_at, stamp_job
from app.services.notifications import notify, notify_bosses
from app.services.signature import SIGNATURE_FIELDS, SIGNATURE_PROBLEM, apply_signature, read_signature
from app.services.sync import happened_at
from app.services.worksheet import (
    completion_problems,
    copy_checklist,
    delete_job_children,
    fill_service_record,
    handed_over,
    last_status_event,
    reassigned_problem,
    record_event,
    refresh_checklist,
    start_timer,
    stop_timer,
)
from app.utils.auth import current_user, roles
from app.utils.pages import listing, matches
from app.utils.validation import ValidationError, choice, integer, iso_date, json_body, text
from app.i18n import N_, _, local_time
from app.services import audit

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
        # A visit a customer booked: when, and whether the technician has set off.
        "request_id": job.request_id,
        "visit": job.visit,
        "scheduled_start": job.scheduled_start.isoformat() if job.scheduled_start else None,
        "scheduled_end": job.scheduled_end.isoformat() if job.scheduled_end else None,
        "on_the_way_at": job.on_the_way_at.isoformat() if job.on_the_way_at else None,
    }


def find_machine(company_id, machine_id, customer_id=None):
    machine = Machine.query.filter_by(id=machine_id, company_id=company_id).first()
    if not machine:
        raise ValidationError(_("Equipment not found"), 404)
    if customer_id and machine.customer_id != customer_id:
        raise ValidationError(_("This equipment does not belong to the selected customer"))
    return machine


def find_mechanic(company_id, mechanic_id):
    mechanic = User.query.filter_by(id=mechanic_id, company_id=company_id, role="mechanic").first()
    if not mechanic:
        raise ValidationError(_("Technician not found"), 404)
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
    match = matches([Job.title, Job.description, Job.location, Job.job_type, Job.status])
    if match is not None:
        # A search also finds jobs by their customer's or equipment's name.
        customers = db.select(Customer.id).where(Customer.company_id == user.company_id, matches([Customer.name]))
        machines = db.select(Machine.id).where(Machine.company_id == user.company_id, matches([Machine.name, Machine.serial_no]))
        query = query.filter(db.or_(match, Job.customer_id.in_(customers), Job.machine_id.in_(machines)))
    return listing(query.order_by(Job.id.desc()), "jobs", out)


@bp.post("")
@roles("boss")
def create_job():
    user = current_user()
    require_active(user.company_id, _("add new jobs"))
    data = json_body()
    title = text(data, "title", required=True, max_length=200)
    description = text(data, "description", required=True)
    priority = choice(data, "priority", PRIORITIES, default=DEFAULT_PRIORITY)
    mechanic_id = integer(data, "mechanic_id", "Technician")
    customer_id = integer(data, "customer_id", "Customer")
    machine_id = integer(data, "machine_id", "Equipment")

    if mechanic_id:
        find_mechanic(user.company_id, mechanic_id)
    if customer_id and not Customer.query.filter_by(id=customer_id, company_id=user.company_id).first():
        raise ValidationError(_("Customer not found"), 404)
    machine = find_machine(user.company_id, machine_id, customer_id) if machine_id else None
    if machine:
        customer_id = machine.customer_id
    # The equipment's site, unless another place is given.
    location = text(data, "location", max_length=200) or (site_label(db.session.get(Site, machine.site_id)) if machine and machine.site_id else None)

    job = Job(
        company_id=user.company_id,
        title=title,
        description=description,
        priority=priority,
        job_type=text(data, "job_type", "Job type", max_length=80),
        location=location,
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
        copy_checklist(job)
        notify(job.mechanic_id, N_("New job assigned"), N_("{title} was assigned to you."), "job", title=job.title)
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
            # A start, pause or complete sent from the phone's queue after the job moved on.
            left = handed_over(job, user)
            if left:
                raise reassigned_problem(job, left)
            return jsonify(error=_("Forbidden")), 403
        if set(data) - ({"status"} | LOCATION_FIELDS | SIGNATURE_FIELDS) or "status" not in data:
            return jsonify(error=_("Technicians can only update job status")), 403
        if data["status"] != job.status:
            check_mechanic_order(job)

    if user.role == "boss":
        edited = edit_details(job, data)
        if edited:
            record_event(job, user, "updated", note="Changed " + ", ".join(edited))
        if "job type" in edited:
            refresh_checklist(job)
        if "mechanic_id" in data:
            assign_mechanic(job, integer(data, "mechanic_id", "Technician"), user)

    if "status" in data:
        new_status = data["status"]
        if new_status not in TRANSITIONS:
            raise ValidationError(_("Invalid status"))
        if new_status != job.status:
            if new_status not in TRANSITIONS[job.status]:
                raise ValidationError(_("A job that is {status} cannot be moved to {new_status}", status=_(job.status), new_status=_(new_status)), 409)
            if user.role == "mechanic" and (job.status, new_status) not in MECHANIC_TRANSITIONS:
                raise ValidationError(_("Technicians cannot decline or cancel jobs"), 403)
            if new_status == "Assigned" and not job.mechanic_id:
                raise ValidationError(_("Assign a technician first"), 409)
            if new_status == "In Progress":
                require_clocked_in(job, user)
            sign_off = None
            if new_status == "Completed":
                problems = completion_problems(job)
                sign_off = read_signature(data)
                if not sign_off:
                    problems.append(_(SIGNATURE_PROBLEM))
                if problems:
                    raise ValidationError(
                        _("Can't complete yet: {problems}.", problems="; ".join(problems)),
                        409,
                        blockers=problems,
                        # Only the customer's sign-off is missing: the app opens the signature pad.
                        needs_signature=problems == [_(SIGNATURE_PROBLEM)],
                    )
            change_status(job, user, new_status)
            if sign_off:
                apply_signature(job, user, sign_off)
            if new_status in STAMPED:
                stamp_job(user, job, STAMPED[new_status], data)

    if old_status != job.status and user.role == "mechanic":
        notify_bosses(job.company_id, N_("Job status updated"), N_("{title} is now {status}."), "status", ("status",), title=job.title, status=job.status)
    if old_status != job.status and job.status == "Cancelled" and job.mechanic_id:
        notify(job.mechanic_id, N_("Job cancelled"), N_("{title} was cancelled by your manager."), "job", title=job.title)
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
        machine_id = integer(data, "machine_id", "Equipment")
        if job.status in FINISHED_STATUSES and machine_id != job.machine_id:
            raise ValidationError(_("The equipment on a finished job cannot be changed"), 409)
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
    # A visit a customer booked: their request moves on, and they're told.
    visit_moved(job, old_status, new_status)
    # Planned maintenance: the plan's next due date moves on.
    plan_job_moved(job, new_status, happened_at())


ON_THE_WAY_STATUSES = {"Assigned", "Accepted"}


@bp.post("/<int:jid>/on-the-way")
@roles("mechanic")
def on_the_way(jid):
    """The technician sets off for a booked visit: the customer is told (in the app and by email)."""
    user = current_user()
    job = Job.query.filter_by(id=jid, company_id=user.company_id).first_or_404()
    if job.mechanic_id != user.id:
        left = handed_over(job, user)
        if left:
            raise reassigned_problem(job, left)
        return jsonify(error=_("Forbidden")), 403
    if job.on_the_way_at:
        return jsonify(job=out(job))
    if job.status not in ON_THE_WAY_STATUSES:
        raise ValidationError(_("\"On my way\" is for a visit that hasn't started."), 409)
    service_request = db.session.get(ServiceRequest, job.request_id) if job.request_id else None
    job.on_the_way_at = happened_at()
    record_event(job, user, "on_the_way")
    if service_request:
        tell_customer(
            service_request,
            N_("Technician on the way"),
            N_("{name} is on the way for {subject}."),
            "status",
            button=N_("Follow your request"),
            name=user.name,
            subject=service_request.subject,
        )
    db.session.commit()
    return jsonify(job=out(job))


def check_mechanic_order(job):
    """A status change made offline is refused when the job has moved on since: cancelled, or
    changed after it was made (its time would put it out of order in the history)."""
    at = happened_at()
    if job.status == "Cancelled":
        cancelled = last_status_event(job, "Cancelled")
        raise ValidationError(_("This job was cancelled at {time}.", time=local_time(cancelled.created_at if cancelled else None)), 409)
    last = last_status_event(job)
    if last and at < last.created_at:
        raise ValidationError(
            _("This change was made at {time}, before the job's last update at {last}, so it wasn't applied.", time=local_time(at), last=local_time(last.created_at)),
            409,
        )


def require_clocked_in(job, user):
    """Job time only runs while the assigned mechanic is on the clock."""
    mechanic = db.session.get(User, job.mechanic_id) if job.mechanic_id else None
    if mechanic and not shift_at(mechanic, happened_at()):
        if user.id == mechanic.id:
            raise ValidationError(_("Clock in before starting work"), 409)
        raise ValidationError(_("{name} isn't clocked in, so this job can't be started", name=mechanic.name), 409)


def assign_mechanic(job, mechanic_id, user):
    if mechanic_id == job.mechanic_id:
        return
    if job.status not in REASSIGNABLE:
        raise ValidationError(_("A job that is {status} cannot be reassigned", status=_(job.status)), 409)
    old_status, previous = job.status, job.mechanic_id
    if mechanic_id:
        mechanic = find_mechanic(job.company_id, mechanic_id)
        job.mechanic_id = mechanic_id
        job.status = "Assigned"
        record_event(job, user, "assigned", from_status=old_status, to_status=job.status, note=f"Assigned to {mechanic.name}", previous_mechanic_id=previous)
        copy_checklist(job)
        notify(mechanic_id, N_("New job assigned"), N_("{title} was assigned to you."), "job", title=job.title)
    else:
        job.mechanic_id = None
        job.status = "Pending"
        record_event(job, user, "unassigned", from_status=old_status, to_status=job.status, previous_mechanic_id=previous)


def has_recorded_work(job):
    return any(model.query.filter_by(job_id=job.id).first() for model in (WorkEntry, LocationPoint, JobFile))


@bp.delete("/<int:jid>")
@roles("boss")
def delete_job(jid):
    job = Job.query.filter_by(id=jid, company_id=current_user().company_id).first_or_404()
    # A paused job that was reassigned is "Assigned" again, but its recorded work must stay.
    if job.status not in DELETABLE or has_recorded_work(job):
        return jsonify(error=_("Only jobs that have not started can be deleted. Cancel this job instead.")), 409
    delete_job_children(job)
    audit.record("job_deleted", user=current_user(), detail=job.title)
    db.session.delete(job)
    db.session.commit()
    return jsonify(ok=True)
