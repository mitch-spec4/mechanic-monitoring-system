from flask import Blueprint, jsonify

from app import db
from app.models.constants import CLOSED_REQUEST_STATUSES
from app.models.customer import Customer
from app.models.job import Job
from app.models.machine import Machine
from app.models.media import JobFile
from app.models.request import ServiceRequest
from app.models.review import Review
from app.models.service_record import ServiceRecord
from app.utils.auth import current_user, roles

bp = Blueprint("reports", __name__)


def open_requests(query):
    return query.filter(ServiceRequest.status.notin_(CLOSED_REQUEST_STATUSES)).count()


@bp.get("")
@roles("boss", "mechanic", "customer")
def report():
    """The numbers on the dashboards and the side bar, counted by the database: the side bar asks
    every minute, and a company's jobs only grow."""
    user = current_user()
    jobs = Job.query.filter_by(company_id=user.company_id)
    reviews = Review.query.filter_by(company_id=user.company_id)
    records = ServiceRecord.query.filter_by(company_id=user.company_id)
    requests = ServiceRequest.query.filter_by(company_id=user.company_id)
    if user.role == "mechanic":
        jobs = jobs.filter_by(mechanic_id=user.id)
        reviews = reviews.filter_by(mechanic_id=user.id)
        records = records.filter_by(mechanic_id=user.id)
    if user.role == "customer":
        jobs = jobs.filter_by(customer_id=user.customer_id)
        reviews = reviews.filter_by(customer_id=user.customer_id)
        records = records.filter_by(customer_id=user.customer_id)
        requests = requests.filter_by(customer_id=user.customer_id)

    statuses = dict(jobs.with_entities(Job.status, db.func.count(Job.id)).group_by(Job.status).all())
    average, review_count = reviews.with_entities(db.func.avg(Review.rating), db.func.count(Review.id)).one()

    if user.role == "boss":
        totals = {
            "customers": Customer.query.filter_by(company_id=user.company_id).count(),
            "machines": Machine.query.filter_by(company_id=user.company_id).count(),
            # Photos, videos and signatures stored for the company (for plan limits later).
            "storage_bytes": db.session.query(db.func.coalesce(db.func.sum(JobFile.size_bytes), 0))
            .filter(JobFile.company_id == user.company_id, JobFile.status == "ready")
            .scalar(),
            "open_requests": open_requests(requests),
        }
    elif user.role == "mechanic":
        totals = {
            "customers": records.with_entities(db.func.count(db.distinct(ServiceRecord.customer_id))).scalar(),
            "machines": records.with_entities(db.func.count(db.distinct(ServiceRecord.machine_id))).scalar(),
        }
    else:
        totals = {
            "machines": Machine.query.filter_by(company_id=user.company_id, customer_id=user.customer_id).count(),
            "open_requests": open_requests(requests),
        }

    return jsonify(
        jobs={
            "total": sum(statuses.values()),
            "completed": statuses.get("Completed", 0),
            "pending": sum(statuses.get(status, 0) for status in ("Pending", "Assigned", "Accepted")),
            "in_progress": sum(statuses.get(status, 0) for status in ("In Progress", "Paused")),
            "cancelled": statuses.get("Cancelled", 0),
        },
        # Customers see mechanic ratings elsewhere, not an average of their own reviews.
        rating=float(average) if review_count and user.role != "customer" else None,
        review_count=review_count,
        service_records=records.count(),
        totals=totals,
    )
