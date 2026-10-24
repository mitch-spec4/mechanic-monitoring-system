"""Changes made offline on a technician's phone reach the server later, from the phone's queue.

Two headers come with each queued change:

- Idempotency-Key: the change's own ID. The phone may send a change again when the first reply was
  lost; the server answers a repeat with its first answer and changes nothing. A change is
  remembered (ClientRequest) in the same transaction that saves it, so either both happen or
  neither does. Only successful answers are remembered: a refused change saved nothing, so
  sending it again simply asks again. Kept for 30 days.
- X-Client-Time: when the change was made, already corrected on the phone for a wrong clock.
  Times, timers, shifts and history use it. It can't be in the future (5 minutes of drift are
  allowed, and taken off) or more than 30 days old.
"""
import json
import re
from datetime import datetime, timedelta, timezone

from flask import Response, g, has_request_context, request
from flask_jwt_extended import get_jwt, get_jwt_identity, verify_jwt_in_request
from sqlalchemy import event

from app import db
from app.models.sync import ClientRequest
from app.models.user import User
from app.utils.time import utcnow
from app.utils.validation import ValidationError
from app.i18n import _

IDEMPOTENCY_HEADER = "Idempotency-Key"
CLIENT_TIME_HEADER = "X-Client-Time"
WRITES = {"POST", "PUT", "PATCH", "DELETE"}
KEY_PATTERN = re.compile(r"[A-Za-z0-9_-]{8,80}")
CLOCK_SKEW = timedelta(minutes=5)
MAX_AGE = timedelta(days=30)
RETENTION = timedelta(days=30)
# A change that arrives more than this long after it was made counts as made offline.
LATE_AFTER = timedelta(minutes=2)
# Routes that handle a repeated key themselves (a photo upload gets a fresh upload link).
OWN_REPLAY = {"media.request_upload"}


def queued():
    """Whether this change came from the phone's queue (it carries its own ID)."""
    return has_request_context() and bool(request.headers.get(IDEMPOTENCY_HEADER))


def request_key():
    return request.headers.get(IDEMPOTENCY_HEADER) if queued() else None


def happened_at():
    """When the change was made: the phone's time for a queued change, otherwise now."""
    if not has_request_context():
        return utcnow()
    if "sync_happened_at" in g:
        return g.sync_happened_at
    now = utcnow()
    moment = now
    raw = request.headers.get(CLIENT_TIME_HEADER)
    if raw:
        try:
            moment = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
        except ValueError:
            raise ValidationError(_("The time this change was made isn't a valid date and time."), 422) from None
        if moment.tzinfo:
            moment = moment.astimezone(timezone.utc).replace(tzinfo=None)
        if moment > now + CLOCK_SKEW:
            raise ValidationError(_("This change is dated in the future. Check the date and time on your phone."), 422)
        if moment < now - MAX_AGE:
            raise ValidationError(_("This change was made more than 30 days ago and can no longer be saved."), 422)
        # A phone a little ahead of the server: never record something later than now.
        moment = min(moment, now)
    g.sync_happened_at = moment
    return moment


def synced_late():
    """The time a change made offline reached the server, or None for one made just now."""
    if not has_request_context():
        return None
    now = utcnow()
    return now if now - happened_at() > LATE_AFTER else None


def purge_old_requests():
    """Remembered changes are only needed while a phone might still send them again."""
    return ClientRequest.query.filter(ClientRequest.created_at < utcnow() - RETENTION).delete(synchronize_session=False)


def _remember(session):
    """On the request's first commit, remember its key in the same transaction as the change."""
    if not has_request_context() or "idempotency" not in g or g.get("idempotency_saved"):
        return
    user_id, key = g.idempotency
    session.add(ClientRequest(user_id=user_id, key=key, method=request.method, path=request.path[:300]))
    g.idempotency_saved = True


def init_sync(app):
    event.listen(db.session, "before_commit", _remember)

    @app.before_request
    def replay_repeated_change():
        # Fresh for every request (an app context, and so `g`, can outlive one request, as in tests).
        for name in ("sync_happened_at", "idempotency", "idempotency_saved"):
            g.pop(name, None)
        key = request.headers.get(IDEMPOTENCY_HEADER)
        if request.method not in WRITES or not key:
            return None
        if not KEY_PATTERN.fullmatch(key):
            return Response(json.dumps({"error": _("This change's ID isn't valid.")}), 400, mimetype="application/json")
        try:
            verify_jwt_in_request(optional=True)
            identity = get_jwt_identity()
        except Exception:
            # Not signed in (or the session ran out): the route answers that as usual.
            return None
        user = db.session.get(User, int(identity)) if identity else None
        if not user or user.token_version != get_jwt().get("tv"):
            return None
        if request.endpoint in OWN_REPLAY:
            return None
        g.idempotency = (int(identity), key)
        done = ClientRequest.query.filter_by(user_id=int(identity), key=key).first()
        if not done:
            return None
        g.pop("idempotency")
        if done.method != request.method or done.path != request.path[:300]:
            return Response(json.dumps({"error": _("This change's ID was already used for a different change.")}), 422, mimetype="application/json")
        body = done.body or json.dumps({"ok": True})
        return Response(body, done.status_code or 200, mimetype="application/json", headers={"Idempotent-Replay": "true"})

    @app.after_request
    def remember_answer(response):
        if "idempotency" not in g or not g.get("idempotency_saved"):
            return response
        user_id, key = g.idempotency
        row = ClientRequest.query.filter_by(user_id=user_id, key=key).first()
        if row:
            if 200 <= response.status_code < 300:
                row.status_code = response.status_code
                row.body = response.get_data(as_text=True) if response.mimetype == "application/json" else None
            else:
                # The route saved something and then refused: nothing to repeat.
                db.session.delete(row)
            db.session.commit()
        return response
