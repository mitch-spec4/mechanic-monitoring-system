from flask import Blueprint

from app.models.service_record import ServiceRecord
from app.utils.auth import current_user, roles
from app.utils.pages import listing, searched

bp = Blueprint("services", __name__)


def out(record):
    return {
        "id": record.id,
        "job_id": record.job_id,
        "machine_id": record.machine_id,
        "customer_id": record.customer_id,
        "mechanic_id": record.mechanic_id,
        "service_type": record.service_type,
        "problem": record.problem,
        "work_done": record.work_done,
        "parts_replaced": record.parts_replaced,
        "solution": record.solution,
        "advice": record.advice,
        "service_date": record.service_date.isoformat(),
    }


@bp.get("")
@roles("boss", "mechanic", "customer")
def list_services():
    user = current_user()
    query = ServiceRecord.query.filter_by(company_id=user.company_id)
    if user.role == "mechanic":
        query = query.filter_by(mechanic_id=user.id)
    if user.role == "customer":
        query = query.filter_by(customer_id=user.customer_id)
    columns = [ServiceRecord.service_type, ServiceRecord.problem, ServiceRecord.work_done, ServiceRecord.parts_replaced, ServiceRecord.solution, ServiceRecord.advice]
    return listing(searched(query, columns).order_by(ServiceRecord.id.desc()), "records", out)


# Service records are created and edited through a job's worksheet (PUT /api/jobs/<id>/record)
# and filled in automatically when the job is completed. They are permanent history, so there
# are no create, edit, or delete endpoints here.
