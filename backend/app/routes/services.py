from flask import Blueprint, jsonify

from app import db
from app.models.job import Job
from app.models.machine import Machine
from app.models.service_record import ServiceRecord
from app.utils.auth import current_user, roles
from app.utils.validation import ValidationError, integer, json_body, text

bp = Blueprint("services", __name__)
TEXT_FIELDS = ("problem", "work_done", "parts_replaced", "solution", "advice")


def out(record):
    return {
        "id": record.id,
        "machine_id": record.machine_id,
        "customer_id": record.customer_id,
        "mechanic_id": record.mechanic_id,
        "service_type": record.service_type,
        "problem": record.problem,
        "work_done": record.work_done,
        "parts_replaced": record.parts_replaced,
        "solution": record.solution,
        "advice": record.advice,
        "service_date": record.service_date.isoformat(),
    }


@bp.get("")
@roles("boss", "mechanic", "customer")
def list_services():
    user = current_user()
    query = ServiceRecord.query.filter_by(company_id=user.company_id)
    if user.role == "mechanic":
        query = query.filter_by(mechanic_id=user.id)
    if user.role == "customer":
        query = query.filter_by(customer_id=user.customer_id)
    return jsonify(records=[out(record) for record in query.order_by(ServiceRecord.id.desc()).all()])


@bp.post("")
@roles("mechanic")
def create():
    user = current_user()
    data = json_body()
    machine_id = integer(data, "machine_id", "Machine", required=True)
    machine = Machine.query.filter_by(id=machine_id, company_id=user.company_id).first()
    if not machine:
        raise ValidationError("Machine not found", 404)
    has_job = (
        Job.query.filter_by(machine_id=machine.id, mechanic_id=user.id, company_id=user.company_id)
        .filter(Job.status != "Cancelled")
        .first()
    )
    if not has_job:
        raise ValidationError("You can only add service records for machines on your own jobs", 403)
    record = ServiceRecord(
        machine_id=machine.id,
        customer_id=machine.customer_id,
        mechanic_id=user.id,
        company_id=machine.company_id,
        service_type=text(data, "service_type", "Service type", required=True, max_length=80),
        **{field: text(data, field) for field in TEXT_FIELDS},
    )
    db.session.add(record)
    db.session.commit()
    return jsonify(id=record.id, record=out(record)), 201


@bp.patch("/<int:sid>")
@roles("mechanic")
def update(sid):
    user = current_user()
    record = ServiceRecord.query.filter_by(id=sid, mechanic_id=user.id, company_id=user.company_id).first_or_404()
    data = json_body()
    if "service_type" in data:
        record.service_type = text(data, "service_type", "Service type", required=True, max_length=80)
    for field in TEXT_FIELDS:
        if field in data:
            setattr(record, field, text(data, field))
    db.session.commit()
    return jsonify(ok=True, record=out(record))


# Service history is permanent: there is intentionally no delete endpoint.
