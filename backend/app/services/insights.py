"""Insights for managers: how the team spent its time and how quickly jobs got done, over a range
of days in the company's time zone.

- A job counts as completed (or cancelled) on the day its history says it was, which for work
  done offline is when it really happened, not when it synced.
- Time to complete runs from the job's creation to its completion: what the customer waited.
- Clocked hours are shift time and job hours are worksheet time, each clipped to the range, so a
  shift across midnight on the first day counts only its part inside it. Open shifts and running
  timers count up to now.
- Repeat faults are the equipment that needed fixing twice or more in the 90 days up to the
  range's last day (see app/services/equipment.py).
- Money is the completed jobs' costing (app/services/costing.py): their cost, and for the jobs with
  an amount charged, what they made. Jobs with no charge yet don't count towards the margin.
"""
from datetime import datetime, time, timedelta, timezone
from statistics import median
from zoneinfo import ZoneInfo

from app import db
from app.models.customer import Customer
from app.models.job import Job
from app.models.location import Shift
from app.models.machine import Machine
from app.models.review import Review
from app.models.service_record import ServiceRecord
from app.models.user import User
from app.models.worksheet import JobEvent, WorkEntry
from app.services import equipment
from app.services.costing import job_costing
from app.utils.time import utcnow

# Longer ranges are shown a week at a time.
DAILY_UP_TO = 31
MAX_DAYS = 366


def utc_bounds(company, start, end):
    """The range [start 00:00, the day after end 00:00) in the company's zone, as naive UTC."""
    zone = ZoneInfo(company.timezone)

    def utc(day):
        return datetime.combine(day, time(0), zone).astimezone(timezone.utc).replace(tzinfo=None)

    return utc(start), utc(end + timedelta(days=1))


def local_day(moment, zone):
    return moment.replace(tzinfo=timezone.utc).astimezone(zone).date()


def hours_inside(start, end, low, high, now):
    """Hours of [start, end) inside [low, high); an open end runs to now."""
    stop = min(end or now, high, now)
    begin = max(start, low)
    return max((stop - begin).total_seconds(), 0) / 3600


def round_hours(value):
    return round(value, 1)


def finished_events(company_id, statuses, low, high):
    """{job_id: when it last moved to one of `statuses`}, for moves inside the range."""
    rows = (
        db.session.query(JobEvent.job_id, db.func.max(JobEvent.created_at))
        .join(Job, Job.id == JobEvent.job_id)
        .filter(Job.company_id == company_id, JobEvent.to_status.in_(statuses), JobEvent.created_at >= low, JobEvent.created_at < high)
        .group_by(JobEvent.job_id)
        .all()
    )
    return dict(rows)


def buckets(start, end):
    """The chart's bars: one a day for up to a month, else one a week (Monday to Sunday)."""
    days = (end - start).days + 1
    if days <= DAILY_UP_TO:
        return "day", [start + timedelta(days=offset) for offset in range(days)]
    first = start - timedelta(days=start.weekday())
    weeks = []
    while first <= end:
        weeks.append(first)
        first += timedelta(weeks=1)
    return "week", weeks


