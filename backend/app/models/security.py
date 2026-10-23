from app import db
from app.utils.time import utcnow


class AuthAttempt(db.Model):
    """One rate-limited auth attempt. Stored in the database so limits survive restarts
    and are shared by every server process."""

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(200), nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)


class PasswordReset(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    code_hash = db.Column(db.String(64), nullable=False, unique=True)
    created_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    used = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class BackupCode(db.Model):
    """One of a person's ten one-time codes for signing in without their phone. Only a hash is kept."""

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    code_hash = db.Column(db.String(64), nullable=False)
    used_at = db.Column(db.DateTime)


class TrustedDevice(db.Model):
    """A browser where someone ticked "Remember this device": it skips the code for 30 days.
    The browser holds a random token in an httpOnly cookie; only its hash is kept here."""

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    token_hash = db.Column(db.String(64), nullable=False, unique=True)
    expires_at = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class AuditEvent(db.Model):
    """Something security-relevant that happened in a company, for the boss's activity log.
    Kept for 12 months."""

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    # Who did it; empty for failed sign-ins by someone not yet known, or system actions.
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), index=True)
    # Kept as text so the log still reads right after the person's account is removed.
    user_name = db.Column(db.String(120))
    action = db.Column(db.String(40), nullable=False)
    detail = db.Column(db.String(300))
    ip = db.Column(db.String(64))
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)
