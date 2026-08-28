from flask import Blueprint,jsonify,request
from flask_jwt_extended import get_jwt
from app import db
from app.models.machine import Machine
from app.utils.auth import roles
bp=Blueprint("machines",__name__)
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
    m=Machine(company_id=get_jwt()["company_id"],name=d["name"],model=d.get("model"),serial_no=d["serial_no"],customer_id=d["customer_id"])
    db.session.add(m);db.session.commit();return jsonify(id=m.id),201
