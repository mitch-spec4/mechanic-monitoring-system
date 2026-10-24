"""Clock-in and location rules: positions are only ever stored for a mechanic who is clocked in
and has agreed to location sharing."""
import math
from datetime import timedelta

from app import db
from app.models.location import LocationPoint, Shift
from app.services.sync import happened_at
from app.utils.time import utcnow
from app.utils.validation import ValidationError
from app.i18n import _

LIVE_RETENTION = timedelta(days=30)
LIVE_MIN_INTERVAL = timedelta(seconds=60)
LONG_SHIFT = timedelta(hours=12)
MISSING_REASONS = {"denied", "unavailable", "timeout", "unsupported"}


def open_shift(user):
    return Shift.query.filter_by(user_id=user.id, clocked_out_at=None).first()


def shift_at(user, at):
    """The shift the user was on at `at`: a change made offline is checked against then, not now."""
    return (
        Shift.query.filter(Shift.user_id == user.id, Shift.clocked_in_at <= at)
        .filter(Shift.clocked_out_at.is_(None) | (Shift.clocked_out_at >= at))
        .order_by(Shift.clocked_in_at.desc())
        .first()
    )


def _coordinate(data, field, label, limit):
    value = data.get(field)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValidationError(_("{label} must be a number", label=_(label)))
    if not -limit <= value <= limit:
        raise ValidationError(_("{label} must be between {minimum} and {maximum}", label=_(label), minimum=-limit, maximum=limit))
    return float(value)


def parse_fix(data):
    """The position sent with a request: (fix, missing_reason). A fix is (lat, lng, accuracy)."""
    if data.get("latitude") is None and data.get("longitude") is None:
        reason = data.get("location_error")
        return None, reason if reason in MISSING_REASONS else "not_sent"
    latitude = _coordinate(data, "latitude", "Latitude", 90)
    longitude = _coordinate(data, "longitude", "Longitude", 180)
    accuracy = data.get("accuracy")
    if accuracy is not None:
        if isinstance(accuracy, bool) or not isinstance(accuracy, (int, float)) or not math.isfinite(accuracy) or accuracy < 0:
            raise ValidationError(_("Accuracy must be a positive number of metres"))
        accuracy = min(float(accuracy), 100000.0)
    return (latitude, longitude, accuracy), None


def record_point(user, shift, kind, fix, missing_reason=None, job=None):
    """Store a position (or why there is none). Refuses anything outside a consented, open shift."""
    if not shift or shift.clocked_out_at is not None or shift.user_id != user.id:
        raise ValidationError(_("Location is only recorded while you are clocked in"), 409)
    if not user.location_consent_at:
        raise ValidationError(_("You haven't agreed to location sharing"), 409)
    latitude, longitude, accuracy = fix if fix else (None, None, None)
    point = LocationPoint(
        company_id=user.company_id,
        user_id=user.id,
        shift_id=shift.id,
        job_id=job.id if job else None,
        kind=kind,
        latitude=latitude,
        longitude=longitude,
        accuracy_m=accuracy,
        missing_reason=None if fix else (missing_reason or "not_sent"),
        recorded_at=happened_at(),
    )
    db.session.add(point)
    return point


def stamp_job(user, job, kind, data):
    """Location stamp for a mechanic starting or completing a job. A missing position is noted,
    not refused, so a weak signal never blocks the work itself."""
    shift = open_shift(user)
    if user.role != "mechanic" or not shift or not user.location_consent_at:
        return None
    fix, reason = parse_fix(data)
    return record_point(user, shift, kind, fix, reason, job)


def purge_old_live_points(company_id=None):
    """Live positions are kept for 30 days; clock and job stamps stay with their records."""
    query = LocationPoint.query.filter(LocationPoint.kind == "live", LocationPoint.recorded_at < utcnow() - LIVE_RETENTION)
    if company_id:
        query = query.filter(LocationPoint.company_id == company_id)
    return query.delete(synchronize_session=False)


def point_out(point):
    if not point:
        return None
    return {
        "kind": point.kind,
        "latitude": point.latitude,
        "longitude": point.longitude,
        "accuracy_m": round(point.accuracy_m) if point.accuracy_m is not None else None,
        "missing_reason": point.missing_reason,
        "recorded_at": point.recorded_at.isoformat(),
        "job_id": point.job_id,
    }
