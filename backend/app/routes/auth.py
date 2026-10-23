import hashlib

from flask import Blueprint, jsonify
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
    set_access_cookies,
    set_refresh_cookies,
    unset_jwt_cookies,
)

from app import db
from app.models.company import Company
from app.models.customer import Customer
from app.models.invitation import Invitation
from app.models.security import PasswordReset
from app.models.user import User
from app.services import rate_limit
from app.services.accounts import mark_verified, send_password_reset, send_verification, user_for_reset, user_for_verification
from app.utils.auth import current_user, roles
from app.utils.time import utcnow
from app.utils.validation import ValidationError, json_body, text
from app.utils.validation import email as read_email

bp = Blueprint("auth", __name__)
MIN_PASSWORD_LENGTH = 8


def user_payload(user):
    company = db.session.get(Company, user.company_id)
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "company_id": user.company_id,
        "customer_id": user.customer_id,
        "email_verified": user.email_verified_at is not None,
        # A visitor's private demo company: when it will be deleted.
        "demo_until": company.demo_expires_at.isoformat() if company and company.is_demo else None,
    }


def demo_ended(user):
    company = db.session.get(Company, user.company_id)
    return company is not None and company.is_demo and company.demo_expires_at <= utcnow()


def claims_for(user):
    return {
        "role": user.role,
        "company_id": user.company_id,
        "customer_id": user.customer_id,
        "tv": user.token_version,
    }


def access_token_for(user):
    return create_access_token(identity=str(user.id), additional_claims=claims_for(user))


def signed_in_response(user, status=200, **extra):
    """Put the session in httpOnly cookies; the body only carries public profile data."""
    response = jsonify(user=user_payload(user), **extra)
    set_access_cookies(response, access_token_for(user))
    set_refresh_cookies(response, create_refresh_token(identity=str(user.id), additional_claims={"tv": user.token_version}))
    return response, status


def new_password(data, field="password"):
    password = data.get(field)
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
        raise ValidationError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    return password


def hash_code(code):
    return hashlib.sha256(code.strip().upper().encode()).hexdigest()


@bp.post("/login")
def login():
    data = json_body()
    email = str(data.get("email") or "").strip().lower()
    password = data.get("password")
    keys = (f"login-ip:{rate_limit.client_ip()}", f"login-email:{email}")
    rate_limit.check(*keys)
    user = User.query.filter_by(email=email).first() if email else None
    if not user or not isinstance(password, str) or not user.check_password(password):
        rate_limit.record(*keys)
        return jsonify(error="Invalid email or password"), 401
    return signed_in_response(user)


@bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    user = db.session.get(User, int(get_jwt_identity()))
    if not user or get_jwt().get("tv") != user.token_version or demo_ended(user):
        response = jsonify(error="Your session has ended. Please sign in again.")
        unset_jwt_cookies(response)
        return response, 401
    response = jsonify(user=user_payload(user))
    set_access_cookies(response, access_token_for(user))
    return response


@bp.post("/logout")
def logout():
    response = jsonify(ok=True)
    unset_jwt_cookies(response)
    return response


@bp.post("/register")
def register():
    return jsonify(error="Accounts are created through a company invitation"), 403


@bp.post("/accept-invitation")
def accept_invitation():
    key = f"invite-ip:{rate_limit.client_ip()}"
    rate_limit.check(key)
    rate_limit.record(key)
    data = json_body()
    code = text(data, "code", "Invitation code", required=True, max_length=80)
    name = text(data, "name", "Name", required=True, max_length=120)
    email = read_email(data)
    password = new_password(data)

    invitation = Invitation.query.filter_by(code=code, used=False).first()
    if not invitation or invitation.expires_at < utcnow():
        return jsonify(error="Invalid or expired invitation"), 400
    if email != invitation.email.strip().lower():
        return jsonify(error="This invitation was issued to a different email address"), 403
    if User.query.filter_by(email=email).first():
        return jsonify(error="An account with this email already exists. Sign in instead."), 409

    customer_id = None
    if invitation.role == "customer":
        customer = Customer(name=name, email=email, company_id=invitation.company_id)
        db.session.add(customer)
        db.session.flush()
        customer_id = customer.id

    user = User(
        name=name,
        email=email,
        role=invitation.role,
        company_id=invitation.company_id,
        customer_id=customer_id,
    )
    user.set_password(password)
    invitation.used = True
    db.session.add(user)
    db.session.commit()
    return jsonify(message="Invitation accepted"), 201


@bp.post("/verify-email")
def verify_email():
    """The link in the verification email. Works without signing in: the signed link is the proof."""
    user = user_for_verification(json_body().get("token"))
    mark_verified(user)
    db.session.commit()
    return jsonify(message="Your email address is confirmed.", email=user.email)


@bp.post("/resend-verification")
@roles("boss", "mechanic", "customer")
def resend_verification():
    user = current_user()
    if user.email_verified_at:
        return jsonify(message="Your email address is already confirmed.", sent=False)
    key = f"verify-mail:{user.id}"
    rate_limit.check(key, setting="EMAIL_RATE_LIMIT")
    rate_limit.record(key)
    if not send_verification(user):
        raise ValidationError("The email couldn't be sent just now. Please try again in a few minutes.", 503)
    return jsonify(message=f"We sent a new link to {user.email}.", sent=True)


@bp.post("/forgot-password")
def forgot_password():
    """Email a reset link. The answer is the same whether or not the address has an account."""
    data = json_body()
    email = read_email(data)
    ip_key, email_key = f"forgot-ip:{rate_limit.client_ip()}", f"forgot-email:{email}"
    rate_limit.check(ip_key)
    rate_limit.check(email_key, setting="EMAIL_RATE_LIMIT")
    rate_limit.record(ip_key, email_key)
    user = User.query.filter_by(email=email).first()
    if user:
        send_password_reset(user)
    return jsonify(message="If an account uses that email, we've sent it a link to choose a new password. The link works for 1 hour.")


@bp.post("/reset-password")
def reset_password():
    """Set a new password with the link from a reset email, or with a one-time code from the
    user's manager."""
    key = f"reset-ip:{rate_limit.client_ip()}"
    rate_limit.check(key)
    rate_limit.record(key)
    data = json_body()
    if data.get("token") is not None:
        user = user_for_reset(data.get("token"))
        user.set_password(new_password(data))
        # Only the owner of the address could open the link.
        mark_verified(user)
        db.session.commit()
        return jsonify(message="Password updated. You can now sign in.", email=user.email)
    email = read_email(data)
    code = text(data, "code", "Reset code", required=True, max_length=40)
    password = new_password(data)

    user = User.query.filter_by(email=email).first()
    reset = (
        PasswordReset.query.filter_by(code_hash=hash_code(code), used=False).first()
        if user
        else None
    )
    if not reset or reset.user_id != user.id or reset.expires_at < utcnow():
        return jsonify(error="Invalid or expired reset code"), 400
    user.set_password(password)
    reset.used = True
    db.session.commit()
    return jsonify(message="Password updated. You can now sign in.")


@bp.post("/change-password")
@roles("boss", "mechanic", "customer")
def change_password():
    user = current_user()
    data = json_body()
    current = data.get("current_password")
    if not isinstance(current, str) or not user.check_password(current):
        return jsonify(error="Your current password is incorrect"), 400
    user.set_password(new_password(data, "new_password"))
    db.session.commit()
    # Changing the password ends every other session; keep this one signed in.
    return signed_in_response(user)
