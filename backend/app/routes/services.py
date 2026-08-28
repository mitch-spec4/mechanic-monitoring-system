from flask import Blueprint,request,jsonify
from flask_jwt_extended import get_jwt_identity,get_jwt
from app import db
from app.models.service_record import ServiceRecord
from app.models.machine import Machine
from app.utils.auth import roles
bp=Blueprint("services",__name__)
@bp.get("")
@roles("boss","mechanic","customer")
def list_services():
    claims=get_jwt();q=ServiceRecord.query.filter_by(company_id=claims["company_id"])
    if claims["role"]=="mechanic":q=q.filter_by(mechanic_id=int(get_jwt_identity()))
    if claims["role"]=="customer":q=q.filter_by(customer_id=claims.get("customer_id"))
    return jsonify(records=[{"id":x.id,"machine_id":x.machine_id,"customer_id":x.customer_id,"mechanic_id":x.mechanic_id,"service_type":x.service_type,"problem":x.problem,"work_done":x.work_done,"parts_replaced":x.parts_replaced,"solution":x.solution,"advice":x.advice,"service_date":x.service_date.isoformat()} for x in q.order_by(ServiceRecord.id.desc()).all()])
@bp.post("")
@roles("mechanic")
def create():
    d=request.json or {};claims=get_jwt();m=Machine.query.filter_by(id=d.get("machine_id"),company_id=claims["company_id"]).first()
    if not m:return jsonify(error="Machine not found"),404
    if not d.get("service_type"):return jsonify(error="Service type is required"),400
    s=ServiceRecord(machine_id=m.id,customer_id=m.customer_id,mechanic_id=int(get_jwt_identity()),company_id=m.company_id,service_type=d["service_type"],problem=d.get("problem"),work_done=d.get("work_done"),parts_replaced=d.get("parts_replaced"),solution=d.get("solution"),advice=d.get("advice"))
    db.session.add(s);db.session.commit();return jsonify(id=s.id),201
