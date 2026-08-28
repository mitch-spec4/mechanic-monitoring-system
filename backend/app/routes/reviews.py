from flask import Blueprint,request,jsonify
from flask_jwt_extended import get_jwt,get_jwt_identity
from app import db
from app.models.review import Review
from app.models.service_record import ServiceRecord
from app.models.user import User
from app.services.notifications import notify
from app.utils.auth import roles
bp=Blueprint("reviews",__name__)

@bp.get("")
@roles("boss","mechanic","customer")
def list_reviews():
    c=get_jwt();q=Review.query.filter_by(company_id=c["company_id"])
    if c["role"]=="customer":q=q.filter_by(customer_id=c["customer_id"])
    if c["role"]=="mechanic":q=q.filter_by(mechanic_id=int(get_jwt_identity()))
    return jsonify(reviews=[{"id":r.id,"rating":r.rating,"comment":r.comment,"advice":r.advice,"mechanic_id":r.mechanic_id,"service_record_id":r.service_record_id,"created_at":r.created_at.isoformat()} for r in q.order_by(Review.id.desc()).all()])

@bp.post("")
@roles("customer")
def create_review():
    d=request.json or {}; c=get_jwt(); s=ServiceRecord.query.filter_by(id=d.get("service_record_id"),customer_id=c["customer_id"],company_id=c["company_id"]).first()
    if not s:return jsonify(error="Service record not found"),404
    if Review.query.filter_by(service_record_id=s.id,customer_id=c["customer_id"]).first():return jsonify(error="This service has already been reviewed"),409
    rating=int(d.get("rating",0))
    if rating<1 or rating>5:return jsonify(error="Rating must be 1-5"),400
    r=Review(customer_id=c["customer_id"],mechanic_id=s.mechanic_id,machine_id=s.machine_id,company_id=c["company_id"],service_record_id=s.id,rating=rating,comment=d.get("comment"),advice=d.get("advice"))
    db.session.add(r);db.session.flush(); notify(s.mechanic_id,"New customer review",f"You received a {rating}/5 review.","review")
    boss=User.query.filter_by(company_id=c["company_id"],role="boss").first()
    if boss:notify(boss.id,"New customer review",f"A customer rated a completed service {rating}/5.","review")
    db.session.commit();return jsonify(id=r.id),201
