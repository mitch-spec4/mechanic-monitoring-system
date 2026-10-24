"""Customers' service requests and the visits booked for them (see app/services/booking.py)."""
from datetime import datetime, timezone

from flask import Blueprint, jsonify

from app import db
from app.models.company import Company
from app.models.constants import CLOSED_REQUEST_STATUSES, DEFAULT_PRIORITY, MANUAL_REQUEST_STATUSES, PRIORITIES
from app.models.customer import Customer
from app.models.equipment import Site
from app.models.job import Job
from app.models.machine import Machine
from app.models.media import JobFile
from app.models.request import ServiceRequest
from app.models.service_record import ServiceRecord
from app.models.user import User
from app.routes.jobs import assign_mechanic, change_status
from app.services import booking
from app.services.billing import state, subscription_for
from app.services.equipment import site_label
from app.services.notifications import notify, notify_bosses
from app.services.worksheet import record_event
from app.utils.auth import current_user, roles
from app.utils.pages import listing, searched
from app.utils.validation import ValidationError, choice, integer, json_body, text
from app.i18n import N_, _

bp = Blueprint("requests", __name__)


def iso(value):
    return value.isoformat() if value else None


def request_out(service_request):
    return {
        "id": service_request.id,
        "machine_id": service_request.machine_id,
        "customer_id": service_request.customer_id,
        "subject": service_request.subject,
        "description": service_request.description,
        "priority": service_request.priority,
        "status": service_request.status,
        "created_at": service_request.created_at.isoformat(),
        "updated_at": iso(service_request.updated_at),
    }


def visit_out(job, user):
    """A visit as the request page shows it; once done, what was found and the photos."""
    technician = db.session.get(User, job.mechanic_id) if job.mechanic_id else None
    visit = {
        "job_id": job.id,
        "visit": job.visit,
        "status": job.status,
        "scheduled_start": iso(job.scheduled_start),
        "scheduled_end": iso(job.scheduled_end),
        "on_the_way_at": iso(job.on_the_way_at),
        "technician": {"id": technician.id, "name": technician.name} if technician else None,
        "findings": None,
        "photos": [],
    }
    if job.status == "Completed":
        record = ServiceRecord.query.filter_by(job_id=job.id).first()
        if record:
            visit["findings"] = {"problem": record.problem, "solution": record.solution, "advice": record.advice, "work_done": record.work_done}
        files = JobFile.query.filter(JobFile.job_id == job.id, JobFile.status == "ready", JobFile.kind != "signature").order_by(JobFile.created_at, JobFile.id)
        visit["photos"] = [{"id": f.id, "kind": f.kind, "content_type": f.content_type, "url": f"/api/files/{f.id}"} for f in files.all()]
    return visit


def detail_out(service_request, user):
    company = db.session.get(Company, service_request.company_id)
    machine = db.session.get(Machine, service_request.machine_id)
    customer = db.session.get(Customer, service_request.customer_id)
    upcoming = booking.upcoming_visit(service_request)
    to_book = booking.visit_to_book(service_request)
    closed = service_request.status in CLOSED_REQUEST_STATUSES
    return {
        **request_out(service_request),
        "machine": {"id": machine.id, "name": machine.name, "serial_no": machine.serial_no} if machine else None,
        "customer": {"id": customer.id, "name": customer.name} if customer else None,
        "repair_minutes": booking.visit_minutes(company, service_request, "repair"),
        "inspection_minutes": company.inspection_minutes,
        "visits": [visit_out(job, user) for job in booking.visits_of(service_request)],
        # What can be booked now: the next visit, or a new time for the one booked.
        "can_book": None if closed else to_book if not upcoming else None,
        "can_move": bool(upcoming and not closed),
        "can_cancel": not closed and not booking.visit_in_progress(service_request),
    }


def load_request(rid):
    """A request the current user may see: any in their company for a manager, their own for a customer."""
    user = current_user()
    query = ServiceRequest.query.filter_by(id=rid, company_id=user.company_id)
    if user.role == "customer":
        query = query.filter_by(customer_id=user.customer_id)
    return query.first_or_404()


