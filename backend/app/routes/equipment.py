"""A piece of equipment's page (its history, documents and maintenance plans) and customers' sites."""
import uuid

from flask import Blueprint, current_app, jsonify, request

from app import db
from app.models.company import Company
from app.models.customer import Customer
from app.models.equipment import MaintenancePlan, Site
from app.models.job import Job
from app.models.machine import Machine
from app.models.media import JobFile
from app.models.service_record import ServiceRecord
from app.models.user import User
from app.routes.machines import out as machine_out
from app.routes.services import out as record_out
from app.services import equipment
from app.services.billing import check_storage, require_feature
from app.services.storage import storage
from app.services.sync import happened_at
from app.utils.auth import current_user, roles
from app.utils.validation import ValidationError, choice, coordinates, integer, iso_date, json_body, text
from app.i18n import _

bp = Blueprint("equipment", __name__)

# Manuals, certificates, wiring diagrams, photos of the nameplate.
DOCUMENT_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "text/plain": ".txt",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
}


def iso(value):
    return value.isoformat() if value else None


def visible_machine(mid):
    """Equipment the current user may see: any in their company for a manager, their own for a
    customer, and for a technician the equipment of a job they have (or had)."""
    user = current_user()
    machine = Machine.query.filter_by(id=mid, company_id=user.company_id).first_or_404()
    if user.role == "customer" and machine.customer_id != user.customer_id:
        raise ValidationError(_("Not found."), 404)
    if user.role == "mechanic" and not Job.query.filter_by(machine_id=machine.id, mechanic_id=user.id).first():
        raise ValidationError(_("Not found."), 404)
    return machine


def can_add_documents(user, machine):
    return user.role in ("boss", "mechanic") or (user.role == "customer" and machine.customer_id == user.customer_id)


def site_out(site, machine_count=None):
    data = {
        "id": site.id,
        "customer_id": site.customer_id,
        "name": site.name,
        "address": site.address,
        "notes": site.notes,
        "position": {"latitude": site.latitude, "longitude": site.longitude} if site.latitude is not None else None,
    }
    if machine_count is not None:
        data["machine_count"] = machine_count
    return data


def plan_out(plan, today):
    job = equipment.open_job(plan)
    return {
        "id": plan.id,
        "machine_id": plan.machine_id,
        "title": plan.title,
        "job_type": plan.job_type,
        "every": plan.every,
        "unit": plan.unit,
        "next_due": iso(plan.next_due),
        "lead_days": plan.lead_days,
        "active": plan.active,
        "last_done": iso(plan.last_done),
        "state": equipment.plan_state(plan, today),
        "open_job_id": job.id if job else None,
    }


def document_out(record, names):
    return {
        "id": record.id,
        "name": record.original_name or f"document-{record.id}",
        "content_type": record.content_type,
        "size_bytes": record.size_bytes,
        "url": f"/api/files/{record.id}",
        "created_at": iso(record.created_at),
        "uploaded_by": names.get(record.uploaded_by),
        "uploaded_by_id": record.uploaded_by,
    }


def can_open_job(user, job):
    """The job pages this person can open (as load_job decides): a technician only their own."""
    if user.role == "mechanic":
        return job.mechanic_id == user.id
    if user.role == "customer":
        return job.customer_id == user.customer_id
    return True


