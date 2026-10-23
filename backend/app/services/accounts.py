"""The emails about people's accounts (verifying an address, resetting a password, invitations)
and the signed links inside them.

Links carry a signed, time-limited token rather than a database row:
- a verification link names the user and the address, so it stops working if the address changes;
- a reset link names the user's token_version, which every password change bumps, so it works once.
"""
from urllib.parse import urlencode

from flask import current_app
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app import db
from app.models.company import Company
from app.models.user import User
from app.services.email import app_link, layout, send_email
from app.utils.time import utcnow
from app.utils.validation import ValidationError

VERIFY_HOURS = 48
RESET_HOURS = 1
ROLE_NAMES = {"mechanic": "a mechanic", "customer": "a customer"}


def _serializer(purpose):
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=f"account-{purpose}")


def _read(purpose, token, hours):
    if not isinstance(token, str) or not token.strip():
        return None
    try:
        return _serializer(purpose).loads(token.strip(), max_age=hours * 3600)
    except (BadSignature, SignatureExpired):
        return None


def verification_token(user):
    return _serializer("verify").dumps({"u": user.id, "e": user.email})


def user_for_verification(token):
    data = _read("verify", token, VERIFY_HOURS)
    user = db.session.get(User, data.get("u")) if isinstance(data, dict) else None
    if not user or user.email != data.get("e"):
        raise ValidationError("This verification link is invalid or has expired. Sign in to get a new one.")
    return user


def reset_token(user):
    return _serializer("reset").dumps({"u": user.id, "v": user.token_version})


def user_for_reset(token):
    data = _read("reset", token, RESET_HOURS)
    user = db.session.get(User, data.get("u")) if isinstance(data, dict) else None
    if not user or user.token_version != data.get("v"):
        raise ValidationError("This reset link is invalid, expired or already used. Ask for a new one.")
    return user


def mark_verified(user):
    if not user.email_verified_at:
        user.email_verified_at = utcnow()


def send_verification(user):
    link = app_link(f"/verify?token={verification_token(user)}")
    first = user.name.split()[0] if user.name.split() else user.name
    paragraphs = [
        f"Hi {first},",
        "Please confirm that this is your email address. Once it's confirmed you can invite your team and customers.",
    ]
    footer = f"The link works for {VERIFY_HOURS} hours. If you didn't create a MechanicPro account, you can ignore this email."
    return send_email(
        user.email,
        "Confirm your email for MechanicPro",
        "\n\n".join([*paragraphs, f"Confirm your email: {link}", footer]),
        layout("Confirm your email", paragraphs, ("Confirm my email", link), footer),
        company_id=user.company_id,
    )


def send_password_reset(user):
    link = app_link(f"/reset?token={reset_token(user)}")
    paragraphs = [f"Someone (hopefully you) asked to reset the MechanicPro password for {user.email}."]
    footer = (
        f"The link works once, for {RESET_HOURS} hour. If you didn't ask for this, ignore this email: "
        "your password stays the same."
    )
    return send_email(
        user.email,
        "Reset your MechanicPro password",
        "\n\n".join([*paragraphs, f"Choose a new password: {link}", footer]),
        layout("Reset your password", paragraphs, ("Choose a new password", link), footer),
        company_id=user.company_id,
    )


def send_invitation(invitation, inviter):
    company = db.session.get(Company, invitation.company_id)
    link = app_link("/join?" + urlencode({"code": invitation.code, "email": invitation.email}))
    expires = invitation.expires_at.strftime("%d %b %Y")
    paragraphs = [
        f"Hi {invitation.customer_name},",
        f"{inviter.name} invited you to join {company.name} on MechanicPro as {ROLE_NAMES[invitation.role]}. "
        "MechanicPro is where your service jobs, machines and reports live.",
    ]
    footer = (
        f"Or open the app, choose \"Have an invitation code?\" and enter {invitation.code}. "
        f"The invitation works once, only for {invitation.email}, until {expires}."
    )
    return send_email(
        invitation.email,
        f"{inviter.name} invited you to {company.name} on MechanicPro",
        "\n\n".join([*paragraphs, f"Accept the invitation: {link}", footer]),
        layout(f"Join {company.name}", paragraphs, ("Accept the invitation", link), footer),
        company_id=invitation.company_id,
    )