@bp.get("")
@roles("boss", "customer")
def requests_list():
    user = current_user()
    query = ServiceRequest.query.filter_by(company_id=user.company_id)
    if user.role == "customer":
        query = query.filter_by(customer_id=user.customer_id)
    columns = [ServiceRequest.subject, ServiceRequest.description, ServiceRequest.status]
    return listing(searched(query, columns).order_by(ServiceRequest.id.desc()), "requests", request_out)


@bp.post("")
@roles("customer")
def create_request():
    user = current_user()
    data = json_body()
    machine_id = integer(data, "machine_id", "Equipment", required=True)
    machine = Machine.query.filter_by(id=machine_id, customer_id=user.customer_id, company_id=user.company_id).first()
    if not machine:
        raise ValidationError(_("Equipment not found"), 404)

    service_request = ServiceRequest(
        customer_id=user.customer_id,
        company_id=user.company_id,
        machine_id=machine.id,
        subject=text(data, "subject", "Subject", required=True, max_length=180),
        description=text(data, "description", "Description", required=True),
        priority=choice(data, "priority", PRIORITIES, default=DEFAULT_PRIORITY),
    )
    db.session.add(service_request)
    notify_bosses(user.company_id, N_("New customer service request"), N_("{subject} was submitted."), "request", subject=service_request.subject)
    db.session.commit()
    return jsonify(id=service_request.id), 201


@bp.get("/<int:rid>")
@roles("boss", "customer")
def request_detail(rid):
    service_request = load_request(rid)
    return jsonify(request=detail_out(service_request, current_user()))


@bp.get("/<int:rid>/slots")
@roles("boss", "customer")
def request_slots(rid):
    """The times free for the next visit, or for moving the visit that's booked."""
    service_request = load_request(rid)
    company = db.session.get(Company, service_request.company_id)
    moving = booking.upcoming_visit(service_request)
    visit = moving.visit if moving else booking.visit_to_book(service_request)
    if not visit or service_request.status in CLOSED_REQUEST_STATUSES:
        return jsonify(visit=None, minutes=None, slots=[])
    minutes = booking.visit_minutes(company, service_request, visit)
    slots = booking.free_slots(company, minutes, ignore_job_id=moving.id if moving else None)
    return jsonify(
        visit=visit,
        minutes=minutes,
        moving=moving.id if moving else None,
        slots=[{"start": iso(slot.start), "end": iso(slot.end)} for slot in slots],
    )


def visit_site(service_request):
    """Where the visit is: the equipment's site."""
    machine = db.session.get(Machine, service_request.machine_id)
    return site_label(db.session.get(Site, machine.site_id)) if machine and machine.site_id else None


def booking_time(data):
    value = data.get("start")
    if value in (None, ""):
        raise ValidationError(_("{label} is required", label=_("Time")))
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise ValidationError(_("{label} must be a date and time", label=_("Time"))) from None
    if moment.tzinfo:
        moment = moment.astimezone(timezone.utc).replace(tzinfo=None)
    return moment.replace(microsecond=0)


@bp.post("/<int:rid>/book")
@roles("boss", "customer")
def book(rid):
    """Book the next visit at a free time, or move the booked one that hasn't started."""
    user = current_user()
    service_request = load_request(rid)
    start = booking_time(json_body())
    company = booking.lock_company(service_request.company_id)
    subscription = subscription_for(company.id)
    if subscription and state(subscription) == "expired":
        raise ValidationError(_("Online booking isn't available right now. Please send {company} a message instead.", company=company.name), 409)
    if service_request.status in CLOSED_REQUEST_STATUSES:
        raise ValidationError(_("This request is closed."), 409)
    job = booking.upcoming_visit(service_request)
    visit = job.visit if job else booking.visit_to_book(service_request)
    if not visit:
        raise ValidationError(_("There's nothing to book for this request right now."), 409)
    minutes = booking.visit_minutes(company, service_request, visit)
    slot = booking.find_slot(company, minutes, start, ignore_job_id=job.id if job else None)
    if not slot:
        raise ValidationError(_("That time isn't free any more. Please pick another."), 409)

    moved = job is not None
    if job:
        job.scheduled_start, job.scheduled_end = slot.start, slot.end
        job.due_date = booking.visit_day(company, slot.start)
        job.on_the_way_at = None
        # The note is the new time, shown in the reader's time zone.
        record_event(job, user, "rescheduled", note=iso(slot.start))
        if job.mechanic_id not in slot.technicians:
            assign_mechanic(job, booking.pick_technician(company, slot), user)
    else:
        job = Job(
            company_id=company.id,
            title=service_request.subject,
            description=service_request.description,
            priority=service_request.priority,
            job_type="Inspection" if visit == "inspection" else "Repair",
            due_date=booking.visit_day(company, slot.start),
            location=visit_site(service_request),
            customer_id=service_request.customer_id,
            machine_id=service_request.machine_id,
            status="Pending",
            request_id=service_request.id,
            visit=visit,
            scheduled_start=slot.start,
            scheduled_end=slot.end,
        )
        db.session.add(job)
        db.session.flush()
        record_event(job, user, "created", to_status=job.status, note="booked")
        assign_mechanic(job, booking.pick_technician(company, slot), user)
        booking.set_status(service_request, booking.BOOKED[visit])
    booking.remind_soon(job, company)
    booking.confirm_booking(service_request, job, moved)
    db.session.commit()
    return jsonify(request=detail_out(service_request, user))


