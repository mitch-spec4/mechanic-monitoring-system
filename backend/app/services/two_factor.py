"""Two-step sign-in (an authenticator app such as Google Authenticator) and account lockout.

- Everyone needs it, unless TWO_FACTOR_REQUIRED is off (tests) or the company is a demo copy.
  Someone signed in without it yet can only reach the setup screen (see utils/auth.roles).
- The secret is stored encrypted with a key derived from SECRET_KEY; changing SECRET_KEY means
  everyone sets up 2FA again (`flask reset-2fa` does it for one person).
- A code works once: the last used time step is stored, and an older or equal one is refused.
- Ten backup codes, each usable once, for when the phone is lost. Only hashes are stored.
- "Remember this device": a random token in an httpOnly cookie, valid 30 days. Changing the
  password or resetting 2FA forgets every device.
- Lockout: 5 wrong passwords or codes in a row lock the account for 15 minutes and email its owner.
"""
import base64
import hashlib
import hmac
import secrets
import time
from datetime import timedelta

import pyotp
import segno
from cryptography.fernet import Fernet, InvalidToken
from flask import current_app
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app import db
from app.models.company import Company
from app.models.security import BackupCode, TrustedDevice
from app.services import audit
from app.services.email import layout, send_email
from app.utils.time import utcnow
from app.i18n import _, local_time, speaking

ISSUER = "MechanicPro"
BACKUP_CODE_COUNT = 10
BACKUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I
DEVICE_DAYS = 30
DEVICE_COOKIE = "mp_device"
TICKET_SECONDS = 10 * 60
MAX_FAILURES = 5
LOCK_MINUTES = 15


# ---------- Who needs it ----------


def required(user):
    if not current_app.config.get("TWO_FACTOR_REQUIRED", True):
        return False
    company = db.session.get(Company, user.company_id)
    return not (company and company.is_demo)


def needs_setup(user):
    return required(user) and user.totp_enabled_at is None


# ---------- The secret ----------


def _fernet():
    key = hashlib.sha256(f"two-factor:{current_app.config['SECRET_KEY']}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_secret(secret):
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_secret(stored):
    try:
        return _fernet().decrypt(stored.encode()).decode()
    except (InvalidToken, AttributeError):
        return None


def new_secret():
    return pyotp.random_base32()


def setup_details(user, secret):
    """What the setup screen shows: a QR code, and the key for typing in by hand."""
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=ISSUER)
    return {
        "secret": secret,
        # Groups of four are easier to type.
        "secret_grouped": " ".join(secret[i : i + 4] for i in range(0, len(secret), 4)),
        "otpauth_uri": uri,
        "qr_svg": segno.make(uri, error="m").svg_data_uri(scale=5, border=2),
    }


def _normalise(code):
    return "".join(str(code or "").split()).replace("-", "").upper()