def detail_out(machine, user):
    company_today = equipment.company_today(machine_company(machine))
    customer = db.session.get(Customer, machine.customer_id)
    site = db.session.get(Site, machine.site_id) if machine.site_id else None
    jobs = Job.query.filter_by(machine_id=machine.id).order_by(Job.created_at.desc(), Job.id.desc()).all()
    records = ServiceRecord.query.filter_by(machine_id=machine.id).order_by(ServiceRecord.service_date.desc(), ServiceRecord.id.desc()).all()
    job_by_id = {job.id: job for job in jobs}
    files = JobFile.query.filter(JobFile.company_id == machine.company_id, JobFile.status == "ready").filter(
        (JobFile.machine_id == machine.id) | (JobFile.job_id.in_(list(job_by_id) or [0]))
    ).order_by(JobFile.created_at.desc(), JobFile.id.desc()).all()
    ids = {job.mechanic_id for job in jobs} | {f.uploaded_by for f in files}
    names = {person.id: person.name for person in User.query.filter(User.id.in_([i for i in ids if i])).all()} if ids else {}
    faults = equipment.fault_counts(machine.company_id, [machine.id]).get(machine.id, 0)
    plans = MaintenancePlan.query.filter_by(machine_id=machine.id).order_by(MaintenancePlan.next_due).all()
    data = machine_out(machine)
    data.update(
        customer={"id": customer.id, "name": customer.name} if customer else None,
        site=site_out(site) if site else None,
        repeat_fault={"count": faults, "days": equipment.REPEAT_FAULT_DAYS} if faults >= equipment.REPEAT_FAULT_COUNT else None,
        plans=[plan_out(plan, company_today) for plan in plans],
        documents=[document_out(f, names) for f in files if f.kind == "document"],
        photos=[
            {"id": f.id, "kind": f.kind, "content_type": f.content_type, "url": f"/api/files/{f.id}", "job_id": f.job_id, "created_at": iso(f.created_at)}
            for f in files
            if f.job_id and f.kind not in ("signature", "document") and can_open_job(user, job_by_id[f.job_id])
        ],
        jobs=[
            {
                "id": job.id,
                "title": job.title,
                "status": job.status,
                "job_type": job.job_type,
                "due_date": iso(job.due_date),
                "scheduled_start": iso(job.scheduled_start),
                "created_at": iso(job.created_at),
                "mechanic": names.get(job.mechanic_id),
                "plan_id": job.plan_id,
                "can_open": can_open_job(user, job),
            }
            for job in jobs
        ],
        faults=[
            {"record_id": record.id, "job_id": record.job_id, "date": iso(record.service_date), "problem": record.problem, "solution": record.solution}
            for record in records
            if (record.problem or "").strip() and not (record.job_id and record.job_id in job_by_id and equipment.is_routine(job_by_id[record.job_id]))
        ],
        records=[record_out(record) for record in records],
        can_edit=user.role == "boss",
        can_add_documents=can_add_documents(user, machine),
        document_mb=current_app.config["MAX_DOCUMENT_MB"],
    )
    return data


def machine_company(machine):
    return db.session.get(Company, machine.company_id)


@bp.get("/machines/<int:mid>")
@roles("boss", "mechanic", "customer")
def machine_detail(mid):
    machine = visible_machine(mid)
    return jsonify(machine=detail_out(machine, current_user()))


# ---------- Documents ----------


@bp.post("/machines/<int:mid>/documents")
@roles("boss", "mechanic", "customer")
def request_document_upload(mid):
    """Reserve a document and get where to upload it (the bucket, or this app), as photos do."""
    user = current_user()
    machine = visible_machine(mid)
    if not can_add_documents(user, machine):
        raise ValidationError(_("Forbidden"), 403)
    data = json_body()
    content_type = text(data, "content_type", "File type", required=True, max_length=120).lower()
    if content_type not in DOCUMENT_TYPES:
        raise ValidationError(_("Documents can be PDF, Word, Excel, text or photo files."), 415)
    size = integer(data, "size", "Size", required=True, minimum=1)
    limit = current_app.config["MAX_DOCUMENT_MB"] * 1024 * 1024
    if size > limit:
        raise ValidationError(_("Documents can be at most {size} MB.", size=current_app.config["MAX_DOCUMENT_MB"]), 413)
    check_storage(machine.company_id, size)
    record = JobFile(
        company_id=machine.company_id,
        machine_id=machine.id,
        uploaded_by=user.id,
        kind="document",
        content_type=content_type,
        size_bytes=size,
        storage_key=f"{machine.company_id}/equipment/{machine.id}/{uuid.uuid4().hex}{DOCUMENT_TYPES[content_type]}",
        original_name=text(data, "name", "Name", required=True, max_length=200),
        created_at=happened_at(),
    )
    db.session.add(record)
    db.session.flush()
    target = storage().upload_target(record.storage_key, content_type, size, limit, record.id)
    db.session.commit()
    return jsonify(file_id=record.id, upload=target), 201


