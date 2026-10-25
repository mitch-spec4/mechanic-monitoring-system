"""Planning a technician's day: the order to visit their jobs in, to cut travel.

Drive distances and times come from a routing service behind `Router`:
- OpenRouteService's matrix API when ROUTING_API_KEY is set (ROUTING_PROVIDER=openrouteservice,
  the only provider for now; another fits behind the same two methods);
- otherwise straight lines: the distance as the crow flies x 1.3 (roads aren't straight), driven
  at ROUTE_AVERAGE_KMH (25 km/h, city traffic). That orders stops well, but its times are rough, and
  the plan says it's an estimate. If the service fails, the plan falls back to straight lines too.

Which jobs: the technician's unfinished jobs due on or before the day (or with no due date, or
already under way) whose equipment's site has a pin on the map, and no booked time. Booked visits keep their times and are
listed apart; jobs with no pin are listed as "not on the map".

The order: nearest stop first from the start, then 2-opt (reverse any stretch of the route while it
shortens the drive). For the handful of stops in a technician's day this is at or near the best.
The start: where the technician was last seen today if they're clocked in, else the company's base,
else the first stop. The route ends at the last stop.
"""
import json
import math
import urllib.error
import urllib.request
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from flask import current_app

from app import db
from app.models.customer import Customer
from app.models.equipment import Site
from app.models.job import Job
from app.models.location import LocationPoint, Shift
from app.models.machine import Machine
from app.services.booking import minutes_of
from app.utils.time import utcnow

ROAD_FACTOR = 1.3
FINISHED = ("Completed", "Cancelled")
PRIORITY_RANK = {"Urgent": 0, "High": 1, "Medium": 2, "Low": 3}
# A position older than this doesn't say where the technician is now.
FRESH_POSITION = timedelta(hours=2)


def metres_between(a, b):
    """Great-circle distance between two (latitude, longitude) points, in metres."""
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


class StraightLine:
    name = "straight_line"

    def __init__(self, average_kmh):
        self.metres_per_second = average_kmh * 1000 / 3600

    def matrix(self, points):
        """(seconds, metres) between every pair of points, each a list of lists."""
        metres = [[metres_between(a, b) * ROAD_FACTOR for b in points] for a in points]
        return [[m / self.metres_per_second for m in row] for row in metres], metres