def check_totp(secret, code, last_step=None, at=None):
    """The time step the code belongs to (allowing 30 seconds either way for a slow phone clock),
    or None. A step at or before last_step is refused, so each code works once."""
    code = _normalise(code)
    if not secret or len(code) != 6 or not code.isdigit():
        return None
    totp = pyotp.TOTP(secret)
    now = at if at is not None else time.time()
    current = int(now // totp.interval)
    for step in (current - 1, current, current + 1):
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(totp.generate_otp(step), code):
            return step
    return None


def enable(user, secret):
    """Turn 2FA on with a confirmed secret and return the new backup codes (shown once)."""
    user.totp_secret = encrypt_secret(secret)
    user.totp_enabled_at = utcnow()
    audit.record("two_factor_enabled", user=user)
    return new_backup_codes(user)


def disable(user):
    """Used when a boss or the server command resets someone's 2FA."""
    user.totp_secret = None
    user.totp_enabled_at = None
    user.totp_last_step = None
    BackupCode.query.filter_by(user_id=user.id).delete()
    forget_devices(user)


# ---------- Backup codes ----------


def _hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


def new_backup_codes(user):
    BackupCode.query.filter_by(user_id=user.id).delete()
    codes = []
    for _index in range(BACKUP_CODE_COUNT):
        raw = "".join(secrets.choice(BACKUP_ALPHABET) for _char in range(8))
        codes.append(f"{raw[:4]}-{raw[4:]}")
        db.session.add(BackupCode(user_id=user.id, code_hash=_hash(raw)))
    return codes


def use_backup_code(user, code):
    code = _normalise(code)
    if len(code) != 8:
        return False
    row = BackupCode.query.filter_by(user_id=user.id, code_hash=_hash(code), used_at=None).first()
    if not row:
        return False
    row.used_at = utcnow()
    return True


def backup_codes_left(user):
    return BackupCode.query.filter_by(user_id=user.id, used_at=None).count()


def verify_code(user, code):
    """A code from the app, or one of the backup codes. Marks it used."""
    step = check_totp(decrypt_secret(user.totp_secret), code, user.totp_last_step)
    if step is not None:
        user.totp_last_step = step
        return True
    return use_backup_code(user, code)


# ---------- Remembered devices ----------


def remember_device(response, user):
    token = secrets.token_urlsafe(32)
    db.session.add(TrustedDevice(user_id=user.id, token_hash=_hash(token), expires_at=utcnow() + timedelta(days=DEVICE_DAYS)))
    response.set_cookie(
        DEVICE_COOKIE,
        token,
        max_age=DEVICE_DAYS * 86400,
        httponly=True,
        secure=current_app.config.get("JWT_COOKIE_SECURE", False),
        samesite="Lax",
        path="/api/auth/",
    )


def is_remembered(user, token):
    if not token:
        return False
    device = TrustedDevice.query.filter_by(user_id=user.id, token_hash=_hash(token)).first()
    return bool(device and device.expires_at > utcnow())


def forget_devices(user):
    TrustedDevice.query.filter_by(user_id=user.id).delete()


# ---------- The step between password and code ----------


def _tickets():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="two-factor-ticket")


def ticket_for(user):
    """Proof that the password was right, for the next 10 minutes. Not a session."""
    return _tickets().dumps({"u": user.id, "v": user.token_version})


def user_for_ticket(ticket):
    from app.models.user import User

    try:
        data = _tickets().loads(str(ticket or ""), max_age=TICKET_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    user = db.session.get(User, data.get("u")) if isinstance(data, dict) else None
    return user if user and user.token_version == data.get("v") else None


def _setup_tokens():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="two-factor-setup")


def setup_token(user, secret):
    return _setup_tokens().dumps({"u": user.id, "s": secret})


def secret_from_setup_token(user, token):
    try:
        data = _setup_tokens().loads(str(token or ""), max_age=30 * 60)
    except (BadSignature, SignatureExpired):
        return None
    return data.get("s") if isinstance(data, dict) and data.get("u") == user.id else None


# ---------- Lockout ----------


def minutes_locked(user):
    if not user.locked_until or user.locked_until <= utcnow():
        return 0
    return max(1, int((user.locked_until - utcnow()).total_seconds() // 60) + 1)


def failed_attempt(user):
    """Count a wrong password or code; the fifth in a row locks the account. Commits."""
    user.failed_logins = (user.failed_logins or 0) + 1
    audit.record("sign_in_failed", user=user)
    if user.failed_logins >= MAX_FAILURES:
        user.failed_logins = 0
        user.locked_until = utcnow() + timedelta(minutes=LOCK_MINUTES)
        audit.record("account_locked", user=user)
        db.session.commit()
        _send_lock_email(user)
        return
    db.session.commit()


def succeeded(user):
    user.failed_logins = 0
    user.locked_until = None
    audit.record("sign_in", user=user)


def _send_lock_email(user):
    company = db.session.get(Company, user.company_id)
    with speaking(user.language):
        until = local_time(user.locked_until, company.timezone if company else None)
        paragraphs = [
            _("Someone entered a wrong password or sign-in code for {email} {count} times in a row.", email=user.email, count=MAX_FAILURES),
            _("To protect your account, signing in is paused until {time}.", time=until),
            _("If this wasn't you, change your password as soon as you can sign in again, and tell your manager."),
        ]
        send_email(
            user.email,
            _("Your MechanicPro account was locked"),
            "\n\n".join(paragraphs),
            layout(_("Your account was locked"), paragraphs),
            company_id=user.company_id,
        )
