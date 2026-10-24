"""Online booking: a customer's request becomes visits at times they pick.

The steps of a request: Submitted → the customer books an inspection ("Inspection booked") → the
technician inspects and completes that visit ("Inspected": the findings and photos are shared)
→ the customer books the repair ("Repair booked") → it is completed ("Completed"). Quotes and
payments stay out of the app: customers ask the managers in the chat. A manager can decline or
cancel a request, or set a step by hand.

Each visit is a job (request_id, visit, scheduled_start/end). The times offered:

- start on the hour grid from the company's opening time, on its booking days, end by closing
  time, at least `booking_notice_hours` from now and at most `booking_window_days` ahead;
- a time is free when a technician has no other booked visit within the travel time of it
  (`travel_minutes` before and after). Visits not yet given a technician take one technician each.
  Jobs without a booked time (planned by a manager with a due date) don't block times.

A booked visit goes to the free technician with the fewest visits that day; the manager can change
it. Customers get a confirmation, a reminder the day before, "on the way" and progress updates in
the app and by email, a reminder to book the repair 3 days after the inspection, and a follow-up
the day after the work is done (sent by the daily maintenance run).
"""
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app import db
from app.models.company import Company
from app.models.constants import ACTIVE_JOB_STATUSES, CLOSED_REQUEST_STATUSES
from app.models.customer import Customer
from app.models.job import Job
from app.models.request import ServiceRequest
from app.models.user import User
from app.services.email import app_link, layout, send_email
from app.services.notifications import notify, notify_bosses
from app.utils.time import utcnow
from app.i18n import N_, _, local_time, speaking

# Times are offered on this grid (minutes), from the opening time.
STEP_MINUTES = 60
# A visit that hasn't started can be moved or cancelled.
NOT_STARTED = ("Pending", "Assigned", "Accepted")
STARTED = ("In Progress", "Paused")
REPAIR_REMINDER_AFTER = timedelta(days=3)
FOLLOW_UP_AFTER = timedelta(days=1)
# The words for a visit, inside sentences ("Your inspection for ... is booked").
VISIT_WORDS = {"inspection": N_("inspection"), "repair": N_("repair")}
# The status a request is at once a visit is booked, done, or cancelled before it started.
BOOKED = {"inspection": "Inspection booked", "repair": "Repair booked"}
DONE = {"inspection": "Inspected", "repair": "Completed"}
WAITING = {"inspection": "Submitted", "repair": "Inspected"}


@dataclass
class Slot:
    start: datetime
    end: datetime
    # Technicians with nothing else booked around this time.
    technicians: list = field(default_factory=list)


def minutes_of(clock):
    hours, minutes = clock.split(":")
    return int(hours) * 60 + int(minutes)


def working_minutes(company):
    return minutes_of(company.booking_end) - minutes_of(company.booking_start)


def visit_minutes(company, service_request, visit):
    if visit == "repair":
        return service_request.repair_minutes or company.repair_minutes
    return company.inspection_minutes


def visits_of(service_request):
    return Job.query.filter_by(request_id=service_request.id).order_by(Job.scheduled_start, Job.id).all()


def upcoming_visit(service_request):
    """The booked visit that hasn't started yet: it can be moved to another time."""
    return Job.query.filter(Job.request_id == service_request.id, Job.status.in_(NOT_STARTED)).order_by(Job.id.desc()).first()


def visit_in_progress(service_request):
    return Job.query.filter(Job.request_id == service_request.id, Job.status.in_(STARTED)).first()


def visit_to_book(service_request):
    """What the customer books next: an inspection for a new request, the repair once inspected."""
    if service_request.status == "Submitted":
        return "inspection"
    if service_request.status == "Inspected":
        return "repair"
    return None


def as_utc(moment, zone):
    return datetime.combine(moment.date(), moment.time(), tzinfo=zone).astimezone(timezone.utc).replace(tzinfo=None)


def local_date(moment, zone):
    return moment.replace(tzinfo=timezone.utc).astimezone(zone).date()


def visit_day(company, moment):
    """The company's calendar day a visit is on (the job's due date)."""
    return local_date(moment, ZoneInfo(company.timezone))