def close_request(service_request, status, user):
    """Declined or cancelled: visits that haven't started are cancelled; one under way must be
    finished or cancelled first."""
    if booking.visit_in_progress(service_request):
        raise ValidationError(_("A visit is under way. Finish or cancel it first."), 409)
    booking.set_status(service_request, status)
    for job in Job.query.filter(Job.request_id == service_request.id, Job.status.in_(booking.NOT_STARTED)).all():
        change_status(job, user, "Cancelled")
        if job.mechanic_id and user.role == "customer":
            notify(job.mechanic_id, N_("Job cancelled"), N_("{title} was cancelled by the customer."), "job", title=job.title)
        elif job.mechanic_id:
            notify(job.mechanic_id, N_("Job cancelled"), N_("{title} was cancelled by your manager."), "job", title=job.title)


@bp.post("/<int:rid>/cancel")
@roles("customer")
def cancel_request(rid):
    user = current_user()
    service_request = load_request(rid)
    if service_request.status in CLOSED_REQUEST_STATUSES:
        raise ValidationError(_("This request is closed."), 409)
    close_request(service_request, "Cancelled", user)
    customer = db.session.get(Customer, service_request.customer_id)
    notify_bosses(
        service_request.company_id,
        N_("Request cancelled"),
        N_("{customer} cancelled the request {subject}."),
        "request",
        customer=customer.name if customer else "",
        subject=service_request.subject,
    )
    db.session.commit()
    return jsonify(request=detail_out(service_request, user))


@bp.patch("/<int:rid>")
@roles("boss")
def update_request(rid):
    """A manager sets a step by hand (declines, cancels...) or how long the repair takes."""
    user = current_user()
    service_request = ServiceRequest.query.filter_by(id=rid, company_id=user.company_id).first_or_404()
    company = db.session.get(Company, service_request.company_id)
    data = json_body()
    if "repair_minutes" in data:
        minutes = integer(data, "repair_minutes", "Repair length (minutes)", required=True, minimum=30, maximum=24 * 60)
        if minutes > booking.working_minutes(company):
            raise ValidationError(_("A visit has to fit in one working day ({count} minutes).", count=booking.working_minutes(company)))
        service_request.repair_minutes = minutes
    status = choice(data, "status", MANUAL_REQUEST_STATUSES, "Status", default=service_request.status)
    if status != service_request.status:
        if status in ("Declined", "Cancelled"):
            close_request(service_request, status, user)
            if status == "Declined":
                booking.tell_customer(
                    service_request,
                    N_("Request declined"),
                    N_("{company} can't take on your request {subject}. Send them a message if you have questions."),
                    company=company.name,
                    subject=service_request.subject,
                )
            else:
                booking.tell_customer(service_request, N_("Request cancelled"), N_("Your request {subject} was cancelled."), subject=service_request.subject)
        else:
            if booking.upcoming_visit(service_request) or booking.visit_in_progress(service_request):
                raise ValidationError(_("This request has a visit booked. Cancel the visit first."), 409)
            booking.set_status(service_request, status)
            for customer_user in booking.customer_users(service_request.company_id, service_request.customer_id):
                notify(customer_user.id, N_("Service request updated"), N_("Your request is now {status}."), "request", ("status",), status=status)
    db.session.commit()
    return jsonify(ok=True, status=service_request.status, request=detail_out(service_request, user))
