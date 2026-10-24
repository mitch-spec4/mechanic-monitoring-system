from datetime import timedelta

from flask import Blueprint, jsonify, request

from app import db
from app.models.job import Job
from app.models.location import LocationPoint, Shift
from app.models.user import User
from app.models.worksheet import WorkEntry
from app.routes.jobs import change_status
from app.routes.worksheet import iso, parse_time
from app.services.location import (
    LIVE_MIN_INTERVAL,
    LONG_SHIFT,
    open_shift,
    parse_fix,
    point_out,
    purge_old_live_points,
    record_point,
)
from app.services.notifications import notify
from app.services.sync import happened_at, queued
from app.utils.auth import current_user, roles
from app.utils.time import utcnow
from app.utils.validation import ValidationError, integer, json_body
from app.i18n import N_, _, local_time

bp = Blueprint("shifts", __name__)
location_bp = Blueprint("location", __name__)

NEEDS_LOCATION = N_(
    "Your location is needed to clock in. Turn on location for this site in your browser "
    "and on your phone, then try again. If it keeps failing, step outside for a better signal."
)


def shift_out(shift, names=None, points=None):
    end = shift.clocked_out_at or utcnow()
    hours = round(max((end - shift.clocked_in_at).total_seconds(), 0) / 3600, 2)
    points = points or {}
    return {
        "id": shift.id,
        "user_id": shift.user_id,
        "mechanic": (names or {}).get(shift.user_id),
        "clocked_in_at": iso(shift.clocked_in_at),
        "clocked_out_at": iso(shift.clocked_out_at),
        "open": shift.clocked_out_at is None,
        "hours": hours,
        "long": end - shift.clocked_in_at > LONG_SHIFT,
        "edited": shift.edited_by is not None,
        "edited_by": (names or {}).get(shift.edited_by),
        "original_clocked_out_at": iso(shift.original_clocked_out_at),
        "clock_in_location": point_out(points.get((shift.id, "clock_in"))),
        "clock_out_location": point_out(points.get((shift.id, "clock_out"))),
    }


def pause_running_jobs(mechanic, actor, at=None):
    """Clocking out stops the clock on every job: work can't run while nobody is on shift.
    With `at` (a manager's corrected clock-out time), job time stops there too."""
    paused = Job.query.filter_by(mechanic_id=mechanic.id, status="In Progress").all()
    for job in paused:
        change_status(job, actor, "Paused")
    if at and paused:
        db.session.flush()
        entries = WorkEntry.query.filter(
            WorkEntry.job_id.in_([job.id for job in paused]), WorkEntry.ended_at > at, WorkEntry.started_at < at
        )
        for entry in entries:
            entry.ended_at = at
    return paused


def status_payload(user):
    shift = open_shift(user)
    return {
        "consent": user.location_consent_at is not None,
        "consent_at": iso(user.location_consent_at),
        "shift": shift_out(shift) if shift else None,
    }


@bp.get("/current")
@roles("mechanic")
def current():
    return jsonify(status_payload(current_user()))


@bp.post("/consent")
@roles("mechanic")
def consent():
    user = current_user()
    agreed = json_body().get("consent")
    if not isinstance(agreed, bool):
        raise ValidationError(_("Consent must be true or false"))
    if not agreed and open_shift(user):
        raise ValidationError(_("Clock out first. Location sharing is part of being clocked in."), 409)
    if agreed and not user.location_consent_at:
        user.location_consent_at = happened_at()
    if not agreed:
        user.location_consent_at = None
    db.session.commit()
    return jsonify(status_payload(user))


@bp.post("/clock-in")
@roles("mechanic")
def clock_in():
    user = current_user()
    if open_shift(user):
        if queued():
            # Clocked in on another phone too: already done.
            return jsonify(status_payload(user))
        raise ValidationError(_("You are already clocked in"), 409)
    if not user.location_consent_at:
        raise ValidationError(_("Agree to location sharing before clocking in"), 409)
    fix, _reason = parse_fix(json_body())
    if not fix:
        raise ValidationError(_(NEEDS_LOCATION), 422)
    at = happened_at()
    last = Shift.query.filter(Shift.user_id == user.id, Shift.clocked_out_at.isnot(None)).order_by(Shift.clocked_out_at.desc()).first()
    if last and at < last.clocked_out_at:
        raise ValidationError(
            _("This clock-in was made at {time}, before your last clock-out at {last}, so it wasn't applied.", time=local_time(at), last=local_time(last.clocked_out_at)),
            409,
        )
    shift = Shift(company_id=user.company_id, user_id=user.id, clocked_in_at=at)
    db.session.add(shift)
    db.session.flush()
    record_point(user, shift, "clock_in", fix)
    purge_old_live_points(user.company_id)
    db.session.commit()
    return jsonify(status_payload(user)), 201


@bp.post("/clock-out")
@roles("mechanic")
def clock_out():
    """Always allowed, with or without a position, so nobody is ever stuck being tracked."""
    user = current_user()
    shift = open_shift(user)
    if not shift:
        if queued():
            # Clocked out on another phone too: already done.
            return jsonify(status_payload(user) | {"paused_jobs": []})
        raise ValidationError(_("You are not clocked in"), 409)
    at = happened_at()
    if at < shift.clocked_in_at:
        raise ValidationError(
            _("This clock-out was made at {time}, before you clocked in at {start}, so it wasn't applied.", time=local_time(at), start=local_time(shift.clocked_in_at)),
            409,
        )
    paused = pause_running_jobs(user, user)
    fix, reason = parse_fix(json_body())
    if user.location_consent_at:
        record_point(user, shift, "clock_out", fix, reason)
    shift.clocked_out_at = at
    db.session.commit()
    payload = status_payload(user)
    payload["paused_jobs"] = [job.title for job in paused]
    return jsonify(payload)