def free_slots(company, minutes, ignore_job_id=None, now=None):
    """The times a visit of this length can start, oldest first, each with its free technicians."""
    now = now or utcnow()
    zone = ZoneInfo(company.timezone)
    earliest = now + timedelta(hours=company.booking_notice_hours)
    latest = now + timedelta(days=company.booking_window_days)
    days = {int(day) for day in company.booking_days.split(",") if day}
    opens, closes = minutes_of(company.booking_start), minutes_of(company.booking_end)
    length = timedelta(minutes=minutes)
    travel = timedelta(minutes=company.travel_minutes)
    technicians = [user.id for user in User.query.filter_by(company_id=company.id, role="mechanic").order_by(User.id).all()]
    if not technicians:
        return []
    query = Job.query.filter(
        Job.company_id == company.id,
        Job.scheduled_start.isnot(None),
        Job.status.in_(ACTIVE_JOB_STATUSES),
        Job.scheduled_start < latest + length + travel,
        Job.scheduled_end > earliest - travel,
    )
    if ignore_job_id:
        query = query.filter(Job.id != ignore_job_id)
    booked = query.all()
    slots = []
    day, last_day = local_date(earliest, zone), local_date(latest, zone)
    while day <= last_day:
        if day.isoweekday() in days:
            minute = opens
            while minute + minutes <= closes:
                start = as_utc(datetime.combine(day, time(minute // 60, minute % 60)), zone)
                end = start + length
                if earliest <= start <= latest:
                    free = free_technicians(start, end, booked, technicians, travel)
                    if free:
                        slots.append(Slot(start, end, free))
                minute += STEP_MINUTES
        day += timedelta(days=1)
    return slots


def free_technicians(start, end, booked, technicians, travel):
    """Technicians free from `start` to `end`, with the travel time either side; none when the
    visits without a technician yet would take every free one."""
    around = [job for job in booked if job.scheduled_start < end + travel and job.scheduled_end + travel > start]
    busy = {job.mechanic_id for job in around if job.mechanic_id}
    free = [technician for technician in technicians if technician not in busy]
    unassigned = sum(1 for job in around if not job.mechanic_id)
    return free if len(free) > unassigned else []


def pick_technician(company, slot):
    """The free technician with the fewest visits booked that day (the first one on a tie)."""
    zone = ZoneInfo(company.timezone)
    day = local_date(slot.start, zone)
    first = as_utc(datetime.combine(day, time()), zone)
    counts = {technician: 0 for technician in slot.technicians}
    for job in Job.query.filter(
        Job.company_id == company.id,
        Job.mechanic_id.in_(slot.technicians),
        Job.status.in_(ACTIVE_JOB_STATUSES),
        Job.scheduled_start >= first,
        Job.scheduled_start < first + timedelta(days=1),
    ).all():
        counts[job.mechanic_id] += 1
    return min(slot.technicians, key=lambda technician: (counts[technician], technician))


def find_slot(company, minutes, start, ignore_job_id=None):
    return next((slot for slot in free_slots(company, minutes, ignore_job_id) if slot.start == start), None)


def lock_company(company_id):
    """Bookings for one company happen one at a time (PostgreSQL), so two customers can't both
    take the last technician free at a time."""
    return db.session.query(Company).filter_by(id=company_id).with_for_update().one()


def remind_soon(job, company, now=None):
    """A visit booked for today or tomorrow needs no separate reminder: the confirmation is it."""
    zone = ZoneInfo(company.timezone)
    today = local_date(now or utcnow(), zone)
    job.reminder_sent_at = utcnow() if local_date(job.scheduled_start, zone) <= today + timedelta(days=1) else None


def customer_users(company_id, customer_id):
    return User.query.filter_by(company_id=company_id, customer_id=customer_id, role="customer").all()


def tell_customer(service_request, title, message, kind="request", email=True, button=None, **values):
    """Tell the customer's people, in the app and (by default) by email, each in their own language.
    Datetime values are written as the company's local time; `visit` is translated."""
    company = db.session.get(Company, service_request.company_id)
    link = app_link(f"/requests/{service_request.id}")
    for user in customer_users(service_request.company_id, service_request.customer_id):
        with speaking(user.language):
            written = {
                key: local_time(value, company.timezone) if isinstance(value, datetime) else _(value) if key == "visit" else value
                for key, value in values.items()
            }
            notify(user.id, title, message, kind, (), **written)
            if email:
                paragraphs = [_(message, **written)]
                label = _(button or N_("Open your request"))
                send_email(
                    user.email,
                    _(title),
                    "\n\n".join([*paragraphs, f"{label}: {link}"]),
                    layout(_(title), paragraphs, (label, link)),
                    company_id=service_request.company_id,
                )


def tell_staff(job, title, message, kind="request", **values):
    """Managers and the visit's technician, in the app."""
    company = db.session.get(Company, job.company_id)
    people = User.query.filter_by(company_id=job.company_id, role="boss").all()
    if job.mechanic_id:
        people.append(db.session.get(User, job.mechanic_id))
    for user in people:
        with speaking(user.language):
            written = {
                key: local_time(value, company.timezone) if isinstance(value, datetime) else _(value) if key == "visit" else value
                for key, value in values.items()
            }
            notify(user.id, title, message, kind, (), **written)


def customer_name(service_request):
    customer = db.session.get(Customer, service_request.customer_id)
    return customer.name if customer else ""


def set_status(service_request, status):
    service_request.status = status
    service_request.updated_at = utcnow()
    if status == "Inspected":
        service_request.inspected_at = utcnow()
        service_request.repair_reminder_sent_at = None
    if status == "Completed":
        service_request.completed_at = utcnow()


def confirm_booking(service_request, job, moved):
    """After a visit is booked or moved: the customer, the managers and the technician are told."""
    values = {"visit": VISIT_WORDS[job.visit], "subject": service_request.subject, "time": job.scheduled_start}
    if moved:
        tell_customer(service_request, N_("Visit moved"), N_("Your {visit} for {subject} is now on {time}."), **values)
        tell_staff(job, N_("Visit moved"), N_("{customer} moved the {visit} for {subject} to {time}."), customer=customer_name(service_request), **values)
    else:
        tell_customer(service_request, N_("Visit booked"), N_("Your {visit} for {subject} is booked for {time}."), **values)
        notify_bosses(
            service_request.company_id,
            N_("Visit booked"),
            N_("{customer} booked a visit for {subject}."),
            "request",
            customer=customer_name(service_request),
            subject=service_request.subject,
        )


def visit_moved(job, old_status, new_status):
    """A visit's job changed status: the request follows, and the customer hears about it."""
    service_request = db.session.get(ServiceRequest, job.request_id) if job.request_id else None
    if not service_request or job.visit not in BOOKED:
        return
    values = {"visit": VISIT_WORDS[job.visit], "subject": service_request.subject}
    technician = db.session.get(User, job.mechanic_id) if job.mechanic_id else None
    if new_status == "In Progress" and old_status in NOT_STARTED:
        tell_customer(
            service_request, N_("Work started"), N_("{name} started the {visit} for {subject}."), "status", email=False, name=technician.name if technician else "", **values
        )
    elif new_status == "Completed" and service_request.status not in CLOSED_REQUEST_STATUSES:
        set_status(service_request, DONE[job.visit])
        if job.visit == "inspection":
            tell_customer(
                service_request,
                N_("Inspection findings ready"),
                N_("The inspection of {subject} is done. See what was found and pick a time for the repair."),
                "status",
                button=N_("See the findings"),
                **values,
            )
        else:
            tell_customer(service_request, N_("Repair completed"), N_("The repair for {subject} is done."), "status", **values)
    elif new_status == "Cancelled" and old_status in NOT_STARTED and service_request.status == BOOKED[job.visit]:
        # Cancelled by the company before it started: the customer picks another time.
        set_status(service_request, WAITING[job.visit])
        if job.scheduled_start:
            tell_customer(
                service_request,
                N_("Visit cancelled"),
                N_("Your {visit} for {subject} on {time} was cancelled. Please pick a new time."),
                "status",
                time=job.scheduled_start,
                **values,
            )


def send_reminders(now=None):
    """The daily run: visit reminders the day before, a nudge to book the repair, the follow-up."""
    now = now or utcnow()
    sent = {"visit_reminders": 0, "repair_reminders": 0, "follow_ups": 0}
    for job in Job.query.filter(
        Job.request_id.isnot(None),
        Job.reminder_sent_at.is_(None),
        Job.status.in_(NOT_STARTED),
        Job.scheduled_start > now,
        Job.scheduled_start < now + timedelta(days=3),
    ).all():
        company = db.session.get(Company, job.company_id)
        zone = ZoneInfo(company.timezone)
        if local_date(job.scheduled_start, zone) > local_date(now, zone) + timedelta(days=1):
            continue
        service_request = db.session.get(ServiceRequest, job.request_id)
        job.reminder_sent_at = now
        tell_customer(
            service_request,
            N_("Visit reminder"),
            N_("Reminder: your {visit} for {subject} is on {time}."),
            visit=VISIT_WORDS.get(job.visit, job.visit),
            subject=service_request.subject,
            time=job.scheduled_start,
        )
        sent["visit_reminders"] += 1
    for service_request in ServiceRequest.query.filter(
        ServiceRequest.status == "Inspected",
        ServiceRequest.repair_reminder_sent_at.is_(None),
        ServiceRequest.inspected_at <= now - REPAIR_REMINDER_AFTER,
    ).all():
        service_request.repair_reminder_sent_at = now
        tell_customer(
            service_request,
            N_("Pick a time for the repair"),
            N_("The inspection of {subject} is done. Pick a time for the repair, or message us with any questions."),
            subject=service_request.subject,
        )
        sent["repair_reminders"] += 1
    for service_request in ServiceRequest.query.filter(
        ServiceRequest.status == "Completed",
        ServiceRequest.follow_up_sent_at.is_(None),
        ServiceRequest.completed_at <= now - FOLLOW_UP_AFTER,
    ).all():
        service_request.follow_up_sent_at = now
        tell_customer(
            service_request,
            N_("How did it go?"),
            N_("The work on {subject} is done. If anything isn't right, send us a message. You can also leave a review."),
            "review",
            subject=service_request.subject,
        )
        sent["follow_ups"] += 1
    return sent
