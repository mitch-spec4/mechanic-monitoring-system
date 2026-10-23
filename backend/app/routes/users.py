import secrets
from datetime import timedelta

from flask import Blueprint, jsonify

from app import db
from app.models.job import Job
from app.models.notification import Notification
from app.models.review import Review
from app.models.security import PasswordReset
from app.models.service_record import ServiceRecord
from app.models.user import User
from app.models.location import Shift
from app.models.worksheet import JobEvent
from app.routes.auth import hash_code, user_payload
from app.services.accounts import send_verification
from app.i18n import LANGUAGES
from app.utils.auth import current_user, roles
from app.utils.time import utcnow
from app.utils.validation import ValidationError, choice, json_body, text
from app.utils.validation import email as read_email
from app.i18n import _

bp = Blueprint("users", __name__)
RESET_CODE_HOURS = 24


def out(user):
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role}


@bp.get("")
@roles("boss")
def list_users():
    users = User.query.filter_by(company_id=current_user().company_id).order_by(User.name).all()
    return jsonify(users=[out(user) for user in users])


@bp.get("/mechanics")
@roles("boss")
def mechanics():
    users = User.query.filter_by(company_id=current_user().company_id, role="mechanic").order_by(User.name).all()
    return jsonify(mechanics=[{"id": user.id, "name": user.name, "email": user.email} for user in users])


@bp.get("/me")
@roles("boss", "mechanic", "customer")
def me():
    return jsonify(user=user_payload(current_user()))


@bp.patch("/me")
@roles("boss", "mechanic", "customer")
def update_me():
    """Each person picks the language they read the app, emails and notifications in."""
    user = current_user()
    user.language = choice(json_body(), "language", tuple(LANGUAGES), "Language", default=user.language)
    db.session.commit()
    return jsonify(user=user_payload(user))


@bp.patch("/<int:uid>")
@roles("boss")
def update_user(uid):
    user = User.query.filter_by(id=uid, company_id=current_user().company_id).first_or_404()
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
    user = User.query.filter_by(id=uid, company_id=manager.company_id).first_or_404()
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


@bp.delete("/<int:uid>")
@roles("boss")
def delete_user(uid):
    if uid == current_user().id:
        return jsonify(error=_("You cannot delete your own account")), 400
    user = User.query.filter_by(id=uid, company_id=current_user().company_id).first_or_404()
    if user.role == "mechanic":
        has_history = (
            Job.query.filter_by(mechanic_id=user.id).first()
            or ServiceRecord.query.filter_by(mechanic_id=user.id).first()
            or Review.query.filter_by(mechanic_id=user.id).first()
        )
        if has_history:
            return jsonify(error=_("This technician has jobs or service history and cannot be deleted.")), 409
    if JobEvent.query.filter_by(user_id=user.id).first():
        return jsonify(error=_("This person appears in job history and cannot be deleted.")), 409
    if Shift.query.filter_by(user_id=user.id).first():
        return jsonify(error=_("This technician has shift records and cannot be deleted.")), 409
    Notification.query.filter_by(user_id=user.id).delete()
    PasswordReset.query.filter((PasswordReset.user_id == user.id) | (PasswordReset.created_by == user.id)).delete()
    db.session.delete(user)
    db.session.commit()
    return jsonify(ok=True)