@bp.get("")
@roles("boss", "mechanic")
def list_shifts():
    user = current_user()
    query = Shift.query.filter_by(company_id=user.company_id)
    if user.role == "mechanic":
        query = query.filter_by(user_id=user.id)
    else:
        mechanic_id = integer(request.args, "mechanic_id", "Technician")
        if mechanic_id:
            query = query.filter_by(user_id=mechanic_id)
    days = integer(request.args, "days", "Days", minimum=1, maximum=366) or 14
    query = query.filter((Shift.clocked_in_at >= utcnow() - timedelta(days=days)) | (Shift.clocked_out_at.is_(None)))
    shifts = query.order_by(Shift.clocked_in_at.desc()).limit(500).all()
    ids = {s.user_id for s in shifts} | {s.edited_by for s in shifts if s.edited_by}
    names = {u.id: u.name for u in User.query.filter(User.id.in_(ids)).all()} if ids else {}
    points = {}
    if shifts:
        stamps = LocationPoint.query.filter(
            LocationPoint.shift_id.in_([s.id for s in shifts]), LocationPoint.kind.in_(["clock_in", "clock_out"])
        )
        points = {(p.shift_id, p.kind): p for p in stamps}
    return jsonify(shifts=[shift_out(s, names, points) for s in shifts])


@bp.patch("/<int:sid>")
@roles("boss")
def correct_shift(sid):
    """A manager sets the clock-out time of a forgotten or wrong shift. The original is kept."""
    user = current_user()
    shift = Shift.query.filter_by(id=sid, company_id=user.company_id).first_or_404()
    ended = parse_time(json_body(), "clocked_out_at", "Clock-out time", required=True)
    if ended <= shift.clocked_in_at:
        raise ValidationError(_("Clock-out time must be after the clock-in time"))
    later = Shift.query.filter(Shift.user_id == shift.user_id, Shift.id != shift.id, Shift.clocked_in_at > shift.clocked_in_at)
    next_shift = later.order_by(Shift.clocked_in_at).first()
    if next_shift and ended > next_shift.clocked_in_at:
        raise ValidationError(_("That overlaps the technician's next shift"), 409)
    mechanic = db.session.get(User, shift.user_id)
    if shift.clocked_out_at is None:
        pause_running_jobs(mechanic, user, at=ended)
    elif shift.original_clocked_out_at is None:
        shift.original_clocked_out_at = shift.clocked_out_at
    shift.clocked_out_at = ended
    shift.edited_by = user.id
    shift.edited_at = utcnow()
    notify(mechanic.id, N_("Shift corrected"), N_("{name} set your clock-out time for the shift that started {start}."), "shift", name=user.name, start=local_time(shift.clocked_in_at))
    db.session.commit()
    return jsonify(shift=shift_out(shift, {mechanic.id: mechanic.name, user.id: user.name}))


@location_bp.post("/live")
@roles("mechanic")
def live():
    """Positions sent while a job is in progress and the app is open. At most one a minute is kept."""
    user = current_user()
    data = json_body()
    shift = open_shift(user)
    job_id = integer(data, "job_id", "Job", required=True)
    job = Job.query.filter_by(id=job_id, company_id=user.company_id, mechanic_id=user.id).first_or_404()
    if job.status != "In Progress":
        raise ValidationError(_("Live location is only shared while a job is in progress"), 409)
    fix, _reason = parse_fix(data)
    if not fix:
        raise ValidationError(_("A position is required"))
    last = (
        LocationPoint.query.filter_by(user_id=user.id, kind="live")
        .order_by(LocationPoint.recorded_at.desc())
        .first()
    )
    if last and utcnow() - last.recorded_at < LIVE_MIN_INTERVAL:
        return jsonify(saved=False)
    record_point(user, shift, "live", fix, job=job)
    purge_old_live_points(user.company_id)
    db.session.commit()
    return jsonify(saved=True), 201


@location_bp.get("/team")
@roles("boss")
def team():
    """Where each clocked-in mechanic was last seen. Clocked-out mechanics are not shown at all."""
    user = current_user()
    rows = (
        db.session.query(Shift, User)
        .join(User, User.id == Shift.user_id)
        .filter(Shift.company_id == user.company_id, Shift.clocked_out_at.is_(None))
        .order_by(User.name)
        .all()
    )
    team = []
    for shift, mechanic in rows:
        last = (
            LocationPoint.query.filter(LocationPoint.shift_id == shift.id, LocationPoint.latitude.isnot(None))
            .order_by(LocationPoint.recorded_at.desc(), LocationPoint.id.desc())
            .first()
        )
        job = Job.query.filter_by(mechanic_id=mechanic.id, status="In Progress").first()
        team.append(
            {
                "user_id": mechanic.id,
                "name": mechanic.name,
                "clocked_in_at": iso(shift.clocked_in_at),
                "last": point_out(last),
                "job": {"id": job.id, "title": job.title} if job else None,
            }
        )
    return jsonify(team=team)
