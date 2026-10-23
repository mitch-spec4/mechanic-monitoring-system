"""The demo company, DK Engineering: a Nairobi service business with mechanics, customers, machines
and jobs at every stage, with worksheets, shifts, a signed-off job, reviews and requests.

It's built in two ways from the same code:
- seed.py loads it once for local development, with a shared password on every account;
- "Try the demo" gives each visitor a private copy. Its accounts have no usable password (the
  button is the only way in), it never sends email, and it is deleted DEMO_HOURS later.
"""
import io
import math
import secrets
from datetime import timedelta

from PIL import Image, ImageDraw

from app import db
from app.models import (
    ChecklistTemplate,
    ChecklistTemplateItem,
    Company,
    Customer,
    Job,
    JobChecklistItem,
    JobEvent,
    JobFile,
    JobPart,
    LocationPoint,
    Machine,
    Notification,
    Payment,
    Review,
    ServiceRecord,
    ServiceRequest,
    Shift,
    Subscription,
    User,
    WorkEntry,
)
from app.services.company_data import delete_company, delete_files
from app.services.plans import CURRENCY, add_period, price_cents
from app.services.storage import storage
from app.services.worksheet import copy_checklist, fill_service_record
from app.utils.time import utcnow
from app.utils.validation import ValidationError
from app.i18n import _

DEMO_HOURS = 24
# A ceiling on demo copies alive at once, so a flood of visitors can't fill the database.
MAX_LIVE_COPIES = 300
# Not a password hash at all, so no password can ever match it.
NO_PASSWORD = "!demo"

CHECKLISTS = {
    "Repair": [("Isolate power and lock out the machine", True), ("Identify and record the fault", True), ("Test run after the repair", True), ("Clean the work area", False)],
    "Inspection": [("Visual inspection for leaks and damage", True), ("Check fluid levels", True), ("Photograph the machine's condition", False)],
    "Preventive maintenance": [("Change oil and filters", True), ("Check belts and hoses", True), ("Update the service sticker", False)],
}


