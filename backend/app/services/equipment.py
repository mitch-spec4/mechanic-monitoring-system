"""Equipment over time: maintenance plans and their reminders, and repeat faults.

Maintenance plans. A plan says a piece of equipment needs the same service every N days, weeks or
months, from `next_due`. When it comes due (`lead_days` ahead of next_due), the daily run creates
its job (Pending, for a manager to assign) unless one already exists for that due date, and tells
the managers and the customer, once per due date. Completing a plan's job moves next_due on from
the day it was done; a manager can also mark it done without a job, or create the job early.

Repeat faults. A piece of equipment has a repeat fault when it needed fixing twice or more in 90
days: completed jobs that weren't routine maintenance (no plan, and "maintenance" isn't in the job
type), with an inspection and the repair booked for the same request counted once. Service records
from before jobs had worksheets count too.
"""
import calendar
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app import db
from app.models.company import Company
from app.models.equipment import MaintenancePlan, Site
from app.models.job import Job
from app.models.machine import Machine
from app.models.service_record import ServiceRecord
from app.models.user import User
from app.services.billing import has_feature
from app.services.email import app_link, layout, send_email
from app.services.notifications import notify
from app.services.worksheet import record_event
from app.utils.time import utcnow
from app.i18n import MONTHS, N_, _, speaking

UNITS = ("days", "weeks", "months")
UNIT_WORDS = {"days": N_("days"), "weeks": N_("weeks"), "months": N_("months")}
OPEN_STATUSES = ("Pending", "Assigned", "Accepted", "In Progress", "Paused")
REPEAT_FAULT_DAYS = 90
REPEAT_FAULT_COUNT = 2


def add_interval(start, every, unit):
    if unit == "days":
        return start + timedelta(days=every)
    if unit == "weeks":
        return start + timedelta(weeks=every)
    # Months: the same day of the month, or the month's last day (31 Jan + 1 month = 28 Feb).
    months = start.month - 1 + every
    year, month = start.year + months // 12, months % 12 + 1
    return date(year, month, min(start.day, calendar.monthrange(year, month)[1]))


def company_today(company):
    return datetime.now(timezone.utc).astimezone(ZoneInfo(company.timezone)).date()


def plan_state(plan, today):
    """overdue, due (within its lead time) or scheduled; paused when switched off."""
    if not plan.active:
        return "paused"
    if plan.next_due < today:
        return "overdue"
    if plan.next_due <= today + timedelta(days=plan.lead_days):
        return "due"
    return "scheduled"


def open_job(plan):
    return Job.query.filter(Job.plan_id == plan.id, Job.status.in_(OPEN_STATUSES)).order_by(Job.id.desc()).first()


def site_label(site):
    if not site:
        return None
    return f"{site.name}, {site.address}" if site.address else site.name


def create_plan_job(plan, user=None):
    """The job for the plan's next due date, waiting for a manager to assign it."""
    machine = db.session.get(Machine, plan.machine_id)
    site = db.session.get(Site, machine.site_id) if machine.site_id else None
    job = Job(
        company_id=plan.company_id,
        title=f"{plan.title}: {machine.name}",
        description=f"Planned maintenance, every {plan.every} {plan.unit}.",
        job_type=plan.job_type,
        location=site_label(site),
        due_date=plan.next_due,
        customer_id=machine.customer_id,
        machine_id=machine.id,
        status="Pending",
        plan_id=plan.id,
    )
    db.session.add(job)
    db.session.flush()
    record_event(job, user, "created", to_status=job.status, note="planned")
    return job


def plan_job_moved(job, new_status, done_at):
    """A plan's job was completed: the plan's next due date moves on from that day."""
    if not job.plan_id or new_status != "Completed":
        return
    plan = db.session.get(MaintenancePlan, job.plan_id)
    if plan:
        company = db.session.get(Company, plan.company_id)
        mark_done(plan, done_at.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(company.timezone)).date())


def mark_done(plan, done_on):
    plan.last_done = done_on
    plan.next_due = add_interval(done_on, plan.every, plan.unit)
    plan.reminded_for = None


def is_routine(job):
    return bool(job.plan_id) or "maintenance" in (job.job_type or "").lower()


