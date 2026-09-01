from flask import Blueprint,jsonify,request
from flask_jwt_extended import get_jwt,get_jwt_identity
from app import db
from app.models.user import User
from app.utils.auth import roles
bp=Blueprint("users",__name__)
@bp.get("")
@roles("boss")
def list_users():
    us=User.query.filter_by(company_id=get_jwt()["company_id"]).all()
    return jsonify(users=[{"id":u.id,"name":u.name,"email":u.email,"role":u.role} for u in us])
@bp.get("/mechanics")
@roles("boss")
def mechanics():
    us=User.query.filter_by(company_id=get_jwt()["company_id"],role="mechanic").all()
    return jsonify(mechanics=[{"id":u.id,"name":u.name,"email":u.email} for u in us])
@bp.get("/me")
@roles("boss","mechanic","customer")
def me():
    u=User.query.get_or_404(int(get_jwt_identity()))
    return jsonify(user={"id":u.id,"name":u.name,"email":u.email,"role":u.role,"company_id":u.company_id})
@bp.patch("/<int:uid>")
@roles("boss")
def update_user(uid):
    u=User.query.filter_by(id=uid,company_id=get_jwt()["company_id"]).first_or_404();d=request.json or {}
    if "name" in d:u.name=d["name"]
    if "email" in d:
        if User.query.filter_by(email=d["email"].lower()).filter(User.id!=uid).first():return jsonify(error="Email already exists"),409
        u.email=d["email"].lower()
    db.session.commit();return jsonify(ok=True)
@bp.delete("/<int:uid>")
@roles("boss")
def delete_user(uid):
    if uid==int(get_jwt_identity()):return jsonify(error="Cannot delete your own account"),400
    u=User.query.filter_by(id=uid,company_id=get_jwt()["company_id"]).first_or_404()
    db.session.delete(u);db.session.commit();return jsonify(ok=True)
