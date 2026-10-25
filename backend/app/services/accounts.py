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
from app.i18n import N_, _, local_time, speaking

VERIFY_HOURS = 48
RESET_HOURS = 1
ROLE_NAMES = {"mechanic": N_("a technician"), "customer": N_("a customer")}


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
        raise ValidationError(_("This verification link is invalid or has expired. Sign in to get a new one."))
    return user


def reset_token(user):
    return _serializer("reset").dumps({"u": user.id, "v": user.token_version})


def user_for_reset(token):
    data = _read("reset", token, RESET_HOURS)
    user = db.session.get(User, data.get("u")) if isinstance(data, dict) else None
    if not user or user.removed_at or user.token_version != data.get("v"):
        raise ValidationError(_("This reset link is invalid, expired or already used. Ask for a new one."))
    return user


def mark_verified(user):
    if not user.email_verified_at:
        user.email_verified_at = utcnow()


def send_verification(user):
    link = app_link(f"/verify?token={verification_token(user)}")
    first = user.name.split()[0] if user.name.split() else user.name
    with speaking(user.language):
        paragraphs = [
            _("Hi {name},", name=first),
            _("Please confirm that this is your email address. Once it's confirmed you can invite your team and customers."),
        ]
        footer = _("The link works for {count} hours. If you didn't create a MechanicPro account, you can ignore this email.", count=VERIFY_HOURS)
        return send_email(
            user.email,
            _("Confirm your email for MechanicPro"),
            "\n\n".join([*paragraphs, _("Confirm your email: {link}", link=link), footer]),
            layout(_("Confirm your email"), paragraphs, (_("Confirm my email"), link), footer),
            company_id=user.company_id,
        )


def send_password_reset(user):
    link = app_link(f"/reset?token={reset_token(user)}")
    with speaking(user.language):
        paragraphs = [_("Someone (hopefully you) asked to reset the MechanicPro password for {email}.", email=user.email)]
        footer = _(
            "The link works once, for 1 hour. If you didn't ask for this, ignore this email: your password stays the same."
        )
        return send_email(
            user.email,
            _("Reset your MechanicPro password"),
            "\n\n".join([*paragraphs, _("Choose a new password: {link}", link=link), footer]),
            layout(_("Reset your password"), paragraphs, (_("Choose a new password"), link), footer),
            company_id=user.company_id,
        )


def send_invitation(invitation, inviter):
    """In the company's language: the person invited has no account (or language) yet."""
    company = db.session.get(Company, invitation.company_id)
    link = app_link("/join?" + urlencode({"code": invitation.code, "email": invitation.email}))
    with speaking(company.language):
        expires = local_time(invitation.expires_at, company.timezone, with_time=False)
        paragraphs = [
            _("Hi {name},", name=invitation.customer_name),
            _(
                "{inviter} invited you to join {company} on MechanicPro as {role}. "
                "MechanicPro is where your service jobs, equipment and reports live.",
                inviter=inviter.name,
                company=company.name,
                role=_(ROLE_NAMES[invitation.role]),
            ),
        ]
        footer = _(
            'Or open the app, choose "Have an invitation code?" and enter {code}. '
            "The invitation works once, only for {email}, until {date}.",
            code=invitation.code,
            email=invitation.email,
            date=expires,
        )
        return send_email(
            invitation.email,
            _("{inviter} invited you to {company} on MechanicPro", inviter=inviter.name, company=company.name),
            "\n\n".join([*paragraphs, _("Accept the invitation: {link}", link=link), footer]),
            layout(_("Join {company}", company=company.name), paragraphs, (_("Accept the invitation"), link), footer),
            company_id=invitation.company_id,
        )


def forget_sign_in(user):
    """Everything that lets someone in, or only matters while they can sign in: their notifications,
    remembered offline changes, reset codes, two-step sign-in and remembered browsers."""
    from app.models.notification import Notification
    from app.models.security import PasswordReset
    from app.models.sync import ClientRequest
    from app.services import two_factor

    Notification.query.filter_by(user_id=user.id).delete()
    ClientRequest.query.filter_by(user_id=user.id).delete()
    PasswordReset.query.filter((PasswordReset.user_id == user.id) | (PasswordReset.created_by == user.id)).delete()
    two_factor.disable(user)
