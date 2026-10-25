import secrets
from datetime import timedelta

from flask import Blueprint, jsonify

from app import db
from app.models.customer import Customer
from app.models.equipment import Site
from app.models.invitation import Invitation
from app.models.job import Job
from app.models.machine import Machine
from app.models.request import CustomerMessage, ServiceRequest
from app.models.review import Review
from app.models.service_record import ServiceRecord
from app.models.user import User
from app.routes.machines import out as machine_out
from app.routes.services import out as record_out
from app.services.accounts import forget_sign_in, send_invitation
from app.services.billing import check_mechanic_limit, require_active
from app.services.machine_work import with_work
from app.utils.auth import current_user, roles
from app.utils.time import utcnow
from app.utils.validation import ValidationError, json_body, text
from app.utils.validation import email as read_email
from app.i18n import _
from app.services import audit
from app.models.security import AuditEvent

bp = Blueprint("customers", __name__)
INVITATION_DAYS = 7


def customer_out(customer):
    login_user = User.query.filter_by(customer_id=customer.id, role="customer", removed_at=None).first()
    return {
        "id": customer.id,
        "name": customer.name,
        "email": customer.email,
        "phone": customer.phone,
        "user_id": login_user.id if login_user else None,
        "two_factor_enabled": bool(login_user and login_user.totp_enabled_at),
    }


def machines_for(company_id, customer_ids):
    """Machines (with their needs-work reasons) grouped by customer."""
    machines = Machine.query.filter(Machine.company_id == company_id, Machine.customer_id.in_(customer_ids)).order_by(Machine.name).all()
    rows = with_work([machine_out(machine) for machine in machines], company_id)
    grouped = {customer_id: [] for customer_id in customer_ids}
    for row in rows:
        grouped[row["customer_id"]].append(row)
    return grouped


@bp.get("")
@roles("boss")
def customers():
    company_id = current_user().company_id
    rows = Customer.query.filter_by(company_id=company_id).order_by(Customer.name).all()
    machines = machines_for(company_id, [customer.id for customer in rows])
    result = []
    for customer in rows:
        data = customer_out(customer)
        data["machine_count"] = len(machines[customer.id])
        data["needs_work_count"] = sum(1 for machine in machines[customer.id] if machine["needs_work"])
        result.append(data)
    return jsonify(customers=result)


@bp.get("/<int:cid>")
@roles("boss")
def customer_detail(cid):
    """A customer with every machine (those needing work first) and their recent service history."""
    company_id = current_user().company_id
    customer = Customer.query.filter_by(id=cid, company_id=company_id).first_or_404()
    machines = machines_for(company_id, [customer.id])[customer.id]
    machines.sort(key=lambda machine: (not machine["needs_work"], machine["status"] == "Retired", machine["name"].lower()))
    jobs = Job.query.filter_by(company_id=company_id, customer_id=customer.id)
    records = (
        ServiceRecord.query.filter_by(company_id=company_id, customer_id=customer.id)
        .order_by(ServiceRecord.service_date.desc(), ServiceRecord.id.desc())
        .limit(10)
        .all()
    )
    sites = Site.query.filter_by(customer_id=customer.id).order_by(Site.name).all()
    data = customer_out(customer)
    data.update(
        sites=[
            {"id": site.id, "name": site.name, "address": site.address, "notes": site.notes, "machine_count": sum(1 for m in machines if m["site_id"] == site.id)}
            for site in sites
        ],
        machines=machines,
        needs_work_count=sum(1 for machine in machines if machine["needs_work"]),
        job_count=jobs.count(),
        completed_job_count=jobs.filter_by(status="Completed").count(),
        records=[record_out(record) for record in records],
    )
    return jsonify(customer=data)


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
        raise ValidationError(_("Only customers and technicians can be invited"))
    if User.query.filter_by(email=email).first():
        raise ValidationError(_("This email address already has an account"), 409)
    if not user.email_verified_at:
        # Invitations are emailed, so an unconfirmed account can't make the app email strangers.
        raise ValidationError(
            _(
                "Confirm your email address first: open the link we sent to {email}. You can send a new link from the banner at the top of the page.",
                email=user.email,
            ),
            403,
        )
    require_active(user.company_id, _("invite people"))
    if role == "mechanic":
        check_mechanic_limit(user.company_id)

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
    audit.record("invitation_sent", user=user, detail=email)
    db.session.commit()
    emailed = send_invitation(invitation, user)
    return jsonify(code=code, expires_at=invitation.expires_at.isoformat(), emailed=emailed), 201


@bp.patch("/<int:cid>")
@roles("boss")
def update_customer(cid):
    customer = Customer.query.filter_by(id=cid, company_id=current_user().company_id).first_or_404()
    data = json_body()
    if "name" in data:
        customer.name = text(data, "name", "Name", required=True, max_length=150)
    if "phone" in data:
        customer.phone = text(data, "phone", "Phone", max_length=50)
    if "email" in data:
        # The contact email; a customer's sign-in email is managed on their user account.
        customer.email = read_email(data)
    db.session.commit()
    return jsonify(ok=True, customer=customer_out(customer))


@bp.delete("/<int:cid>")
@roles("boss")
def delete_customer(cid):
    customer = Customer.query.filter_by(id=cid, company_id=current_user().company_id).first_or_404()
    has_history = any(
        model.query.filter_by(customer_id=customer.id).first()
        for model in (Machine, Job, ServiceRecord, ServiceRequest, Review)
    )
    if has_history:
        return jsonify(error=_("This customer has equipment or service history and cannot be deleted.")), 409

    # Their chat with the company and their sites go with them.
    CustomerMessage.query.filter_by(customer_id=customer.id).delete()
    Site.query.filter_by(customer_id=customer.id).delete()
    for customer_user in User.query.filter_by(customer_id=customer.id).all():
        forget_sign_in(customer_user)
        AuditEvent.query.filter_by(user_id=customer_user.id).update({"user_id": None})
        db.session.delete(customer_user)
    db.session.flush()
    audit.record("customer_deleted", user=current_user(), detail=customer.name)
    db.session.delete(customer)
    db.session.commit()
    return jsonify(ok=True)
