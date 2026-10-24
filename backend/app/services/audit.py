"""The activity log: security-relevant events in a company, for the boss to read.

record() adds an event to the session without committing, so it lands with the change it
describes. Events are kept for 12 months (purge_old_events, run by the daily clean-up).

Actions are short codes the app translates when it shows them; `detail` holds names, emails or
plan names, never sentences, so the log reads in each reader's own language.
"""
from datetime import timedelta

from flask import has_request_context

from app import db
from app.models.security import AuditEvent
from app.utils.time import utcnow

KEEP_FOR = timedelta(days=365)

ACTIONS = {
    "sign_in",
    "sign_in_failed",
    "account_locked",
    "password_changed",
    "password_reset",
    "two_factor_enabled",
    "two_factor_reset",
    "backup_codes_renewed",
    "invitation_sent",
    "member_joined",
    "member_removed",
    "job_deleted",
    "customer_deleted",
    "machine_deleted",
    "plan_paid",
    "plan_cancelled",
    "plan_renewal_on",
    "plan_changed",
    "data_exported",
    "report_exported",
    "deletion_requested",
    "deletion_cancelled",
}


def _ip():
    if not has_request_context():
        return None
    from app.services.rate_limit import client_ip

    return client_ip()[:64]


def record(action, *, company_id=None, user=None, detail=None):
    """Log an action. `user` is who did it (or whose account it was, for sign-in events)."""
    if action not in ACTIONS:
        raise ValueError(f"Unknown audit action: {action}")
    company_id = company_id if company_id is not None else getattr(user, "company_id", None)
    if company_id is None:
        return None
    event = AuditEvent(
        company_id=company_id,
        user_id=user.id if user else None,
        user_name=user.name if user else None,
        action=action,
        detail=(detail or "")[:300] or None,
        ip=_ip(),
        created_at=utcnow(),
    )
    db.session.add(event)
    return event


def purge_old_events():
    return AuditEvent.query.filter(AuditEvent.created_at < utcnow() - KEEP_FOR).delete(synchronize_session=False)


def event_out(event):
    return {
        "id": event.id,
        "action": event.action,
        "user": event.user_name,
        "detail": event.detail,
        "ip": event.ip,
        "created_at": event.created_at.isoformat(),
    }
