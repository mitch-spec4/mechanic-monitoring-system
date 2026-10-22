"""Load demo data for local development. Refuses to run in production."""
from datetime import date, timedelta

from flask_migrate import upgrade

from app import create_app, db
from app.models import (
    ChecklistTemplate,
    ChecklistTemplateItem,
    Company,
    Customer,
    Job,
    JobChecklistItem,
    JobEvent,
    JobPart,
    Machine,
    Notification,
    Review,
    ServiceRecord,
    ServiceRequest,
    User,
    WorkEntry,
)
from app.services.worksheet import copy_checklist, fill_service_record
from app.utils.time import utcnow

DEMO_PASSWORD = "password"

app = create_app()
if app.config["IS_PRODUCTION"]:
    raise SystemExit("seed.py creates demo accounts with a shared password and must not run in production.")


def get_or_create_user(name, email, role, company_id, customer_id=None):
    user = User.query.filter_by(email=email).first()
    if user:
        return user
    user = User(
        name=name,
        email=email,
        role=role,
        company_id=company_id,
        customer_id=customer_id,
    )
    user.set_password(DEMO_PASSWORD)
    db.session.add(user)
    db.session.flush()
    return user


def get_or_create_customer(name, email, phone, company_id):
    customer = Customer.query.filter_by(email=email, company_id=company_id).first()
    if customer:
        return customer
    customer = Customer(
        name=name,
        email=email,
        phone=phone,
        company_id=company_id,
    )
    db.session.add(customer)
    db.session.flush()
    return customer


def get_or_create_machine(name, model, serial_no, customer_id, company_id, status="Operational"):
    machine = Machine.query.filter_by(serial_no=serial_no).first()
    if machine:
        return machine
    machine = Machine(
        name=name,
        model=model,
        serial_no=serial_no,
        customer_id=customer_id,
        company_id=company_id,
        status=status,
    )
    db.session.add(machine)
    db.session.flush()
    return machine


CHECKLISTS = {
    "Repair": [("Isolate power and lock out the machine", True), ("Identify and record the fault", True), ("Test run after the repair", True), ("Clean the work area", False)],
    "Inspection": [("Visual inspection for leaks and damage", True), ("Check fluid levels", True), ("Photograph the machine's condition", False)],
    "Preventive maintenance": [("Change oil and filters", True), ("Check belts and hoses", True), ("Update the service sticker", False)],
}


def add_checklists(company_id):
    for job_type, items in CHECKLISTS.items():
        if ChecklistTemplate.query.filter_by(company_id=company_id, job_type=job_type).first():
            continue
        template = ChecklistTemplate(company_id=company_id, job_type=job_type)
        db.session.add(template)
        db.session.flush()
        for position, (label, required) in enumerate(items):
            db.session.add(ChecklistTemplateItem(template_id=template.id, label=label, required=required, position=position))


def add_worksheet(job, boss, entries=(), parts=(), ticked=0, statuses=()):
    """Give a demo job a history, time entries, parts and a checklist (only once)."""
    if JobEvent.query.filter_by(job_id=job.id).first():
        return
    now = utcnow()
    stamp = now - timedelta(days=3)
    db.session.add(JobEvent(job_id=job.id, user_id=boss.id, action="created", to_status="Pending", created_at=stamp))
    if job.mechanic_id:
        mechanic = db.session.get(User, job.mechanic_id)
        db.session.add(JobEvent(job_id=job.id, user_id=boss.id, action="assigned", from_status="Pending", to_status="Assigned", note=f"Assigned to {mechanic.name}", created_at=stamp + timedelta(minutes=5)))
    previous = "Assigned"
    for hours_ago, status in statuses:
        db.session.add(JobEvent(job_id=job.id, user_id=job.mechanic_id, action="status", from_status=previous, to_status=status, created_at=now - timedelta(hours=hours_ago)))
        previous = status
    for start_hours_ago, length_hours, work_done in entries:
        started = now - timedelta(hours=start_hours_ago)
        ended = None if length_hours is None else started + timedelta(hours=length_hours)
        db.session.add(WorkEntry(job_id=job.id, mechanic_id=job.mechanic_id, started_at=started, ended_at=ended, site=job.location, work_done=work_done))
    for name, quantity in parts:
        db.session.add(JobPart(job_id=job.id, name=name, quantity=quantity, added_by=job.mechanic_id, created_at=now - timedelta(hours=2)))
    db.session.flush()
    if job.status in {"In Progress", "Paused", "Completed"}:
        copy_checklist(job)
    db.session.flush()
    items = JobChecklistItem.query.filter_by(job_id=job.id).order_by(JobChecklistItem.position).all()
    for item in items[:ticked]:
        item.done, item.done_by, item.done_at = True, job.mechanic_id, now - timedelta(hours=1)
    if job.status == "Completed":
        db.session.flush()
        fill_service_record(job)


def add_job(title, description, priority, status, location, due_date, company_id, customer, machine, mechanic, job_type=None):
    if Job.query.filter_by(title=title, company_id=company_id).first():
        return
    db.session.add(Job(
        title=title,
        description=description,
        priority=priority,
        job_type=job_type,
        status=status,
        location=location,
        due_date=due_date,
        company_id=company_id,
        customer_id=customer.id,
        machine_id=machine.id,
        mechanic_id=mechanic.id if mechanic else None,
    ))


