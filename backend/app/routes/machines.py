from flask import Blueprint, jsonify

from app import db
from app.models.constants import MACHINE_STATUSES
from app.models.customer import Customer
from app.models.equipment import MaintenancePlan, Site
from app.models.job import Job
from app.models.machine import Machine
from app.models.media import JobFile
from app.models.request import ServiceRequest
from app.models.review import Review
from app.models.service_record import ServiceRecord
from app.services.machine_work import with_work
from app.services.storage import storage
from app.utils.auth import current_user, roles
from app.utils.validation import ValidationError, choice, integer, iso_date, json_body, text
from app.i18n import _
from app.services import audit

bp = Blueprint("machines", __name__)


def out(machine):
    return {
        "id": machine.id,
        "name": machine.name,
        "model": machine.model,
        "serial_no": machine.serial_no,
        "customer_id": machine.customer_id,
        "status": machine.status,
        "equipment_type": machine.equipment_type,
        "manufacturer": machine.manufacturer,
        "site_id": machine.site_id,
        "installed_on": machine.installed_on.isoformat() if machine.installed_on else None,
        "notes": machine.notes,
    }


def read_details(machine, data, customer_id):
    """Type, manufacturer, site, installation date and notes, on a new or edited piece of equipment."""
    if "equipment_type" in data:
        machine.equipment_type = text(data, "equipment_type", "Type", max_length=80)
    if "manufacturer" in data:
        machine.manufacturer = text(data, "manufacturer", "Manufacturer", max_length=100)
    if "installed_on" in data:
        machine.installed_on = iso_date(data, "installed_on", "Installed on")
    if "notes" in data:
        machine.notes = text(data, "notes", "Notes", max_length=4000)
    if "site_id" in data:
        site_id = integer(data, "site_id", "Site")
        if site_id and not Site.query.filter_by(id=site_id, customer_id=customer_id).first():
            raise ValidationError(_("Choose one of this customer's sites"), 404)
        machine.site_id = site_id or None


def serial_taken(company_id, serial_no, exclude_id=None):
    query = Machine.query.filter_by(company_id=company_id, serial_no=serial_no)
    if exclude_id:
        query = query.filter(Machine.id != exclude_id)
    return query.first() is not None


@bp.get("")
@roles("boss", "mechanic", "customer")
def machines():
    user = current_user()
    query = Machine.query.filter_by(company_id=user.company_id)
    if user.role == "customer":
        query = query.filter_by(customer_id=user.customer_id)
    rows = [out(machine) for machine in query.order_by(Machine.name).all()]
    if user.role == "boss":
        rows = with_work(rows, user.company_id)
    return jsonify(machines=rows)


@bp.post("")
@roles("boss")
def create():
    company_id = current_user().company_id
    data = json_body()
    name = text(data, "name", "Name", required=True, max_length=150)
    serial_no = text(data, "serial_no", "Serial number", required=True, max_length=120)
    customer_id = integer(data, "customer_id", "Customer", required=True)
    if not Customer.query.filter_by(id=customer_id, company_id=company_id).first():
        raise ValidationError(_("Customer not found"), 404)
    if serial_taken(company_id, serial_no):
        raise ValidationError(_("Equipment with this serial number already exists"), 409)

    machine = Machine(
        company_id=company_id,
        name=name,
        model=text(data, "model", "Model", max_length=100),
        serial_no=serial_no,
        customer_id=customer_id,
        status=choice(data, "status", MACHINE_STATUSES, "Status", default="Operational"),
    )
    read_details(machine, data, customer_id)
    db.session.add(machine)
    db.session.commit()
    return jsonify(id=machine.id, machine=out(machine)), 201


@bp.patch("/<int:mid>")
@roles("boss")
def update(mid):
    machine = Machine.query.filter_by(id=mid, company_id=current_user().company_id).first_or_404()
    data = json_body()
    if "name" in data:
        machine.name = text(data, "name", "Name", required=True, max_length=150)
    if "model" in data:
        machine.model = text(data, "model", "Model", max_length=100)
    if "serial_no" in data:
        serial_no = text(data, "serial_no", "Serial number", required=True, max_length=120)
        if serial_taken(machine.company_id, serial_no, exclude_id=machine.id):
            raise ValidationError(_("Equipment with this serial number already exists"), 409)
        machine.serial_no = serial_no
    if "status" in data:
        machine.status = choice(data, "status", MACHINE_STATUSES, "Status", default=machine.status)
    read_details(machine, data, machine.customer_id)
    db.session.commit()
    return jsonify(ok=True, machine=out(machine))


@bp.delete("/<int:mid>")
@roles("boss")
def delete(mid):
    machine = Machine.query.filter_by(id=mid, company_id=current_user().company_id).first_or_404()
    has_history = any(
        model.query.filter_by(machine_id=machine.id).first()
        for model in (Job, ServiceRecord, ServiceRequest, Review)
    )
    if has_history:
        return jsonify(error=_("This equipment has service history and cannot be deleted. Mark it as Retired instead.")), 409
    audit.record("machine_deleted", user=current_user(), detail=machine.name)
    # Its documents and maintenance plans go with it (they aren't service history).
    documents = JobFile.query.filter_by(machine_id=machine.id).all()
    keys = [document.storage_key for document in documents]
    for document in documents:
        db.session.delete(document)
    MaintenancePlan.query.filter_by(machine_id=machine.id).delete()
    db.session.delete(machine)
    db.session.commit()
    for key in keys:
        storage().delete(key)
    return jsonify(ok=True)
