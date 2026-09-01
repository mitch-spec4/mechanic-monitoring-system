from flask import Blueprint,jsonify,request
from flask_jwt_extended import get_jwt
from app import db
from app.models.machine import Machine
from app.utils.auth import roles
bp=Blueprint("machines",__name__)
STATUSES={"Operational","Under Maintenance","Under Repair","Retired"}
@bp.get("")
@roles("boss","mechanic","customer")
def machines():
    c=get_jwt();q=Machine.query.filter_by(company_id=c["company_id"])
    if c["role"]=="customer":q=q.filter_by(customer_id=c["customer_id"])
    return jsonify(machines=[{"id":m.id,"name":m.name,"model":m.model,"serial_no":m.serial_no,"customer_id":m.customer_id,"status":m.status} for m in q.all()])
@bp.post("")
@roles("boss")
def create():
    d=request.json or {}
    if not d.get("name") or not d.get("serial_no"):return jsonify(error="Name and serial_no are required"),400
    if Machine.query.filter_by(serial_no=d["serial_no"]).first():return jsonify(error="Serial number already exists"),409
    m=Machine(company_id=get_jwt()["company_id"],name=d["name"],model=d.get("model"),serial_no=d["serial_no"],customer_id=d["customer_id"],status=d.get("status","Operational"))
    db.session.add(m);db.session.commit();return jsonify(id=m.id),201
@bp.patch("/<int:mid>")
@roles("boss")
def update(mid):
    m=Machine.query.filter_by(id=mid,company_id=get_jwt()["company_id"]).first_or_404();d=request.json or {}
    if "name" in d:m.name=d["name"]
    if "model" in d:m.model=d["model"]
    if "status" in d and d["status"] not in STATUSES:return jsonify(error="Invalid status"),400
    if "status" in d:m.status=d["status"]
    db.session.commit();return jsonify(ok=True)
@bp.delete("/<int:mid>")
@roles("boss")
def delete(mid):
    m=Machine.query.filter_by(id=mid,company_id=get_jwt()["company_id"]).first_or_404()
    db.session.delete(m);db.session.commit();return jsonify(ok=True)
