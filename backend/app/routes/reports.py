from flask import Blueprint, jsonify

from app.models.customer import Customer
from app.models.job import Job
from app.models.machine import Machine
from app.models.request import ServiceRequest
from app.models.review import Review
from app.models.service_record import ServiceRecord
from app.utils.auth import current_user, roles

bp = Blueprint("reports", __name__)


@bp.get("")
@roles("boss", "mechanic", "customer")
def report():
    user = current_user()
    jobs = Job.query.filter_by(company_id=user.company_id)
    reviews = Review.query.filter_by(company_id=user.company_id)
    records = ServiceRecord.query.filter_by(company_id=user.company_id)
    if user.role == "mechanic":
        jobs = jobs.filter_by(mechanic_id=user.id)
        reviews = reviews.filter_by(mechanic_id=user.id)
        records = records.filter_by(mechanic_id=user.id)
    if user.role == "customer":
        jobs = jobs.filter_by(customer_id=user.customer_id)
        reviews = reviews.filter_by(customer_id=user.customer_id)
        records = records.filter_by(customer_id=user.customer_id)

    job_rows = jobs.all()
    ratings = [review.rating for review in reviews.all()]
    record_rows = records.all()

    if user.role == "boss":
        totals = {
            "customers": Customer.query.filter_by(company_id=user.company_id).count(),
            "machines": Machine.query.filter_by(company_id=user.company_id).count(),
        }
    elif user.role == "mechanic":
        totals = {
            "customers": len({record.customer_id for record in record_rows}),
            "machines": len({record.machine_id for record in record_rows}),
        }
    else:
        totals = {
            "machines": Machine.query.filter_by(company_id=user.company_id, customer_id=user.customer_id).count(),
            "open_requests": ServiceRequest.query.filter_by(company_id=user.company_id, customer_id=user.customer_id)
            .filter(ServiceRequest.status.notin_(["Completed", "Cancelled"]))
            .count(),
        }

    return jsonify(
        jobs={
            "total": len(job_rows),
            "completed": sum(job.status == "Completed" for job in job_rows),
            "pending": sum(job.status in {"Pending", "Assigned", "Accepted"} for job in job_rows),
            "in_progress": sum(job.status in {"In Progress", "Paused"} for job in job_rows),
            "cancelled": sum(job.status == "Cancelled" for job in job_rows),
        },
        # Customers see mechanic ratings elsewhere, not an average of their own reviews.
        rating=(sum(ratings) / len(ratings)) if ratings and user.role != "customer" else None,
        review_count=len(ratings),
        service_records=len(record_rows),
        totals=totals,
    )
