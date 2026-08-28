from flask import Blueprint, request, jsonify
from flask_jwt_extended import get_jwt, get_jwt_identity
from app import db
from app.models.customer import Customer
from app.models.invitation import Invitation
from app.models.machine import Machine
from app.models.job import Job
from app.models.user import User
from app.models.request import ServiceRequest
from app.services.notifications import notify
from app.utils.auth import roles
from datetime import datetime, timedelta
import secrets

bp=Blueprint("customers",__name__)

@bp.get("")
@roles("boss")
def customers():
    cs=Customer.query.filter_by(company_id=get_jwt()["company_id"]).all()
    return jsonify(customers=[{"id":c.id,"name":c.name,"email":c.email,"phone":c.phone} for c in cs])

@bp.get("/me")
@roles("customer")
def me():
    c=Customer.query.get_or_404(get_jwt()["customer_id"])
    return jsonify(customer={"id":c.id,"name":c.name,"email":c.email,"phone":c.phone})

@bp.post("/invite")
@roles("boss")
def invite():
    d=request.json or {}
    if not d.get("name") or not d.get("email"): return jsonify(error="Name and email are required"),400
    role=d.get("role","customer")
    if role not in {"customer","mechanic"}: return jsonify(error="Only customers and mechanics can be invited"),400
    code="DK-"+secrets.token_hex(5).upper()
    inv=Invitation(code=code,company_id=get_jwt()["company_id"],customer_name=d["name"],email=d["email"].lower(),role=role,expires_at=datetime.utcnow()+timedelta(days=7))
    db.session.add(inv); db.session.commit()
    return jsonify(code=code,expires_at=inv.expires_at.isoformat()),201

@bp.get("/requests")
@roles("boss","customer")
def requests_list():
    claims=get_jwt(); q=ServiceRequest.query.filter_by(company_id=claims["company_id"])
    if claims["role"]=="customer": q=q.filter_by(customer_id=claims["customer_id"])
    return jsonify(requests=[{ "id":r.id,"machine_id":r.machine_id,"customer_id":r.customer_id,"subject":r.subject,"description":r.description,"priority":r.priority,"status":r.status,"created_at":r.created_at.isoformat()} for r in q.order_by(ServiceRequest.id.desc()).all()])

@bp.post("/requests")
@roles("customer")
def create_request():
    d=request.json or {}; claims=get_jwt()
    m=Machine.query.filter_by(id=d.get("machine_id"),customer_id=claims["customer_id"],company_id=claims["company_id"]).first()
    if not m:return jsonify(error="Machine not found"),404
    r=ServiceRequest(customer_id=claims["customer_id"],company_id=claims["company_id"],machine_id=m.id,subject=d["subject"],description=d["description"],priority=d.get("priority","Normal"))
    db.session.add(r);db.session.flush()
    boss=User.query.filter_by(company_id=claims["company_id"],role="boss").first()
    if boss: notify(boss.id,"New customer service request",f'{r.subject} was submitted.',"request")
    db.session.commit(); return jsonify(id=r.id),201

@bp.patch("/requests/<int:rid>")
@roles("boss")
def update_request(rid):
    r=ServiceRequest.query.filter_by(id=rid,company_id=get_jwt()["company_id"]).first_or_404(); d=request.json or {}
    status=d.get("status",r.status)
    if status not in {"Submitted","Received","Reviewing","Approved","Mechanic Assigned","Scheduled","In Progress","Completed","Cancelled"}:return jsonify(error="Invalid request status"),400
    r.status=status
    customer=User.query.filter_by(company_id=r.company_id,customer_id=r.customer_id,role="customer").first()
    if customer:notify(customer.id,"Service request updated",f"Your request is now {status}.","request")
    db.session.commit(); return jsonify(ok=True,status=r.status)
