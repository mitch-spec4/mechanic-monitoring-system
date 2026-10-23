from flask import Blueprint, jsonify

from app import db
from app.models.constants import MACHINE_STATUSES
from app.models.customer import Customer
from app.models.job import Job
from app.models.machine import Machine
from app.models.request import ServiceRequest
from app.models.review import Review
from app.models.service_record import ServiceRecord
from app.services.machine_work import with_work
from app.utils.auth import current_user, roles
from app.utils.validation import ValidationError, choice, integer, json_body, text
from app.i18n import _

bp = Blueprint("machines", __name__)


def out(machine):
    return {
        "id": machine.id,
        "name": machine.name,
        "model": machine.model,
        "serial_no": machine.serial_no,
        "customer_id": machine.customer_id,
        "status": machine.status,
    }


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
    db.session.delete(machine)
    db.session.commit()
    return jsonify(ok=True)
