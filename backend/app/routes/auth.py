import hashlib

from flask import Blueprint, jsonify, request
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
from app.services import audit, rate_limit, two_factor
from app.services.accounts import mark_verified, send_password_reset, send_verification, user_for_reset, user_for_verification
from app.utils.auth import current_user, roles
from app.utils.time import utcnow
from app.services.legal import record_agreement
from app.utils.validation import ValidationError, agreed_to_terms, json_body, text
from app.utils.validation import email as read_email
from app.i18n import _, current_language

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
        "language": user.language,
        # Times are shown in the company's time zone, so everyone on the team sees the same times.
        "timezone": company.timezone if company else "Africa/Nairobi",
        "units": company.units if company else "metric",
        # Two-step sign-in: whether it's on, and whether this person must set it up before going on.
        "two_factor_enabled": user.totp_enabled_at is not None,
        "two_factor_setup_needed": two_factor.needs_setup(user),
        # Set while the company is waiting to be deleted: when it happens.
        "deletion_due": company.deletion_due_at.isoformat() if company and company.deletion_due_at else None,
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
        raise ValidationError(_("Password must be at least {count} characters", count=MIN_PASSWORD_LENGTH))
    return password


def hash_code(code):
    return hashlib.sha256(code.strip().upper().encode()).hexdigest()


def locked_response(user):
    return jsonify(
        error=_("Too many wrong attempts. This account is locked for {count} more minutes.", count=two_factor.minutes_locked(user)),
        locked=True,
    ), 423


def finish_sign_in(user, remember=False):
    """The password (and the code, where needed) were right: start the session."""
    two_factor.succeeded(user)
    db.session.commit()
    response, status = signed_in_response(user)
    if remember:
        two_factor.remember_device(response, user)
        db.session.commit()
    return response, status


@bp.post("/login")
def login():
    """Step one: email and password. Someone with two-step sign-in gets a short-lived ticket to
    send with their code (step two), unless this browser was remembered."""
    data = json_body()
    email = str(data.get("email") or "").strip().lower()
    password = data.get("password")
    keys = (f"login-ip:{rate_limit.client_ip()}", f"login-email:{email}")
    rate_limit.check(*keys)
    user = User.query.filter_by(email=email).first() if email else None
    if user and two_factor.minutes_locked(user):
        rate_limit.record(*keys)
        return locked_response(user)
    if not user or not isinstance(password, str) or not user.check_password(password):
        rate_limit.record(*keys)
        if user:
            two_factor.failed_attempt(user)
            if two_factor.minutes_locked(user):
                return locked_response(user)
        return jsonify(error=_("Invalid email or password")), 401
    if user.totp_enabled_at and two_factor.required(user) and not two_factor.is_remembered(user, request.cookies.get(two_factor.DEVICE_COOKIE)):
        return jsonify(two_factor_required=True, ticket=two_factor.ticket_for(user))
    return finish_sign_in(user)


@bp.post("/two-factor/verify")
def verify_two_factor():
    """Step two: the 6-digit code from the authenticator app, or a backup code."""
    key = f"login-ip:{rate_limit.client_ip()}"
    rate_limit.check(key)
    data = json_body()
    user = two_factor.user_for_ticket(data.get("ticket"))
    if not user:
        return jsonify(error=_("That sign-in took too long. Please enter your password again."), restart=True), 401
    if two_factor.minutes_locked(user):
        return locked_response(user)
    if not two_factor.verify_code(user, data.get("code")):
        rate_limit.record(key)
        two_factor.failed_attempt(user)
        if two_factor.minutes_locked(user):
            return locked_response(user)
        return jsonify(error=_("That code didn't work. Check the time on your phone and try the newest code.")), 401
    return finish_sign_in(user, remember=data.get("remember") is True)


@bp.post("/two-factor/setup")
@roles("boss", "mechanic", "customer", before_two_factor=True)
def start_two_factor_setup():
    """A new secret to scan. Nothing is saved until a code from it is confirmed."""
    user = current_user()
    secret = two_factor.new_secret()
    return jsonify(setup_token=two_factor.setup_token(user, secret), **two_factor.setup_details(user, secret))