@bp.post("/machines/<int:mid>/documents/<int:fid>/confirm")
@roles("boss", "mechanic", "customer")
def confirm_document(mid, fid):
    user = current_user()
    machine = visible_machine(mid)
    record = JobFile.query.filter_by(id=fid, machine_id=machine.id, uploaded_by=user.id, kind="document").first_or_404()
    if record.status != "ready":
        size = storage().size(record.storage_key)
        if not size:
            raise ValidationError(_("The upload didn't arrive. Please try again."), 409)
        limit = current_app.config["MAX_DOCUMENT_MB"] * 1024 * 1024
        try:
            if size > limit:
                raise ValidationError(_("The file is larger than the limit"), 413)
            check_storage(record.company_id, size, lock=True)
        except ValidationError:
            storage().delete(record.storage_key)
            db.session.delete(record)
            db.session.commit()
            raise
        record.size_bytes = size
        record.status = "ready"
        db.session.commit()
    return jsonify(machine=detail_out(machine, user))


@bp.delete("/machines/<int:mid>/documents/<int:fid>")
@roles("boss", "mechanic", "customer")
def delete_document(mid, fid):
    """Managers remove any document; others, the ones they added."""
    user = current_user()
    machine = visible_machine(mid)
    record = JobFile.query.filter_by(id=fid, machine_id=machine.id, kind="document").first_or_404()
    if user.role != "boss" and record.uploaded_by != user.id:
        raise ValidationError(_("Only a manager or the person who added it can remove this document."), 403)
    db.session.delete(record)
    db.session.commit()
    storage().delete(record.storage_key)
    return jsonify(machine=detail_out(machine, user))


# ---------- Maintenance plans ----------


def read_plan(data, plan=None):
    fields = {}
    if plan is None or "title" in data:
        fields["title"] = text(data, "title", "Title", required=True, max_length=150)
    if "job_type" in data:
        fields["job_type"] = text(data, "job_type", "Job type", max_length=80)
    if plan is None or "every" in data:
        fields["every"] = integer(data, "every", "Every", required=True, minimum=1, maximum=1000)
    if plan is None or "unit" in data:
        unit = choice(data, "unit", equipment.UNITS, "Repeats every")
        if not unit:
            raise ValidationError(_("{label} is required", label=_("Repeats every")))
        fields["unit"] = unit
    if plan is None or "next_due" in data:
        next_due = iso_date(data, "next_due", "Next due")
        if not next_due:
            raise ValidationError(_("{label} is required", label=_("Next due")))
        fields["next_due"] = next_due
    if "lead_days" in data:
        fields["lead_days"] = integer(data, "lead_days", "Days ahead to create the job", required=True, minimum=0, maximum=90)
    if "active" in data:
        if not isinstance(data["active"], bool):
            raise ValidationError(_("{label} must be one of: {options}", label=_("Active"), options="true, false"))
        fields["active"] = data["active"]
    return fields


def boss_plan(pid):
    return MaintenancePlan.query.filter_by(id=pid, company_id=current_user().company_id).first_or_404()


@bp.post("/machines/<int:mid>/plans")
@roles("boss")
def create_plan(mid):
    user = current_user()
    require_feature(user.company_id, "maintenance")
    machine = visible_machine(mid)
    plan = MaintenancePlan(company_id=machine.company_id, machine_id=machine.id, **read_plan(json_body()))
    db.session.add(plan)
    db.session.commit()
    return jsonify(machine=detail_out(machine, user)), 201


@bp.patch("/plans/<int:pid>")
@roles("boss")
def update_plan(pid):
    """Change a plan, or mark it done without a job (done outside the app): `done_on`."""
    user = current_user()
    require_feature(user.company_id, "maintenance")
    plan = boss_plan(pid)
    data = json_body()
    for key, value in read_plan(data, plan).items():
        setattr(plan, key, value)
    if "next_due" in data:
        plan.reminded_for = None
    if "done_on" in data:
        done_on = iso_date(data, "done_on", "Done on")
        if not done_on:
            raise ValidationError(_("{label} is required", label=_("Done on")))
        equipment.mark_done(plan, done_on)
    db.session.commit()
    return jsonify(machine=detail_out(db.session.get(Machine, plan.machine_id), user))