def insights(company, start, end, now=None):
    now = now or utcnow()
    zone = ZoneInfo(company.timezone)
    low, high = utc_bounds(company, start, end)
    company_id = company.id

    completed_at = finished_events(company_id, ("Completed",), low, high)
    cancelled = finished_events(company_id, ("Cancelled",), low, high)
    created = Job.query.filter(Job.company_id == company_id, Job.created_at >= low, Job.created_at < high).count()
    done_jobs = Job.query.filter(Job.id.in_(list(completed_at) or [0])).all()
    job_by_id = {job.id: job for job in done_jobs}

    # Worksheet time: every entry overlapping the range (for the team), and all of each completed
    # job's time (for "hours per job").
    entries = WorkEntry.query.join(Job, Job.id == WorkEntry.job_id).filter(
        Job.company_id == company_id, WorkEntry.started_at < high, db.or_(WorkEntry.ended_at.is_(None), WorkEntry.ended_at > low)
    ).all()
    worked_on = {}
    for entry in WorkEntry.query.filter(WorkEntry.job_id.in_(list(completed_at) or [0])).all():
        worked_on[entry.job_id] = worked_on.get(entry.job_id, 0) + hours_inside(entry.started_at, entry.ended_at, entry.started_at, now, now)

    waits = {job_id: max((at - job_by_id[job_id].created_at).total_seconds(), 0) / 3600 for job_id, at in completed_at.items() if job_id in job_by_id}

    # Completed jobs over time.
    unit, starts = buckets(start, end)
    counts = {day: 0 for day in starts}
    for at in completed_at.values():
        day = local_day(at, zone)
        key = day if unit == "day" else day - timedelta(days=day.weekday())
        if key in counts:
            counts[key] += 1
    series = [{"start": day.isoformat(), "count": counts[day]} for day in starts]

    by_type = {}
    for job in done_jobs:
        key = job.job_type or ""
        by_type[key] = by_type.get(key, 0) + 1

    # The team: every technician, with or without hours in the range.
    shifts = Shift.query.filter(Shift.company_id == company_id, Shift.clocked_in_at < high, db.or_(Shift.clocked_out_at.is_(None), Shift.clocked_out_at > low)).all()
    reviews = Review.query.filter(Review.company_id == company_id, Review.created_at >= low, Review.created_at < high).all()
    team = []
    for person in User.query.filter_by(company_id=company_id, role="mechanic").order_by(User.name).all():
        clocked = sum(hours_inside(s.clocked_in_at, s.clocked_out_at, low, high, now) for s in shifts if s.user_id == person.id)
        on_jobs = sum(hours_inside(e.started_at, e.ended_at, low, high, now) for e in entries if e.mechanic_id == person.id)
        theirs = [job_id for job_id, job in job_by_id.items() if job.mechanic_id == person.id]
        ratings = [review.rating for review in reviews if review.mechanic_id == person.id]
        team.append(
            {
                "id": person.id,
                "name": person.name,
                "clocked_hours": round_hours(clocked),
                "job_hours": round_hours(on_jobs),
                "share_on_jobs": round(on_jobs / clocked * 100) if clocked else None,
                "jobs_completed": len(theirs),
                "median_hours_to_complete": round_hours(median(waits[j] for j in theirs)) if theirs else None,
                "rating": round(sum(ratings) / len(ratings), 1) if ratings else None,
                "reviews": len(ratings),
            }
        )

    # Equipment with a repeat fault, as of the range's last day.
    machines = {m.id: m for m in Machine.query.filter_by(company_id=company_id).all()}
    faults_until = min(high, now)
    repeats = equipment.repeat_faults(company_id, list(machines), now=faults_until)
    customers = {c.id: c.name for c in Customer.query.filter(Customer.id.in_([machines[m].customer_id for m in repeats] or [0])).all()}
    last_fault = dict(
        db.session.query(ServiceRecord.machine_id, db.func.max(ServiceRecord.service_date))
        .filter(ServiceRecord.machine_id.in_(list(repeats) or [0]), ServiceRecord.service_date < faults_until)
        .group_by(ServiceRecord.machine_id)
        .all()
    )
    repeat_rows = sorted(
        (
            {
                "machine_id": machine_id,
                "name": machines[machine_id].name,
                "equipment_type": machines[machine_id].equipment_type,
                "customer": customers.get(machines[machine_id].customer_id),
                "faults": count,
                "last_fault": last_fault[machine_id].isoformat() if last_fault.get(machine_id) else None,
            }
            for machine_id, count in repeats.items()
        ),
        key=lambda row: (-row["faults"], row["name"]),
    )

    costings = {job_id: job_costing(job, now) for job_id, job in job_by_id.items()}
    charged = [c for c in costings.values() if c["charged_cents"] is not None]
    money = {
        "currency": company.currency,
        "labour_cents": sum(c["labour_cents"] for c in costings.values()),
        "parts_cents": sum(c["parts_cents"] for c in costings.values()),
        "cost_cents": sum(c["cost_cents"] for c in costings.values()),
        "charged_jobs": len(charged),
        "charged_cents": sum(c["charged_cents"] for c in charged),
        "margin_cents": sum(c["margin_cents"] for c in charged) if charged else None,
        # Totals leave out technicians with no pay rate and parts with no cost: say how many.
        "incomplete_jobs": sum(1 for c in costings.values() if c["missing_rates"] or c["missing_costs"]),
    }

    all_waits = list(waits.values())
    worked = [worked_on.get(job_id, 0) for job_id in waits]
    return {
        "range": {"start": start.isoformat(), "end": end.isoformat(), "days": (end - start).days + 1, "unit": unit},
        "jobs": {
            "created": created,
            "completed": len(completed_at),
            "cancelled": len(cancelled),
            "median_hours_to_complete": round_hours(median(all_waits)) if all_waits else None,
            "average_hours_to_complete": round_hours(sum(all_waits) / len(all_waits)) if all_waits else None,
            "average_hours_worked": round_hours(sum(worked) / len(worked)) if worked else None,
        },
        "hours": {
            "clocked": round_hours(sum(row["clocked_hours"] for row in team)),
            "on_jobs": round_hours(sum(row["job_hours"] for row in team)),
        },
        "completed_over_time": series,
        "by_type": [{"job_type": key, "count": count} for key, count in sorted(by_type.items(), key=lambda item: (-item[1], item[0]))],
        "technicians": team,
        "repeat_faults": repeat_rows,
        "money": money,
        # For the exports' list of jobs.
        "_completed_jobs": [
            {"job": job_by_id[job_id], "completed_at": at, "hours_to_complete": waits.get(job_id), "hours_worked": worked_on.get(job_id, 0), "costing": costings[job_id]}
            for job_id, at in sorted(completed_at.items(), key=lambda item: item[1])
            if job_id in job_by_id
        ],
    }
