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
from app.models.worksheet import JobEvent
from app.routes.auth import hash_code
from app.utils.auth import current_user, roles
from app.utils.time import utcnow
from app.utils.validation import ValidationError, json_body, text
from app.utils.validation import email as read_email

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
    user = current_user()
    return jsonify(user={**out(user), "company_id": user.company_id, "customer_id": user.customer_id})


@bp.patch("/<int:uid>")
@roles("boss")
def update_user(uid):
    user = User.query.filter_by(id=uid, company_id=current_user().company_id).first_or_404()
    data = json_body()
    if "name" in data:
        user.name = text(data, "name", "Name", required=True, max_length=120)
    if "email" in data:
        email = read_email(data)
        if User.query.filter(User.email == email, User.id != uid).first():
            raise ValidationError("That email address cannot be used", 409)
        user.email = email
    db.session.commit()
    return jsonify(ok=True, user=out(user))


@bp.post("/<int:uid>/reset-code")
@roles("boss")
def issue_reset_code(uid):
    """Give a team member a one-time code to set a new password (until email delivery exists)."""
    manager = current_user()
    if uid == manager.id:
        return jsonify(error="Use Change password in Settings for your own account"), 400
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
        return jsonify(error="You cannot delete your own account"), 400
    user = User.query.filter_by(id=uid, company_id=current_user().company_id).first_or_404()
    if user.role == "mechanic":
        has_history = (
            Job.query.filter_by(mechanic_id=user.id).first()
            or ServiceRecord.query.filter_by(mechanic_id=user.id).first()
            or Review.query.filter_by(mechanic_id=user.id).first()
        )
        if has_history:
            return jsonify(error="This mechanic has jobs or service history and cannot be deleted."), 409
    if JobEvent.query.filter_by(user_id=user.id).first():
        return jsonify(error="This person appears in job history and cannot be deleted."), 409
    Notification.query.filter_by(user_id=user.id).delete()
    PasswordReset.query.filter((PasswordReset.user_id == user.id) | (PasswordReset.created_by == user.id)).delete()
    db.session.delete(user)
    db.session.commit()
    return jsonify(ok=True)
