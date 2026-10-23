"""Database-backed rate limiting for sign-in style endpoints.

Attempts are rows in the auth_attempt table, so limits hold across restarts and across
every server process without extra infrastructure such as Redis.
"""
import re
from datetime import timedelta

from flask import current_app, request

from app import db
from app.models.security import AuthAttempt
from app.utils.time import utcnow
from app.utils.validation import ValidationError
from app.i18n import _

UNITS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}
RULE = re.compile(r"^\s*(\d+)\s*(?:per|/)\s*(second|minute|hour|day)s?\s*$")
KEEP_ATTEMPTS_FOR = timedelta(days=1)


def parse_limits(spec):
    """'10 per minute;50 per hour' -> [(10, 60), (50, 3600)]"""
    limits = []
    for part in filter(None, (piece.strip() for piece in spec.split(";"))):
        match = RULE.match(part)
        if not match:
            raise ValueError(f"Invalid rate limit: {part!r}")
        limits.append((int(match.group(1)), UNITS[match.group(2)]))
    return limits


def client_ip():
    return request.remote_addr or "unknown"


def check(*keys, setting="LOGIN_RATE_LIMIT"):
    """Raise 429 if any key has used up any limit in the given setting."""
    if not current_app.config.get("RATELIMIT_ENABLED", True):
        return
    now = utcnow()
    for limit, seconds in parse_limits(current_app.config[setting]):
        since = now - timedelta(seconds=seconds)
        for key in keys:
            if AuthAttempt.query.filter(AuthAttempt.key == key, AuthAttempt.created_at >= since).count() >= limit:
                raise ValidationError(_("Too many attempts. Please wait a few minutes and try again."), 429)


def record(*keys):
    """Store an attempt for each key and prune old rows. Commits immediately so the attempt
    counts even if the request later fails."""
    if not current_app.config.get("RATELIMIT_ENABLED", True):
        return
    now = utcnow()
    AuthAttempt.query.filter(AuthAttempt.created_at < now - KEEP_ATTEMPTS_FOR).delete()
    db.session.add_all(AuthAttempt(key=key, created_at=now) for key in keys)
    db.session.commit()
