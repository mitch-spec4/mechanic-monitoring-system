from zoneinfo import available_timezones

from flask import Blueprint, jsonify
from sqlalchemy import or_

from app import db
from app.models.company import Company
from app.models.customer import Customer
from app.models.invitation import Invitation
from app.models.job import Job
from app.models.machine import Machine
from app.models.user import User
from app.i18n import _
from app.utils.auth import current_user, roles
from app.utils.time import utcnow
from app.utils.validation import ValidationError, choice, json_body, text

# The currencies a company can show money in (more can be added; amounts are stored in cents).
CURRENCIES = ("KES", "TZS", "UGX", "RWF", "ETB", "NGN", "GHS", "ZAR", "USD", "EUR", "GBP")
UNITS = ("metric", "imperial")

bp = Blueprint("company", __name__)


@bp.get("")
@roles("boss", "mechanic", "customer")
def company():
    user = current_user()
    record = db.get_or_404(Company, user.company_id)
    bosses = User.query.filter_by(company_id=user.company_id, role="boss").order_by(User.name).all()
    return jsonify(
        company={
            "id": record.id,
            "name": record.name,
            "location": record.location,
            "contacts": [{"name": boss.name, "email": boss.email} for boss in bosses],
        }
    )


def invited(company_id, role):
    """An invitation that was accepted or can still be."""
    return (
        Invitation.query.filter(
            Invitation.company_id == company_id,
            Invitation.role == role,
            or_(Invitation.used.is_(True), Invitation.expires_at > utcnow()),
        ).first()
        is not None
    )


@bp.get("/setup")
@roles("boss")
def setup():
    """The "Get set up" guide on a new company's dashboard. Each step is worked out from real data."""
    user = current_user()
    company = db.get_or_404(Company, user.company_id)
    has_customer = Customer.query.filter_by(company_id=company.id).first() is not None
    steps = [
        {"key": "verify", "done": user.email_verified_at is not None},
        {"key": "customer", "done": has_customer or invited(company.id, "customer")},
        # Machines belong to a customer, so this waits until one has joined.
        {"key": "machine", "done": Machine.query.filter_by(company_id=company.id).first() is not None, "waiting": not has_customer},
        {"key": "mechanic", "done": User.query.filter_by(company_id=company.id, role="mechanic").first() is not None or invited(company.id, "mechanic")},
        {"key": "job", "done": Job.query.filter_by(company_id=company.id).first() is not None},
    ]
    return jsonify(dismissed=company.setup_dismissed_at is not None, steps=steps)


@bp.post("/setup/dismiss")
@roles("boss")
def dismiss_setup():
    company = db.get_or_404(Company, current_user().company_id)
    company.setup_dismissed_at = company.setup_dismissed_at or utcnow()
    db.session.commit()
    return jsonify(ok=True)


def settings_out(company):
    return {"timezone": company.timezone, "currency": company.currency, "units": company.units}


@bp.get("/settings")
@roles("boss")
def settings():
    company = db.get_or_404(Company, current_user().company_id)
    return jsonify(settings=settings_out(company), currencies=CURRENCIES, units=UNITS, timezones=sorted(available_timezones()))


@bp.patch("/settings")
@roles("boss")
def update_settings():
    """Company-wide settings: the time zone everyone's times are shown in, and the currency and
    units for money and distances."""
    company = db.get_or_404(Company, current_user().company_id)
    data = json_body()
    if "timezone" in data:
        zone = text(data, "timezone", "Time zone", required=True, max_length=64)
        if zone not in available_timezones():
            raise ValidationError(_("Choose a time zone from the list"))
        company.timezone = zone
    company.currency = choice(data, "currency", CURRENCIES, "Currency", default=company.currency)
    company.units = choice(data, "units", UNITS, "Units", default=company.units)
    db.session.commit()
    return jsonify(settings=settings_out(company))