@bp.delete("/plans/<int:pid>")
@roles("boss")
def delete_plan(pid):
    """The plan goes; jobs it made stay, as ordinary jobs."""
    user = current_user()
    plan = boss_plan(pid)
    machine = db.session.get(Machine, plan.machine_id)
    Job.query.filter_by(plan_id=plan.id).update({"plan_id": None})
    db.session.delete(plan)
    db.session.commit()
    return jsonify(machine=detail_out(machine, user))


@bp.post("/plans/<int:pid>/job")
@roles("boss")
def create_plan_job(pid):
    """The job for the next due date, now rather than when it comes due."""
    user = current_user()
    require_feature(user.company_id, "maintenance")
    plan = boss_plan(pid)
    if equipment.open_job(plan):
        raise ValidationError(_("This plan already has a job that isn't finished."), 409)
    job = equipment.create_plan_job(plan, user)
    db.session.commit()
    return jsonify(job_id=job.id, machine=detail_out(db.session.get(Machine, plan.machine_id), user)), 201


# ---------- Sites ----------


def own_site(sid):
    return Site.query.filter_by(id=sid, company_id=current_user().company_id).first_or_404()


@bp.get("/sites")
@roles("boss", "customer")
def sites():
    user = current_user()
    query = Site.query.filter_by(company_id=user.company_id)
    if user.role == "customer":
        query = query.filter_by(customer_id=user.customer_id)
    elif "customer_id" in request.args:
        query = query.filter_by(customer_id=integer(request.args, "customer_id", "Customer"))
    rows = query.order_by(Site.name).all()
    counts = dict(
        db.session.query(Machine.site_id, db.func.count(Machine.id)).filter(Machine.site_id.in_([s.id for s in rows] or [0])).group_by(Machine.site_id).all()
    )
    return jsonify(sites=[site_out(site, counts.get(site.id, 0)) for site in rows])


def read_site(data, site=None):
    fields = {}
    if site is None or "name" in data:
        fields["name"] = text(data, "name", "Name", required=True, max_length=150)
    if "address" in data:
        fields["address"] = text(data, "address", "Address", max_length=255)
    if "notes" in data:
        fields["notes"] = text(data, "notes", "Notes", max_length=2000)
    if "position" in data:
        fields["latitude"], fields["longitude"] = coordinates(data, "position", "Position on the map")
    return fields


def name_taken(customer_id, name, exclude_id=None):
    query = Site.query.filter(Site.customer_id == customer_id, db.func.lower(Site.name) == name.lower())
    if exclude_id:
        query = query.filter(Site.id != exclude_id)
    return query.first() is not None


@bp.post("/sites")
@roles("boss")
def create_site():
    user = current_user()
    data = json_body()
    customer_id = integer(data, "customer_id", "Customer", required=True)
    if not Customer.query.filter_by(id=customer_id, company_id=user.company_id).first():
        raise ValidationError(_("Customer not found"), 404)
    fields = read_site(data)
    if name_taken(customer_id, fields["name"]):
        raise ValidationError(_("This customer already has a site with that name"), 409)
    site = Site(company_id=user.company_id, customer_id=customer_id, **fields)
    db.session.add(site)
    db.session.commit()
    return jsonify(site=site_out(site, 0)), 201


@bp.patch("/sites/<int:sid>")
@roles("boss")
def update_site(sid):
    site = own_site(sid)
    fields = read_site(json_body(), site)
    if "name" in fields and name_taken(site.customer_id, fields["name"], site.id):
        raise ValidationError(_("This customer already has a site with that name"), 409)
    for key, value in fields.items():
        setattr(site, key, value)
    db.session.commit()
    return jsonify(site=site_out(site, Machine.query.filter_by(site_id=site.id).count()))


@bp.delete("/sites/<int:sid>")
@roles("boss")
def delete_site(sid):
    """The site goes; its equipment stays with the customer, without a site."""
    site = own_site(sid)
    Machine.query.filter_by(site_id=site.id).update({"site_id": None})
    db.session.delete(site)
    db.session.commit()
    return jsonify(ok=True)
