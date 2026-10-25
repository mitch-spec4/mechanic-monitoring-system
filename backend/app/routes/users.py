import secrets
from datetime import timedelta

from flask import Blueprint, jsonify
from sqlalchemy.exc import IntegrityError

from app import db
from app.models.job import Job
from app.models.security import AuditEvent, PasswordReset
from app.models.user import User
from app.models.location import Shift
from app.routes.auth import hash_code, user_payload
from app.services import audit, two_factor
from app.services.accounts import forget_sign_in, send_verification
from app.services.billing import require_feature
from app.i18n import LANGUAGES
from app.utils.auth import current_user, roles
from app.utils.time import utcnow
from app.utils.validation import ValidationError, choice, json_body, money, text
from app.utils.validation import email as read_email
from app.i18n import N_, _

bp = Blueprint("users", __name__)
RESET_CODE_HOURS = 24


def out(user):
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role, "two_factor_enabled": user.totp_enabled_at is not None}


@bp.get("")
@roles("boss")
def list_users():
    users = User.query.filter_by(company_id=current_user().company_id, removed_at=None).order_by(User.name).all()
    return jsonify(users=[out(user) for user in users])


@bp.get("/mechanics")
@roles("boss")
def mechanics():
    users = User.query.filter_by(company_id=current_user().company_id, role="mechanic", removed_at=None).order_by(User.name).all()
    return jsonify(
        mechanics=[
            {"id": user.id, "name": user.name, "email": user.email, "two_factor_enabled": user.totp_enabled_at is not None, "pay_rate_cents": user.pay_rate_cents}
            for user in users
        ]
    )


@bp.get("/me")
@roles("boss", "mechanic", "customer", before_two_factor=True)
def me():
    return jsonify(user=user_payload(current_user()))


@bp.patch("/me")
@roles("boss", "mechanic", "customer", before_two_factor=True)
def update_me():
    """Each person picks the language they read the app, emails and notifications in."""
    user = current_user()
    user.language = choice(json_body(), "language", tuple(LANGUAGES), "Language", default=user.language)
    db.session.commit()
    return jsonify(user=user_payload(user))


@bp.patch("/<int:uid>")
@roles("boss")
def update_user(uid):
    user = User.query.filter_by(id=uid, company_id=current_user().company_id, removed_at=None).first_or_404()
    data = json_body()
    if "name" in data:
        user.name = text(data, "name", "Name", required=True, max_length=120)
    changed_email = False
    if "email" in data:
        email = read_email(data)
        if User.query.filter(User.email == email, User.id != uid).first():
            raise ValidationError(_("That email address cannot be used"), 409)
        if email != user.email:
            # The new address isn't proven until its owner opens a link sent to it.
            user.email, user.email_verified_at, changed_email = email, None, True
    if "pay_rate" in data:
        # What an hour of a technician's time costs the company: for job costing.
        require_feature(user.company_id, "costing")
        if user.role != "mechanic":
            raise ValidationError(_("Only technicians have a pay rate."))
        user.pay_rate_cents = money(data, "pay_rate", N_("Pay rate per hour"))
    db.session.commit()
    if changed_email and user.role == "boss":
        send_verification(user)
    return jsonify(ok=True, user=out(user))


@bp.post("/<int:uid>/reset-code")
@roles("boss")
def issue_reset_code(uid):
    """Give a team member a one-time code to set a new password (until email delivery exists)."""
    manager = current_user()
    if uid == manager.id:
        return jsonify(error=_("Use Change password in Settings for your own account")), 400
    user = User.query.filter_by(id=uid, company_id=manager.company_id, removed_at=None).first_or_404()
    PasswordReset.query.filter_by(user_id=user.id, used=False).update({"used": True})
    code = "RS-" + secrets.token_hex(5).upper()
    reset = PasswordReset(
        user_id=user.id,
        code_hash=hash_code(code),
        created_by=manager.id,
        expires_at=utcnow() + timedelta(hours=RESET_CODE_HOURS),
    )
    db.session.add(reset)
    db.session.commit()
    return jsonify(code=code, email=user.email, name=user.name, expires_at=reset.expires_at.isoformat()), 201


@bp.post("/<int:uid>/reset-two-factor")
@roles("boss")
def reset_two_factor(uid):
    """For someone who lost their phone and backup codes: they're signed out and set up two-step
    sign-in again at their next sign-in."""
    manager = current_user()
    if uid == manager.id:
        return jsonify(error=_("Use your backup codes, or ask another manager, to reset your own two-step sign-in.")), 400
    user = User.query.filter_by(id=uid, company_id=manager.company_id, removed_at=None).first_or_404()
    two_factor.disable(user)
    user.token_version = (user.token_version or 0) + 1
    audit.record("two_factor_reset", user=manager, detail=user.email)
    db.session.commit()
    return jsonify(ok=True)


@bp.delete("/<int:uid>")
@roles("boss")
def delete_user(uid):
    """Remove someone from the company. Without work in the history they're deleted; otherwise
    their access ends and their account is kept, so jobs, shifts, payments, messages and forms
    still name them. Either way they're signed out everywhere and left out of every list."""
    manager = current_user()
    if uid == manager.id:
        return jsonify(error=_("You cannot delete your own account")), 400
    user = User.query.filter_by(id=uid, company_id=manager.company_id, removed_at=None).first_or_404()
    open_jobs = Job.query.filter(Job.mechanic_id == user.id, Job.status.notin_(("Completed", "Cancelled"))).count()
    if open_jobs:
        return jsonify(error=_("Reassign {name}'s open jobs first ({count}).", name=user.name, count=open_jobs)), 409
    email = user.email
    try:
        with db.session.begin_nested():
            forget_sign_in(user)
            # The activity log keeps their name, not a link to an account that no longer exists.
            AuditEvent.query.filter_by(user_id=user.id).update({"user_id": None})
            db.session.delete(user)
            db.session.flush()
        kept = False
    except IntegrityError:
        # Their work is in the history: end their access and keep the account.
        remove_access(user)
        kept = True
    audit.record("member_removed", user=manager, detail=email)
    db.session.commit()
    return jsonify(ok=True, kept=kept)


def remove_access(user):
    """Someone whose work is in the history: they can't sign in again (no password, no email
    that resets one, every session ended) and are left out of lists, but stay named in it."""
    forget_sign_in(user)
    shift = Shift.query.filter_by(user_id=user.id, clocked_out_at=None).first()
    if shift:
        shift.clocked_out_at = utcnow()
    user.removed_at = utcnow()
    user.set_password(secrets.token_urlsafe(32))  # also ends every session (token_version)
    # Frees the address for a new invitation; the activity log keeps the old one.
    user.email = f"removed-{user.id}@removed.invalid"
