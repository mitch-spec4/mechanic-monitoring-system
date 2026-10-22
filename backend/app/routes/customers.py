import secrets
from datetime import timedelta

from flask import Blueprint, jsonify

from app import db
from app.models.constants import DEFAULT_PRIORITY, PRIORITIES, REQUEST_STATUSES
from app.models.customer import Customer
from app.models.invitation import Invitation
from app.models.job import Job
from app.models.machine import Machine
from app.models.notification import Notification
from app.models.request import ServiceRequest
from app.models.review import Review
from app.models.service_record import ServiceRecord
from app.models.user import User
from app.services.notifications import notify, notify_bosses
from app.utils.auth import current_user, roles
from app.utils.time import utcnow
from app.utils.validation import ValidationError, choice, integer, json_body, text
from app.utils.validation import email as read_email

bp = Blueprint("customers", __name__)
INVITATION_DAYS = 7


def customer_out(customer):
    return {"id": customer.id, "name": customer.name, "email": customer.email, "phone": customer.phone}


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
    }


@bp.get("")
@roles("boss")
def customers():
    rows = Customer.query.filter_by(company_id=current_user().company_id).order_by(Customer.name).all()
    return jsonify(customers=[customer_out(customer) for customer in rows])


@bp.get("/me")
@roles("customer")
def me():
    user = current_user()
    customer = Customer.query.filter_by(id=user.customer_id, company_id=user.company_id).first_or_404()
    return jsonify(customer=customer_out(customer))


@bp.post("/invite")
@roles("boss")
def invite():
    user = current_user()
    data = json_body()
    name = text(data, "name", "Name", required=True, max_length=150)
    email = read_email(data)
    role = data.get("role") or "customer"
    if role not in {"customer", "mechanic"}:
        raise ValidationError("Only customers and mechanics can be invited")

    code = "DK-" + secrets.token_hex(5).upper()
    invitation = Invitation(
        code=code,
        company_id=user.company_id,
        customer_name=name,
        email=email,
        role=role,
        expires_at=utcnow() + timedelta(days=INVITATION_DAYS),
    )
    db.session.add(invitation)
    db.session.commit()
    return jsonify(code=code, expires_at=invitation.expires_at.isoformat()), 201


@bp.get("/requests")
@roles("boss", "customer")
def requests_list():
    user = current_user()
    query = ServiceRequest.query.filter_by(company_id=user.company_id)
    if user.role == "customer":
        query = query.filter_by(customer_id=user.customer_id)
    return jsonify(requests=[request_out(row) for row in query.order_by(ServiceRequest.id.desc()).all()])


@bp.post("/requests")
@roles("customer")
def create_request():
    user = current_user()
    data = json_body()
    machine_id = integer(data, "machine_id", "Machine", required=True)
    machine = Machine.query.filter_by(
        id=machine_id, customer_id=user.customer_id, company_id=user.company_id
    ).first()
    if not machine:
        raise ValidationError("Machine not found", 404)

    service_request = ServiceRequest(
        customer_id=user.customer_id,
        company_id=user.company_id,
        machine_id=machine.id,
        subject=text(data, "subject", "Subject", required=True, max_length=180),
        description=text(data, "description", "Description", required=True),
        priority=choice(data, "priority", PRIORITIES, default=DEFAULT_PRIORITY),
    )
    db.session.add(service_request)
    notify_bosses(user.company_id, "New customer service request", f"{service_request.subject} was submitted.", "request")
    db.session.commit()
    return jsonify(id=service_request.id), 201


@bp.patch("/requests/<int:rid>")
@roles("boss")
def update_request(rid):
    service_request = ServiceRequest.query.filter_by(id=rid, company_id=current_user().company_id).first_or_404()
    data = json_body()
    status = choice(data, "status", REQUEST_STATUSES, "Status", default=service_request.status)
    if status != service_request.status:
        service_request.status = status
        for customer_user in User.query.filter_by(
            company_id=service_request.company_id, customer_id=service_request.customer_id, role="customer"
        ).all():
            notify(customer_user.id, "Service request updated", f"Your request is now {status}.", "request")
    db.session.commit()
    return jsonify(ok=True, status=service_request.status)


@bp.delete("/<int:cid>")
@roles("boss")
def delete_customer(cid):
    customer = Customer.query.filter_by(id=cid, company_id=current_user().company_id).first_or_404()
    has_history = any(
        model.query.filter_by(customer_id=customer.id).first()
        for model in (Machine, Job, ServiceRecord, ServiceRequest, Review)
    )
    if has_history:
        return jsonify(error="This customer has machines or service history and cannot be deleted."), 409

    for customer_user in User.query.filter_by(customer_id=customer.id).all():
        Notification.query.filter_by(user_id=customer_user.id).delete()
        db.session.delete(customer_user)
    db.session.flush()
    db.session.delete(customer)
    db.session.commit()
    return jsonify(ok=True)
