from flask import Blueprint,request,jsonify
from flask_jwt_extended import create_access_token
from app import db
from app.models.user import User
from app.models.customer import Customer
from app.models.invitation import Invitation
from datetime import datetime
bp=Blueprint("auth",__name__)

@bp.post("/login")
def login():
    d=request.json or {};u=User.query.filter_by(email=d.get("email","").lower()).first()
    if not u or not u.check_password(d.get("password","")): return jsonify(error="Invalid credentials"),401
    token=create_access_token(identity=str(u.id),additional_claims={"role":u.role,"company_id":u.company_id,"customer_id":u.customer_id})
    return jsonify(token=token,user={"id":u.id,"name":u.name,"email":u.email,"role":u.role,"company_id":u.company_id,"customer_id":u.customer_id})

@bp.post("/register")
def register():
    return jsonify(error="Accounts are created through a company invitation"),403

@bp.post("/accept-invitation")
def accept_invitation():
    d=request.json or {};inv=Invitation.query.filter_by(code=d.get("code"),used=False).first()
    if not inv or inv.expires_at<datetime.utcnow(): return jsonify(error="Invalid or expired invitation"),400
    if User.query.filter_by(email=d["email"].lower()).first(): return jsonify(error="Email already registered"),409
    customer_id=None
    if inv.role=="customer":
        c=Customer(name=d["name"],email=d["email"].lower(),company_id=inv.company_id);db.session.add(c);db.session.flush();customer_id=c.id
    u=User(name=d["name"],email=d["email"].lower(),role=inv.role,company_id=inv.company_id,customer_id=customer_id);u.set_password(d["password"])
    inv.used=True;db.session.add(u);db.session.commit()
    return jsonify(message="Invitation accepted"),201
