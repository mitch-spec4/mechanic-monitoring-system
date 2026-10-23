import io
from zoneinfo import available_timezones

from flask import Blueprint, jsonify, request, send_file
from sqlalchemy import or_

from app import db
from app.models.company import Company
from app.models.customer import Customer
from app.models.invitation import Invitation
from app.models.job import Job
from app.models.machine import Machine
from app.models.security import AuditEvent
from app.models.user import User
from app.services import audit, rate_limit
from app.services.company_data import cancel_deletion, request_deletion
from app.services.data_export import build_export
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


def confirm_password(user, data):
    password = data.get("password")
    if not isinstance(password, str) or not user.check_password(password):
        raise ValidationError(_("Your current password is incorrect"))


@bp.get("/activity")
@roles("boss")
def activity():
    """The activity log, newest first, 50 at a time (?before=<id> for the next page)."""
    user = current_user()
    query = AuditEvent.query.filter_by(company_id=user.company_id)
    before = request.args.get("before", type=int)
    if before:
        query = query.filter(AuditEvent.id < before)
    events = query.order_by(AuditEvent.id.desc()).limit(51).all()
    return jsonify(events=[audit.event_out(event) for event in events[:50]], more=len(events) > 50)


@bp.post("/export")
@roles("boss")
def export():
    """Download everything as a ZIP. Asks for the password again: it's the whole company's data."""
    user = current_user()
    key = f"export:{user.company_id}"
    rate_limit.check(key, setting="EXPORT_RATE_LIMIT")
    confirm_password(user, json_body())
    rate_limit.record(key)
    audit.record("data_exported", user=user)
    db.session.commit()
    data, filename = build_export(user.company_id)
    return send_file(io.BytesIO(data), mimetype="application/zip", as_attachment=True, download_name=filename)


@bp.post("/delete")
@roles("boss")
def delete_company_request():
    """'Delete my company': type the company's name and your password. Everyone is signed out,
    and everything is deleted in 30 days unless a manager cancels."""
    user = current_user()
    company = db.get_or_404(Company, user.company_id)
    if company.is_demo:
        raise ValidationError(_("Demo companies delete themselves after 24 hours."))
    data = json_body()
    confirm_password(user, data)
    if str(data.get("company_name") or "").strip().casefold() != company.name.strip().casefold():
        raise ValidationError(_("Type the company's name exactly as it is shown."))
    if company.deletion_due_at:
        raise ValidationError(_("This company is already waiting to be deleted."), 409)
    request_deletion(company, user)
    audit.record("deletion_requested", user=user)
    # Sign everyone out, the manager included: the next sign-in shows the deletion date.
    for member in User.query.filter_by(company_id=company.id):
        member.token_version = (member.token_version or 0) + 1
    db.session.commit()
    return jsonify(deletion_due=company.deletion_due_at.isoformat())


@bp.post("/delete/cancel")
@roles("boss")
def cancel_company_deletion():
    user = current_user()
    company = db.get_or_404(Company, user.company_id)
    if not company.deletion_due_at:
        raise ValidationError(_("This company isn't waiting to be deleted."), 409)
    cancel_deletion(company)
    audit.record("deletion_cancelled", user=user)
    db.session.commit()
    return jsonify(ok=True)