def populate(company, tag=None, password=None):
    """Fill an empty company with the demo data. Without a tag, accounts get the fixed local
    addresses (james@mechanicpro.test, abc@example.com...); with one, unique addresses for a copy."""
    now = utcnow()
    today = now.date()

    def email(local, domain):
        return f"{local}.{tag}@demo.mechanicpro.test" if tag else f"{local}@{domain}"

    def person(name, address, role, customer=None):
        user = User(name=name, email=address, role=role, company_id=company.id, customer_id=customer.id if customer else None, email_verified_at=now)
        if password:
            user.set_password(password)
        else:
            user.password_hash = NO_PASSWORD
        db.session.add(user)
        db.session.flush()
        return user

    def customer_with_login(name, local, phone):
        customer = Customer(name=name, email=email(local, "example.com"), phone=phone, company_id=company.id)
        db.session.add(customer)
        db.session.flush()
        person(name, customer.email, "customer", customer)
        return customer

    def machine(name, model, serial_no, owner, status="Operational"):
        record = Machine(name=name, model=model, serial_no=serial_no, customer_id=owner.id, company_id=company.id, status=status)
        db.session.add(record)
        db.session.flush()
        return record

    # The order matters: the first boss, mechanic and customer are the people "Try the demo" signs in as.
    boss = person("James Mwangi", email("james", "mechanicpro.test"), "boss")
    mitch = person("Mitch Kamau", email("mitch", "mechanicpro.test"), "mechanic")
    amina = person("Amina Otieno", email("amina", "mechanicpro.test"), "mechanic")
    brian = person("Brian Kariuki", email("brian", "mechanicpro.test"), "mechanic")
    abc = customer_with_login("ABC Engineering", "abc", "+254 712 345 678")
    kenya = customer_with_login("Kenya Motors", "kenya", "+254 723 456 789")
    xyz = customer_with_login("XYZ Factory", "xyz", "+254 734 567 890")

    generator = machine("Generator G-102", "CAT XQ200", "G102-88421", abc)
    excavator = machine("Excavator EX-01", "Komatsu PC210", "EX01-55218", abc, "Under Maintenance")
    compressor = machine("Compressor C-55", "Atlas Copco GA30", "C55-77890", kenya)
    pump = machine("Hydraulic Pump H-21", "Parker PVP", "H21-44012", kenya, "Under Repair")
    conveyor = machine("Conveyor Line CL-4", "Dorner 2200", "CL4-99120", xyz)
    mixer = machine("Industrial Mixer MX-08", "Hobart H600", "MX08-11987", xyz)

    for job_type, items in CHECKLISTS.items():
        template = ChecklistTemplate(company_id=company.id, job_type=job_type)
        db.session.add(template)
        db.session.flush()
        for position, (label, required) in enumerate(items):
            db.session.add(ChecklistTemplateItem(template_id=template.id, label=label, required=required, position=position))

    def job(title, description, priority, status, location, due_in_days, customer, record, mechanic, job_type):
        created = Job(
            title=title, description=description, priority=priority, job_type=job_type, status=status, location=location,
            due_date=today + timedelta(days=due_in_days), company_id=company.id, customer_id=customer.id,
            machine_id=record.id, mechanic_id=mechanic.id if mechanic else None,
        )
        db.session.add(created)
        db.session.flush()
        return created

    generator_job = job("Service Generator G-102", "Generator overheating after two hours of operation.", "High", "In Progress", "Nairobi Industrial Area", 1, abc, generator, mitch, "Preventive maintenance")
    excavator_job = job("Inspect Excavator EX-01", "Hydraulic pressure drops during heavy lifting.", "Urgent", "Assigned", "Mombasa Road", 2, abc, excavator, amina, "Inspection")
    compressor_job = job("Compressor C-55 maintenance", "Complete the scheduled oil change and inspection.", "Medium", "Accepted", "Westlands, Nairobi", 4, kenya, compressor, mitch, "Preventive maintenance")
    pump_job = job("Repair Hydraulic Pump H-21", "Investigate oil leak near the main seal.", "High", "Pending", "Thika Road", 7, kenya, pump, None, "Repair")
    conveyor_job = job("Conveyor Line CL-4 inspection", "Routine belt alignment and safety inspection.", "Low", "Completed", "Athi River", -3, xyz, conveyor, brian, "Inspection")
    mixer_job = job("Industrial Mixer MX-08 repair", "Mixer produces abnormal vibration under load.", "High", "Paused", "Nairobi South", 5, xyz, mixer, brian, "Repair")

    def worksheet(record, entries=(), parts=(), ticked=0, statuses=()):
        """A job's history, time entries, parts and checklist."""
        stamp = now - timedelta(days=4)
        db.session.add(JobEvent(job_id=record.id, user_id=boss.id, action="created", to_status="Pending", created_at=stamp))
        if record.mechanic_id:
            assignee = db.session.get(User, record.mechanic_id)
            db.session.add(JobEvent(job_id=record.id, user_id=boss.id, action="assigned", from_status="Pending", to_status="Assigned", note=f"Assigned to {assignee.name}", created_at=stamp + timedelta(minutes=5)))
        previous = "Assigned"
        for hours_ago, status in statuses:
            db.session.add(JobEvent(job_id=record.id, user_id=record.mechanic_id, action="status", from_status=previous, to_status=status, created_at=now - timedelta(hours=hours_ago)))
            previous = status
        for start_hours_ago, length_hours, work_done in entries:
            started = now - timedelta(hours=start_hours_ago)
            ended = None if length_hours is None else started + timedelta(hours=length_hours)
            db.session.add(WorkEntry(job_id=record.id, mechanic_id=record.mechanic_id, started_at=started, ended_at=ended, site=record.location, work_done=work_done))
        for name, quantity in parts:
            db.session.add(JobPart(job_id=record.id, name=name, quantity=quantity, added_by=record.mechanic_id, created_at=now - timedelta(hours=2)))
        db.session.flush()
        if record.status in {"In Progress", "Paused", "Completed"}:
            copy_checklist(record)
        db.session.flush()
        items = JobChecklistItem.query.filter_by(job_id=record.id).order_by(JobChecklistItem.position).all()
        # Ticks happen during the first visit (or an hour ago if there is no visit yet).
        ticked_at = now - timedelta(hours=entries[0][0]) + timedelta(minutes=30) if entries else now - timedelta(hours=1)
        for item in items[:ticked]:
            item.done, item.done_by, item.done_at = True, record.mechanic_id, ticked_at
        if record.status == "Completed":
            db.session.flush()
            fill_service_record(record)

    worksheet(excavator_job)
    worksheet(pump_job)
    worksheet(compressor_job, statuses=[(20, "Accepted")])
    worksheet(
        generator_job,
        statuses=[(26, "In Progress"), (23, "Paused"), (1, "In Progress")],
        entries=[(26, 3, "Drained the coolant and flushed the radiator."), (1, None, "Replacing the thermostat.")],
        parts=[("Coolant (L)", 8), ("Thermostat", 1)],
        ticked=1,
    )
    worksheet(
        mixer_job,
        statuses=[(30, "In Progress"), (27, "Paused")],
        entries=[(30, 2.5, "Measured vibration at 3 load levels; worn bearing on the drive side.")],
        parts=[("Bearing kit", 1)],
        ticked=2,
    )
    worksheet(
        conveyor_job,
        statuses=[(72, "In Progress"), (70, "Completed")],
        entries=[(72, 2, "Realigned the belt and checked all guards; safety stops tested.")],
        parts=[("Belt fastener", 4)],
        ticked=3,
    )

    def service(service_type, problem, work_done, parts, solution, advice, customer, record, mechanic):
        created = ServiceRecord(
            machine_id=record.id, customer_id=customer.id, mechanic_id=mechanic.id, company_id=company.id, service_type=service_type,
            problem=problem, work_done=work_done, parts_replaced=parts, solution=solution, advice=advice,
        )
        db.session.add(created)
        db.session.flush()
        return created

    generator_service = service("Preventive maintenance", "Overheating after two hours.", "Inspected cooling system and cleaned radiator.", "Coolant filter", "Improved coolant flow.", "Check coolant level weekly.", abc, generator, mitch)
    excavator_service = service("Hydraulic system repair", "Hydraulic pressure drops under load.", "Replaced worn pressure hose and tested the system.", "High-pressure hose", "Restored normal hydraulic pressure.", "Inspect hose fittings every month.", abc, excavator, amina)
    compressor_service = service("Oil change and inspection", "Oil level below recommended mark.", "Changed oil, filter, and checked for leaks.", "Oil filter, 8L hydraulic oil", "Compressor returned to normal operation.", "Schedule the next oil change in 500 hours.", kenya, compressor, mitch)
    service("Repair", "Oil leak around the main seal.", "Removed the pump and documented the failed seal for replacement.", "Main seal pending", "Repair paused awaiting the replacement part.", "Keep the machine offline until repair is complete.", kenya, pump, mitch)
    service("Vibration diagnosis", "Abnormal vibration under load.", "Checked bearings and recorded measurements for follow-up.", "Bearing kit pending", "Further inspection scheduled.", "Avoid operating above half load.", xyz, mixer, brian)

    db.session.add_all(
        [
            Review(customer_id=abc.id, mechanic_id=mitch.id, machine_id=generator.id, company_id=company.id, service_record_id=generator_service.id, rating=5, comment="Mitch explained the problem clearly and fixed it quickly.", advice="Please check the radiator again during the next service."),
            Review(customer_id=kenya.id, mechanic_id=mitch.id, machine_id=compressor.id, company_id=company.id, service_record_id=compressor_service.id, rating=4, comment="Good service and clear updates throughout the visit.", advice="Send the next maintenance reminder early."),
            Review(customer_id=abc.id, mechanic_id=amina.id, machine_id=excavator.id, company_id=company.id, service_record_id=excavator_service.id, rating=5, comment="The excavator is working smoothly again.", advice="Keep the current inspection schedule."),
        ]
    )

    def stamp(user, shift, kind, place, at, on_job=None):
        db.session.add(
            LocationPoint(
                company_id=company.id, user_id=user.id, shift_id=shift.id, job_id=on_job.id if on_job else None,
                kind=kind, latitude=place[0], longitude=place[1], accuracy_m=15, recorded_at=at,
            )
        )

    def shifts(user, worked, consent=True):
        """Shifts as (hours ago clocked in, hours worked or None while still clocked in, (lat, lng))."""
        if consent:
            user.location_consent_at = now - timedelta(days=7)
        for started, hours, place in worked:
            shift = Shift(company_id=company.id, user_id=user.id, clocked_in_at=now - timedelta(hours=started))
            if hours is not None:
                shift.clocked_out_at = shift.clocked_in_at + timedelta(hours=hours)
            if hours and hours > 12:
                # A forgotten clock-out the manager corrected.
                shift.original_clocked_out_at = shift.clocked_out_at
                shift.clocked_out_at = shift.clocked_in_at + timedelta(hours=9)
                shift.edited_by, shift.edited_at = boss.id, shift.clocked_out_at + timedelta(hours=10)
            db.session.add(shift)
            db.session.flush()
            if consent and place:
                stamp(user, shift, "clock_in", place, shift.clocked_in_at)
                if shift.clocked_out_at:
                    stamp(user, shift, "clock_out", place, shift.clocked_out_at)

    # Mitch and Amina are clocked in; Brian is clocked out and hasn't agreed to location sharing yet.
    industrial_area, mombasa_road = (-1.3080, 36.8510), (-1.3330, 36.8890)
    shifts(mitch, [(50, 8, industrial_area), (26, 8.5, industrial_area), (1.5, None, industrial_area)])
    shifts(amina, [(27, 8, mombasa_road), (2, None, mombasa_road)])
    shifts(brian, [(75, 15, None), (30, 7.5, None)], consent=False)
    today_shift = Shift.query.filter_by(user_id=mitch.id, clocked_out_at=None).one()
    stamp(mitch, today_shift, "job_start", (-1.3083, 36.8506), now - timedelta(hours=1), generator_job)
    stamp(mitch, today_shift, "live", (-1.3085, 36.8503), now - timedelta(minutes=4), generator_job)

    add_signature(conveyor_job, brian, "Grace Wanjiru", now)

    # On the Professional plan, paid monthly (a test-mode payment a week ago).
    paid = now - timedelta(days=7)
    db.session.add(
        Subscription(
            company_id=company.id, plan="professional", interval="month", status="active",
            trial_ends_at=paid, current_period_end=add_period(paid, "month"), created_at=paid - timedelta(days=14),
        )
    )
    db.session.add(
        Payment(
            company_id=company.id, user_id=boss.id, plan="professional", interval="month", amount_cents=price_cents("professional", "month"),
            currency=CURRENCY, provider="test", reference=f"pay_demo_{tag or 'first_month'}", status="paid", created_at=paid, paid_at=paid,
        )
    )

    for subject, description, priority, status, customer, record in (
        ("Generator G-102 overheating issue", "The generator overheats and vibrates after extended use.", "High", "Submitted", abc, generator),
        ("Hydraulic leak inspection", "Please inspect the hydraulic line before the next production run.", "Medium", "Reviewing", kenya, pump),
        ("Mixer vibration check", "The mixer vibrates when processing heavier batches.", "High", "Approved", xyz, mixer),
    ):
        db.session.add(ServiceRequest(customer_id=customer.id, company_id=company.id, machine_id=record.id, subject=subject, description=description, priority=priority, status=status))

    abc_user = User.query.filter_by(customer_id=abc.id).one()
    for user, title, message, kind, is_read in (
        (boss, "New service request", "ABC Engineering submitted a generator service request.", "request", False),
        (boss, "Mitch completed a job", "Compressor C-55 maintenance was completed.", "status", True),
        (boss, "Customer review received", "ABC Engineering left a 5/5 review.", "review", False),
        (mitch, "New job assigned", "Service Generator G-102 was assigned to you.", "job", False),
        (mitch, "Customer review", "ABC Engineering rated your service 5/5.", "review", True),
        (amina, "New job assigned", "Inspect Excavator EX-01 was assigned to you.", "job", False),
        (abc_user, "Service completed", "Your compressor maintenance service is complete.", "status", False),
        (abc_user, "Review reminder", "Please leave a review for your completed service.", "review", False),
    ):
        db.session.add(Notification(user_id=user.id, title=title, message=message, type=kind, is_read=is_read))
    db.session.flush()
    return boss