@bp.post("/two-factor/enable")
@roles("boss", "mechanic", "customer", before_two_factor=True)
def enable_two_factor():
    """Confirm the app is set up with one of its codes. Returns the backup codes, shown once.
    Turning it on again (a new phone) replaces the old secret and backup codes."""
    user = current_user()
    key = f"2fa-setup:{user.id}"
    rate_limit.check(key)
    data = json_body()
    secret = two_factor.secret_from_setup_token(user, data.get("setup_token"))
    if not secret:
        raise ValidationError(_("The setup expired. Start again to get a new code to scan."))
    step = two_factor.check_totp(secret, data.get("code"))
    if step is None:
        rate_limit.record(key)
        raise ValidationError(_("That code didn't work. Check the time on your phone and try the newest code."))
    user.totp_last_step = step
    codes = two_factor.enable(user, secret)
    two_factor.forget_devices(user)
    db.session.commit()
    return jsonify(user=user_payload(user), backup_codes=codes)


@bp.post("/two-factor/backup-codes")
@roles("boss", "mechanic", "customer")
def renew_backup_codes():
    """New backup codes (the old ones stop working). Asks for the password again."""
    user = current_user()
    password = json_body().get("password")
    if not isinstance(password, str) or not user.check_password(password):
        return jsonify(error=_("Your current password is incorrect")), 400
    codes = two_factor.new_backup_codes(user)
    audit.record("backup_codes_renewed", user=user)
    db.session.commit()
    return jsonify(backup_codes=codes)


@bp.get("/two-factor")
@roles("boss", "mechanic", "customer")
def two_factor_status():
    user = current_user()
    return jsonify(enabled=user.totp_enabled_at is not None, required=two_factor.required(user), backup_codes_left=two_factor.backup_codes_left(user))


@bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    user = db.session.get(User, int(get_jwt_identity()))
    if not user or get_jwt().get("tv") != user.token_version or demo_ended(user):
        response = jsonify(error=_("Your session has ended. Please sign in again."))
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
    return jsonify(error=_("Accounts are created through a company invitation")), 403


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
    agreed_to_terms(data)

    invitation = Invitation.query.filter_by(code=code, used=False).first()
    if not invitation or invitation.expires_at < utcnow():
        return jsonify(error=_("Invalid or expired invitation")), 400
    if email != invitation.email.strip().lower():
        return jsonify(error=_("This invitation was issued to a different email address")), 403
    if User.query.filter_by(email=email).first():
        return jsonify(error=_("An account with this email already exists. Sign in instead.")), 409

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
        language=current_language(),
    )
    user.set_password(password)
    record_agreement(user)
    invitation.used = True
    db.session.add(user)
    db.session.flush()
    audit.record("member_joined", user=user, detail=user.email)
    db.session.commit()
    return jsonify(message=_("Invitation accepted")), 201


@bp.post("/verify-email")
def verify_email():
    """The link in the verification email. Works without signing in: the signed link is the proof."""
    user = user_for_verification(json_body().get("token"))
    mark_verified(user)
    db.session.commit()
    return jsonify(message=_("Your email address is confirmed."), email=user.email)


@bp.post("/resend-verification")
@roles("boss", "mechanic", "customer")
def resend_verification():
    user = current_user()
    if user.email_verified_at:
        return jsonify(message=_("Your email address is already confirmed."), sent=False)
    key = f"verify-mail:{user.id}"
    rate_limit.check(key, setting="EMAIL_RATE_LIMIT")
    rate_limit.record(key)
    if not send_verification(user):
        raise ValidationError(_("The email couldn't be sent just now. Please try again in a few minutes."), 503)
    return jsonify(message=_("We sent a new link to {email}.", email=user.email), sent=True)


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
    return jsonify(message=_("If an account uses that email, we've sent it a link to choose a new password. The link works for 1 hour."))


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
        two_factor.forget_devices(user)
        audit.record("password_reset", user=user)
        db.session.commit()
        return jsonify(message=_("Password updated. You can now sign in."), email=user.email)
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
        return jsonify(error=_("Invalid or expired reset code")), 400
    user.set_password(password)
    reset.used = True
    two_factor.forget_devices(user)
    audit.record("password_reset", user=user)
    db.session.commit()
    return jsonify(message=_("Password updated. You can now sign in."))


@bp.post("/change-password")
@roles("boss", "mechanic", "customer")
def change_password():
    user = current_user()
    data = json_body()
    current = data.get("current_password")
    if not isinstance(current, str) or not user.check_password(current):
        return jsonify(error=_("Your current password is incorrect")), 400
    user.set_password(new_password(data, "new_password"))
    two_factor.forget_devices(user)
    audit.record("password_changed", user=user)
    db.session.commit()
    # Changing the password ends every other session; keep this one signed in.
    return signed_in_response(user)