def fault_counts(company_id, machine_ids, now=None):
    """{machine_id: separate faults in the 90 days up to `now`} (see the module's notes)."""
    counts = {machine_id: set() for machine_id in machine_ids}
    if not machine_ids:
        return {}
    until = now or utcnow()
    records = ServiceRecord.query.filter(
        ServiceRecord.company_id == company_id,
        ServiceRecord.machine_id.in_(machine_ids),
        ServiceRecord.service_date >= until - timedelta(days=REPEAT_FAULT_DAYS),
        ServiceRecord.service_date <= until,
    ).all()
    jobs = {job.id: job for job in Job.query.filter(Job.id.in_([r.job_id for r in records if r.job_id])).all()} if records else {}
    for record in records:
        job = jobs.get(record.job_id)
        if job:
            if job.status != "Completed" or is_routine(job):
                continue
            counts[record.machine_id].add(("request", job.request_id) if job.request_id else ("job", job.id))
        elif (record.problem or "").strip() and "maintenance" not in (record.service_type or "").lower():
            counts[record.machine_id].add(("record", record.id))
    return {machine_id: len(keys) for machine_id, keys in counts.items()}


def repeat_faults(company_id, machine_ids, now=None):
    """{machine_id: number of faults} for the equipment with a repeat fault."""
    return {machine_id: count for machine_id, count in fault_counts(company_id, machine_ids, now).items() if count >= REPEAT_FAULT_COUNT}


def due_plans(company_id, machine_ids, today):
    """{machine_id: [plan, ...]} for the plans due or overdue."""
    found = {}
    if not machine_ids:
        return found
    for plan in MaintenancePlan.query.filter(
        MaintenancePlan.company_id == company_id, MaintenancePlan.machine_id.in_(machine_ids), MaintenancePlan.active.is_(True)
    ).all():
        if plan_state(plan, today) in ("due", "overdue"):
            found.setdefault(plan.machine_id, []).append(plan)
    return found


def written_date(value):
    return f"{value.day:02d} {_(MONTHS[value.month - 1])} {value.year}"


def tell(user, company, heading, message, path, /, **values):
    """A notification and an email, in the person's own language."""
    link = app_link(path)
    with speaking(user.language):
        written = {key: written_date(value) if isinstance(value, date) else value for key, value in values.items()}
        notify(user.id, heading, message, "maintenance", (), **written)
        paragraphs = [_(message, **written)]
        send_email(user.email, _(heading), "\n\n".join([*paragraphs, link]), layout(_(heading), paragraphs, (_("Open the equipment"), link)), company_id=company.id)


def send_due_reminders(now=None):
    """The daily run: each plan coming due gets its job and its reminders, once per due date."""
    sent = {"maintenance_jobs": 0, "service_due_reminders": 0}
    for plan in MaintenancePlan.query.filter(MaintenancePlan.active.is_(True)).all():
        company = db.session.get(Company, plan.company_id)
        # Plans wait while the company's plan doesn't include planned maintenance.
        if not has_feature(company.id, "maintenance"):
            continue
        today = (now.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(company.timezone)).date()) if now else company_today(company)
        if plan_state(plan, today) not in ("due", "overdue") or plan.reminded_for == plan.next_due:
            continue
        machine = db.session.get(Machine, plan.machine_id)
        if not Job.query.filter_by(plan_id=plan.id, due_date=plan.next_due).first():
            create_plan_job(plan)
            sent["maintenance_jobs"] += 1
        plan.reminded_for = plan.next_due
        values = {"title": plan.title, "machine": machine.name, "date": plan.next_due}
        for boss in User.query.filter_by(company_id=plan.company_id, role="boss").all():
            tell(boss, company, N_("Service due"), N_("{title} for {machine} is due on {date}. Its job is waiting to be assigned."), f"/equipment/{machine.id}", **values)
        for person in User.query.filter_by(company_id=plan.company_id, customer_id=machine.customer_id, role="customer").all():
            tell(person, company, N_("Service due"), N_("{title} for your {machine} is due on {date}. We'll be in touch to arrange the visit."), f"/equipment/{machine.id}", **values)
        sent["service_due_reminders"] += 1
    return sent