def add_signature(job, mechanic, name, now):
    """The customer's sign-off on a completed job: a drawn signature stored like a real one."""
    image = Image.new("RGBA", (480, 160), (255, 255, 255, 0))
    pen = ImageDraw.Draw(image)
    points = [(30 + x * 4, 95 - 38 * math.sin(x / 7) * math.exp(-x / 160) - (x % 23)) for x in range(105)]
    pen.line(points, fill=(23, 32, 51, 255), width=4, joint="curve")
    out = io.BytesIO()
    image.save(out, "PNG")
    key = f"{job.company_id}/jobs/{job.id}/signature-demo.png"
    storage().put(key, out.getvalue(), "image/png")
    db.session.add(
        JobFile(company_id=job.company_id, job_id=job.id, uploaded_by=mechanic.id, kind="signature", content_type="image/png",
                size_bytes=len(out.getvalue()), storage_key=key, original_name="signature.png", status="ready")
    )
    job.signed_by_name = name
    job.signed_at = now - timedelta(hours=70)
    db.session.add(JobEvent(job_id=job.id, user_id=mechanic.id, action="signed", note=f"Signed by {name}", created_at=job.signed_at))


def start_copy():
    """A visitor's private copy of the demo company. Expired copies are cleared out first."""
    purge_expired(limit=5)
    if Company.query.filter(Company.demo_expires_at > utcnow()).count() >= MAX_LIVE_COPIES:
        raise ValidationError(_("The demo is busy right now. Please try again in a few minutes."), 503)
    company = Company(name="DK Engineering", location="Nairobi", demo_expires_at=utcnow() + timedelta(hours=DEMO_HOURS))
    db.session.add(company)
    db.session.flush()
    populate(company, tag=secrets.token_hex(4))
    return company


def person_in(company_id, role):
    """The demo person shown for a role: the first boss, mechanic or customer created."""
    return User.query.filter_by(company_id=company_id, role=role).order_by(User.id).first()


def purge_expired(limit=None):
    """Delete demo copies whose time is up, with their files. Returns how many went."""
    query = Company.query.filter(Company.demo_expires_at <= utcnow()).order_by(Company.demo_expires_at)
    ids = [company.id for company in (query.limit(limit) if limit else query)]
    keys = []
    for company_id in ids:
        keys += delete_company(company_id)
    db.session.commit()
    delete_files(keys)
    return len(ids)
