from flask import Blueprint,jsonify
from flask_jwt_extended import get_jwt,get_jwt_identity
from app.models.job import Job
from app.models.review import Review
from app.utils.auth import roles

bp=Blueprint("reports",__name__)

@bp.get("")
@roles("boss","mechanic","customer")
def report():
    claims=get_jwt(); query=Job.query.filter_by(company_id=claims["company_id"])
    if claims["role"]=="mechanic": query=query.filter_by(mechanic_id=int(get_jwt_identity()))
    if claims["role"]=="customer": query=query.filter_by(customer_id=claims["customer_id"])
    jobs=query.all()
    review_query=Review.query.filter_by(company_id=claims["company_id"])
    if claims["role"]=="mechanic": review_query=review_query.filter_by(mechanic_id=int(get_jwt_identity()))
    if claims["role"]=="customer": review_query=review_query.filter_by(customer_id=claims["customer_id"])
    ratings=[review.rating for review in review_query.all()]
    return jsonify(jobs={"total":len(jobs),"completed":sum(job.status=="Completed" for job in jobs),"pending":sum(job.status in {"Pending","Assigned","Accepted"} for job in jobs),"in_progress":sum(job.status in {"In Progress","Paused"} for job in jobs),"cancelled":sum(job.status=="Cancelled" for job in jobs)},rating=sum(ratings)/len(ratings) if ratings else None)