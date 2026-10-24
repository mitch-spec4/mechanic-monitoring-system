"""Which machines need work, and why. One rule shared by every screen: an open job, an open
service request, planned maintenance that's due, or a status of Under Maintenance or Under Repair.
Equipment that needed fixing again and again is also flagged (repeat_faults)."""
from app import db
from app.models.company import Company
from app.models.constants import ACTIVE_JOB_STATUSES, CLOSED_REQUEST_STATUSES
from app.models.job import Job
from app.models.request import ServiceRequest
from app.services.equipment import company_today, due_plans, plan_state, repeat_faults

NEEDS_WORK_STATUSES = ("Under Maintenance", "Under Repair")


def work_by_machine(company_id, machine_ids):
    """{machine_id: [reason, ...]} for the open jobs and requests on these machines."""
    reasons = {machine_id: [] for machine_id in machine_ids}
    if not machine_ids:
        return reasons
    jobs = (
        Job.query.filter(Job.company_id == company_id, Job.machine_id.in_(machine_ids), Job.status.in_(ACTIVE_JOB_STATUSES))
        .order_by(Job.id)
        .all()
    )
    for job in jobs:
        reasons[job.machine_id].append({"type": "job", "id": job.id, "title": job.title, "status": job.status})
    requests = (
        ServiceRequest.query.filter(
            ServiceRequest.company_id == company_id,
            ServiceRequest.machine_id.in_(machine_ids),
            ServiceRequest.status.notin_(CLOSED_REQUEST_STATUSES),
        )
        .order_by(ServiceRequest.id)
        .all()
    )
    for request in requests:
        reasons[request.machine_id].append({"type": "request", "id": request.id, "title": request.subject, "status": request.status})
    today = company_today(db.session.get(Company, company_id))
    for machine_id, plans in due_plans(company_id, machine_ids, today).items():
        for plan in plans:
            state = "Overdue" if plan_state(plan, today) == "overdue" else "Service due"
            reasons[machine_id].append({"type": "maintenance", "id": plan.id, "title": plan.title, "status": state, "due": plan.next_due.isoformat()})
    return reasons


def with_work(machine_rows, company_id):
    """Add needs_work and work (the reasons) to serialized machines."""
    reasons = work_by_machine(company_id, [row["id"] for row in machine_rows])
    repeats = repeat_faults(company_id, [row["id"] for row in machine_rows])
    for row in machine_rows:
        row["repeat_faults"] = repeats.get(row["id"], 0)
        work = list(reasons.get(row["id"], []))
        if row["status"] in NEEDS_WORK_STATUSES:
            work.append({"type": "status", "status": row["status"]})
        row["work"] = work
        row["needs_work"] = bool(work)
    return machine_rows
