from flask import Blueprint,jsonify
from flask_jwt_extended import get_jwt
from app.models.user import User
from app.utils.auth import roles
bp=Blueprint("users",__name__)
@bp.get("/mechanics")
@roles("boss")
def mechanics():
    us=User.query.filter_by(company_id=get_jwt()["company_id"],role="mechanic").all()
    return jsonify(mechanics=[{"id":u.id,"name":u.name,"email":u.email} for u in us])