class OpenRouteService:
    name = "openrouteservice"
    URL = "https://api.openrouteservice.org/v2/matrix/driving-car"

    def __init__(self, key, timeout=8):
        self.key = key
        self.timeout = timeout

    def matrix(self, points):
        body = json.dumps({"locations": [[lng, lat] for lat, lng in points], "metrics": ["duration", "distance"]}).encode()
        request = urllib.request.Request(self.URL, data=body, method="POST", headers={"Authorization": self.key, "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            data = json.loads(response.read())
        seconds, metres = data["durations"], data["distances"]
        if len(seconds) != len(points) or any(len(row) != len(points) for row in seconds + metres):
            raise ValueError("The routing service sent a matrix of the wrong size")
        return seconds, metres


def router():
    average = current_app.config["ROUTE_AVERAGE_KMH"]
    key = current_app.config.get("ROUTING_API_KEY")
    if key and current_app.config["ROUTING_PROVIDER"] == "openrouteservice":
        return OpenRouteService(key)
    return StraightLine(average)


def drive_matrix(points):
    """The service's matrix, or straight lines if it fails; with the name of what was used, and
    whether it was a fallback. Pairs the service can't route (an island, say) get straight lines."""
    chosen = router()
    fallback = StraightLine(current_app.config["ROUTE_AVERAGE_KMH"])
    if isinstance(chosen, StraightLine):
        seconds, metres = chosen.matrix(points)
        return seconds, metres, chosen.name, False
    try:
        seconds, metres = chosen.matrix(points)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, TypeError) as problem:
        current_app.logger.warning("Routing service failed, using straight lines: %s", problem)
        seconds, metres = fallback.matrix(points)
        return seconds, metres, fallback.name, True
    straight_seconds, straight_metres = fallback.matrix(points)
    for i, row in enumerate(seconds):
        for j, value in enumerate(row):
            if value is None or metres[i][j] is None:
                seconds[i][j], metres[i][j] = straight_seconds[i][j], straight_metres[i][j]
    return seconds, metres, chosen.name, False


def route_cost(order, cost, start=0):
    """The total of `cost` along start -> order[0] -> order[1] -> ..."""
    total, here = 0, start
    for stop in order:
        total += cost[here][stop]
        here = stop
    return total


def best_order(cost, stops, start=0):
    """Visit `stops` (indices into `cost`) from `start`: nearest first, then 2-opt."""
    left, order, here = set(stops), [], start
    while left:
        here = min(left, key=lambda stop: (cost[here][stop], stop))
        order.append(here)
        left.remove(here)
    improved = True
    while improved:
        improved = False
        for i in range(len(order) - 1):
            for j in range(i + 1, len(order)):
                candidate = order[:i] + order[i : j + 1][::-1] + order[j + 1 :]
                if route_cost(candidate, cost, start) < route_cost(order, cost, start) - 1e-9:
                    order, improved = candidate, True
    return order


def site_positions(jobs):
    """{job_id: (latitude, longitude)} for the jobs whose equipment's site has a pin."""
    machines = {m.id: m for m in Machine.query.filter(Machine.id.in_([j.machine_id for j in jobs if j.machine_id] or [0])).all()}
    sites = {s.id: s for s in Site.query.filter(Site.id.in_([m.site_id for m in machines.values() if m.site_id] or [0])).all()}
    found = {}
    for job in jobs:
        machine = machines.get(job.machine_id)
        site = sites.get(machine.site_id) if machine and machine.site_id else None
        if site and site.latitude is not None and site.longitude is not None:
            found[job.id] = (site.latitude, site.longitude)
    return found


def day_bounds(company, day):
    zone = ZoneInfo(company.timezone)
    start = datetime.combine(day, time(0), zone).astimezone(timezone.utc).replace(tzinfo=None)
    return start, start + timedelta(days=1)


def where_now(company, mechanic, day, now):
    """The technician's last position today, if they're clocked in and it's recent."""
    low, high = day_bounds(company, day)
    if not (low <= now < high):
        return None
    shift = Shift.query.filter_by(user_id=mechanic.id, clocked_out_at=None).first()
    if not shift:
        return None
    point = (
        LocationPoint.query.filter(LocationPoint.shift_id == shift.id, LocationPoint.latitude.isnot(None), LocationPoint.recorded_at >= now - FRESH_POSITION)
        .order_by(LocationPoint.recorded_at.desc(), LocationPoint.id.desc())
        .first()
    )
    return (point.latitude, point.longitude) if point else None


def usual_order(job, day):
    """The order before any planning: as the technician's list sorts them (the job under way first)."""
    return (job.status != "In Progress", job.due_date or day, PRIORITY_RANK.get(job.priority, 9), job.id)


def plan_day(company, mechanic, day, now=None):
    now = now or utcnow()
    low, high = day_bounds(company, day)
    jobs = Job.query.filter(Job.company_id == company.id, Job.mechanic_id == mechanic.id, Job.status.notin_(FINISHED)).all()
    booked = sorted((j for j in jobs if j.scheduled_start and low <= j.scheduled_start < high), key=lambda j: j.scheduled_start)
    # A job under way counts on any day from today on, whatever its due date.
    underway = now < high
    flexible = [j for j in jobs if not j.scheduled_start and (j.due_date is None or j.due_date <= day or (underway and j.status == "In Progress"))]
    positions = site_positions(flexible + booked)
    placed = [j for j in flexible if j.id in positions]
    unplaced = [j for j in flexible if j.id not in positions]

    here = where_now(company, mechanic, day, now)
    if here:
        start = {"kind": "position", "latitude": here[0], "longitude": here[1]}
    elif company.base_latitude is not None and company.base_longitude is not None:
        start = {"kind": "base", "latitude": company.base_latitude, "longitude": company.base_longitude}
    else:
        start = {"kind": "first_stop", "latitude": None, "longitude": None}

    # The order now: the saved plan for the day, else the usual one.
    saved = {j.id: j.route_order for j in placed if j.route_date == day and j.route_order is not None}
    current = sorted(placed, key=lambda j: (0, saved[j.id]) if j.id in saved else (1, usual_order(j, day)))

    estimate, fell_back = StraightLine.name, False
    suggested_jobs, legs, suggested_s, suggested_m, current_s, current_m = [], [], 0, 0, 0, 0
    if placed:
        # Index 0 is where the day starts: the start point, or with none, the usual first stop
        # (which then stays first). Stop i is current[i - offset].
        offset = 0 if start["kind"] == "first_stop" else 1
        points = ([] if offset == 0 else [(start["latitude"], start["longitude"])]) + [positions[j.id] for j in current]
        seconds, metres, estimate, fell_back = drive_matrix(points)
        order = ([0] if offset == 0 else []) + best_order(seconds, range(1, len(points)), start=0)
        current_order = list(range(1, len(points)))
        suggested_jobs = [current[i - offset] for i in order]

        def walk(indices):
            here, rows = 0, []
            for index in indices:
                rows.append((seconds[here][index], metres[here][index]))
                here = index
            return rows

        legs = walk(order)
        suggested_s, suggested_m = sum(leg[0] for leg in legs), sum(leg[1] for leg in legs)
        current_legs = walk(current_order)
        current_s, current_m = sum(leg[0] for leg in current_legs), sum(leg[1] for leg in current_legs)

    customers = {c.id: c.name for c in Customer.query.filter(Customer.id.in_([j.customer_id for j in jobs if j.customer_id] or [0])).all()}

    def job_out(job):
        position = positions.get(job.id)
        return {
            "job_id": job.id,
            "title": job.title,
            "customer": customers.get(job.customer_id),
            "location": job.location,
            "status": job.status,
            "priority": job.priority,
            "due_date": job.due_date.isoformat() if job.due_date else None,
            "scheduled_start": job.scheduled_start.isoformat() if job.scheduled_start else None,
            "estimated_minutes": job.estimated_minutes,
            "latitude": position[0] if position else None,
            "longitude": position[1] if position else None,
        }

    stops_out = [
        {**job_out(job), "stop": number, "leg_seconds": round(leg_s), "leg_metres": round(leg_m)}
        for number, ((leg_s, leg_m), job) in enumerate(zip(legs, suggested_jobs), start=1)
    ]
    # The day's work against the working day: the stops' estimates (from their services, or set on
    # the job) and the booked visits' lengths. Stops without an estimate are counted apart.
    work_minutes = sum(job.estimated_minutes or 0 for job in suggested_jobs) + sum(
        round((job.scheduled_end - job.scheduled_start).total_seconds() / 60) for job in booked if job.scheduled_end
    )
    return {
        "date": day.isoformat(),
        "mechanic": {"id": mechanic.id, "name": mechanic.name},
        "work": {
            "minutes": work_minutes,
            "unestimated": sum(1 for job in suggested_jobs if not job.estimated_minutes),
            "day_minutes": minutes_of(company.booking_end) - minutes_of(company.booking_start),
        },
        "start": start,
        "estimate": estimate,
        "fell_back": fell_back,
        "stops": stops_out,
        "suggested": {"job_ids": [j.id for j in suggested_jobs], "seconds": round(suggested_s), "metres": round(suggested_m)},
        "current": {"job_ids": [j.id for j in current], "seconds": round(current_s), "metres": round(current_m)},
        "applied": bool(suggested_jobs) and [j.id for j in suggested_jobs] == [j.id for j in current] and len(saved) == len(placed),
        "booked": [job_out(j) for j in booked],
        "unplaced": [job_out(j) for j in sorted(unplaced, key=lambda j: usual_order(j, day))],
    }


def apply_order(mechanic, day, job_ids):
    """Save the order for the day: the technician's list follows it."""
    jobs = {j.id: j for j in Job.query.filter(Job.mechanic_id == mechanic.id, Job.id.in_(job_ids or [0])).all()}
    for position, job_id in enumerate(job_ids, start=1):
        jobs[job_id].route_date, jobs[job_id].route_order = day, position
    # Jobs dropped from the day's plan lose their place in it.
    for job in Job.query.filter(Job.mechanic_id == mechanic.id, Job.route_date == day, Job.id.notin_(job_ids or [0])).all():
        job.route_date, job.route_order = None, None
    db.session.flush()