def add_service(service_type, problem, work_done, parts, solution, advice, company_id, customer, machine, mechanic):
    if ServiceRecord.query.filter_by(machine_id=machine.id, service_type=service_type).first():
        return None
    record = ServiceRecord(
        machine_id=machine.id,
        customer_id=customer.id,
        mechanic_id=mechanic.id,
        company_id=company_id,
        service_type=service_type,
        problem=problem,
        work_done=work_done,
        parts_replaced=parts,
        solution=solution,
        advice=advice,
    )
    db.session.add(record)
    db.session.flush()
    return record


def add_request(subject, description, priority, status, company_id, customer, machine):
    if ServiceRequest.query.filter_by(subject=subject, company_id=company_id).first():
        return
    db.session.add(ServiceRequest(
        customer_id=customer.id,
        company_id=company_id,
        machine_id=machine.id,
        subject=subject,
        description=description,
        priority=priority,
        status=status,
    ))


def add_notification(user, title, message, notification_type, is_read=False):
    if Notification.query.filter_by(user_id=user.id, title=title, message=message).first():
        return
    db.session.add(Notification(
        user_id=user.id,
        title=title,
        message=message,
        type=notification_type,
        is_read=is_read,
    ))


with app.app_context():
    upgrade()
    company = Company.query.first()
    if not company:
        company = Company(name="DK Engineering", location="Nairobi")
        db.session.add(company)
        db.session.flush()

    boss = get_or_create_user("James Mwangi", "james@mechanicpro.test", "boss", company.id)
    mitch = get_or_create_user("Mitch Kamau", "mitch@mechanicpro.test", "mechanic", company.id)
    amina = get_or_create_user("Amina Otieno", "amina@mechanicpro.test", "mechanic", company.id)
    brian = get_or_create_user("Brian Kariuki", "brian@mechanicpro.test", "mechanic", company.id)

    abc = get_or_create_customer("ABC Engineering", "abc@example.com", "+254 712 345 678", company.id)
    kenya = get_or_create_customer("Kenya Motors", "kenya@example.com", "+254 723 456 789", company.id)
    xyz = get_or_create_customer("XYZ Factory", "xyz@example.com", "+254 734 567 890", company.id)

    get_or_create_user("ABC Engineering", "abc@example.com", "customer", company.id, abc.id)
    get_or_create_user("Kenya Motors", "kenya@example.com", "customer", company.id, kenya.id)
    get_or_create_user("XYZ Factory", "xyz@example.com", "customer", company.id, xyz.id)

    generator = get_or_create_machine("Generator G-102", "CAT XQ200", "G102-88421", abc.id, company.id)
    excavator = get_or_create_machine("Excavator EX-01", "Komatsu PC210", "EX01-55218", abc.id, company.id, "Under Maintenance")
    compressor = get_or_create_machine("Compressor C-55", "Atlas Copco GA30", "C55-77890", kenya.id, company.id)
    pump = get_or_create_machine("Hydraulic Pump H-21", "Parker PVP", "H21-44012", kenya.id, company.id, "Under Repair")
    conveyor = get_or_create_machine("Conveyor Line CL-4", "Dorner 2200", "CL4-99120", xyz.id, company.id)
    mixer = get_or_create_machine("Industrial Mixer MX-08", "Hobart H600", "MX08-11987", xyz.id, company.id)

    add_job("Service Generator G-102", "Generator overheating after two hours of operation.", "High", "In Progress", "Nairobi Industrial Area", date(2026, 8, 27), company.id, abc, generator, mitch, "Preventive maintenance")
    add_job("Inspect Excavator EX-01", "Hydraulic pressure drops during heavy lifting.", "Urgent", "Assigned", "Mombasa Road", date(2026, 8, 29), company.id, abc, excavator, amina, "Inspection")
    add_job("Compressor C-55 maintenance", "Complete the scheduled oil change and inspection.", "Medium", "Accepted", "Westlands, Nairobi", date(2026, 8, 30), company.id, kenya, compressor, mitch, "Preventive maintenance")
    add_job("Repair Hydraulic Pump H-21", "Investigate oil leak near the main seal.", "High", "Pending", "Thika Road", date(2026, 9, 2), company.id, kenya, pump, None, "Repair")
    add_job("Conveyor Line CL-4 inspection", "Routine belt alignment and safety inspection.", "Low", "Completed", "Athi River", date(2026, 8, 20), company.id, xyz, conveyor, brian, "Inspection")
    add_job("Industrial Mixer MX-08 repair", "Mixer produces abnormal vibration under load.", "High", "Paused", "Nairobi South", date(2026, 9, 1), company.id, xyz, mixer, brian, "Repair")
    add_checklists(company.id)
    db.session.flush()

    def job_named(title):
        return Job.query.filter_by(title=title, company_id=company.id).one()

    add_worksheet(job_named("Inspect Excavator EX-01"), boss)
    add_worksheet(job_named("Repair Hydraulic Pump H-21"), boss)
    add_worksheet(job_named("Compressor C-55 maintenance"), boss, statuses=[(20, "Accepted")])
    add_worksheet(
        job_named("Service Generator G-102"), boss,
        statuses=[(26, "In Progress"), (23, "Paused"), (1, "In Progress")],
        entries=[(26, 3, "Drained the coolant and flushed the radiator."), (1, None, "Replacing the thermostat.")],
        parts=[("Coolant (L)", 8), ("Thermostat", 1)],
        ticked=1,
    )
    add_worksheet(
        job_named("Industrial Mixer MX-08 repair"), boss,
        statuses=[(30, "In Progress"), (27, "Paused")],
        entries=[(30, 2.5, "Measured vibration at 3 load levels; worn bearing on the drive side.")],
        parts=[("Bearing kit", 1)],
        ticked=2,
    )
    add_worksheet(
        job_named("Conveyor Line CL-4 inspection"), boss,
        statuses=[(72, "In Progress"), (70, "Completed")],
        entries=[(72, 2, "Realigned the belt and checked all guards; safety stops tested.")],
        parts=[("Belt fastener", 4)],
        ticked=3,
    )

    generator_service = add_service("Preventive maintenance", "Overheating after two hours.", "Inspected cooling system and cleaned radiator.", "Coolant filter", "Improved coolant flow.", "Check coolant level weekly.", company.id, abc, generator, mitch)
    excavator_service = add_service("Hydraulic system repair", "Hydraulic pressure drops under load.", "Replaced worn pressure hose and tested the system.", "High-pressure hose", "Restored normal hydraulic pressure.", "Inspect hose fittings every month.", company.id, abc, excavator, amina)
    compressor_service = add_service("Oil change and inspection", "Oil level below recommended mark.", "Changed oil, filter, and checked for leaks.", "Oil filter, 8L hydraulic oil", "Compressor returned to normal operation.", "Schedule the next oil change in 500 hours.", company.id, kenya, compressor, mitch)
    pump_service = add_service("Repair", "Oil leak around the main seal.", "Removed the pump and documented the failed seal for replacement.", "Main seal pending", "Repair paused awaiting the replacement part.", "Keep the machine offline until repair is complete.", company.id, kenya, pump, mitch)
    mixer_service = add_service("Vibration diagnosis", "Abnormal vibration under load.", "Checked bearings and recorded measurements for follow-up.", "Bearing kit pending", "Further inspection scheduled.", "Avoid operating above half load.", company.id, xyz, mixer, brian)

    if generator_service and not Review.query.filter_by(service_record_id=generator_service.id).first():
        db.session.add(Review(customer_id=abc.id, mechanic_id=mitch.id, machine_id=generator.id, company_id=company.id, service_record_id=generator_service.id, rating=5, comment="Mitch explained the problem clearly and fixed it quickly.", advice="Please check the radiator again during the next service."))
    if compressor_service and not Review.query.filter_by(service_record_id=compressor_service.id).first():
        db.session.add(Review(customer_id=kenya.id, mechanic_id=mitch.id, machine_id=compressor.id, company_id=company.id, service_record_id=compressor_service.id, rating=4, comment="Good service and clear updates throughout the visit.", advice="Send the next maintenance reminder early."))
    if excavator_service and not Review.query.filter_by(service_record_id=excavator_service.id).first():
        db.session.add(Review(customer_id=abc.id, mechanic_id=amina.id, machine_id=excavator.id, company_id=company.id, service_record_id=excavator_service.id, rating=5, comment="The excavator is working smoothly again.", advice="Keep the current inspection schedule."))

    add_request("Generator G-102 overheating issue", "The generator overheats and vibrates after extended use.", "High", "Submitted", company.id, abc, generator)
    add_request("Hydraulic leak inspection", "Please inspect the hydraulic line before the next production run.", "Medium", "Reviewing", company.id, kenya, pump)
    add_request("Mixer vibration check", "The mixer vibrates when processing heavier batches.", "High", "Approved", company.id, xyz, mixer)

    add_notification(boss, "New service request", "ABC Engineering submitted a generator service request.", "request")
    add_notification(boss, "Mitch completed a job", "Compressor C-55 maintenance was completed.", "status", True)
    add_notification(boss, "Customer review received", "ABC Engineering left a 5/5 review.", "review")
    add_notification(mitch, "New job assigned", "Service Generator G-102 was assigned to you.", "job")
    add_notification(mitch, "Customer review", "ABC Engineering rated your service 5/5.", "review", True)
    add_notification(amina, "New job assigned", "Inspect Excavator EX-01 was assigned to you.", "job")
    add_notification(abc_user := User.query.filter_by(email="abc@example.com").first(), "Service completed", "Your compressor maintenance service is complete.", "status")
    add_notification(abc_user, "Review reminder", "Please leave a review for your completed service.", "review")

    db.session.commit()
    print("Demo data ready: 3 customers, 3 mechanics, 6 machines, 6 jobs with worksheets and history, 3 checklists, 6 service records, 3 reviews, 3 requests, and notifications.")
