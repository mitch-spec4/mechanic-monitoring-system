from flask import Blueprint, jsonify

from app import db
from app.models.review import Review
from app.models.service_record import ServiceRecord
from app.services.notifications import notify, notify_bosses
from app.utils.auth import current_user, roles
from app.utils.pages import listing, only, searched
from app.utils.validation import ValidationError, integer, json_body, text
from app.i18n import N_, _

bp = Blueprint("reviews", __name__)


def out(review):
    return {
        "id": review.id,
        "rating": review.rating,
        "comment": review.comment,
        "advice": review.advice,
        "mechanic_id": review.mechanic_id,
        "machine_id": review.machine_id,
        "service_record_id": review.service_record_id,
        "created_at": review.created_at.isoformat(),
    }


def read_rating(data):
    return integer(data, "rating", "Rating", required=True, minimum=1, maximum=5)


@bp.get("")
@roles("boss", "mechanic", "customer")
def list_reviews():
    user = current_user()
    query = Review.query.filter_by(company_id=user.company_id)
    if user.role == "customer":
        query = query.filter_by(customer_id=user.customer_id)
    if user.role == "mechanic":
        query = query.filter_by(mechanic_id=user.id)
    if user.role == "boss":
        query = only(query, Review.mechanic_id, "mechanic_id", "Technician")
    return listing(searched(query, [Review.comment, Review.advice]).order_by(Review.id.desc()), "reviews", out)


@bp.post("")
@roles("customer")
def create_review():
    user = current_user()
    data = json_body()
    record_id = integer(data, "service_record_id", "Service record", required=True)
    record = ServiceRecord.query.filter_by(
        id=record_id, customer_id=user.customer_id, company_id=user.company_id
    ).first()
    if not record:
        raise ValidationError(_("Service record not found"), 404)
    if Review.query.filter_by(service_record_id=record.id).first():
        raise ValidationError(_("This service has already been reviewed"), 409)
    rating = read_rating(data)

    review = Review(
        customer_id=user.customer_id,
        mechanic_id=record.mechanic_id,
        machine_id=record.machine_id,
        company_id=user.company_id,
        service_record_id=record.id,
        rating=rating,
        comment=text(data, "comment"),
        advice=text(data, "advice"),
    )
    db.session.add(review)
    notify(record.mechanic_id, N_("New customer review"), N_("You received a {rating}/5 review."), "review", rating=rating)
    notify_bosses(user.company_id, N_("New customer review"), N_("A customer rated a completed service {rating}/5."), "review", rating=rating)
    db.session.commit()
    return jsonify(id=review.id), 201


@bp.patch("/<int:rid>")
@roles("customer")
def update_review(rid):
    user = current_user()
    review = Review.query.filter_by(id=rid, customer_id=user.customer_id, company_id=user.company_id).first_or_404()
    data = json_body()
    if "rating" in data:
        review.rating = read_rating(data)
    if "comment" in data:
        review.comment = text(data, "comment")
    if "advice" in data:
        review.advice = text(data, "advice")
    db.session.commit()
    return jsonify(ok=True)



# Reviews are part of the service history and are permanent: there is no delete endpoint.
