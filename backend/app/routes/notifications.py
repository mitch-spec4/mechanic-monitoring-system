from flask import Blueprint,jsonify
from flask_jwt_extended import get_jwt_identity
from app import db
from app.models.notification import Notification
from app.utils.auth import roles
bp=Blueprint("notifications",__name__)
@bp.get("")
@roles("boss","mechanic","customer")
def notifications():
    uid=int(get_jwt_identity());n=Notification.query.filter_by(user_id=uid).order_by(Notification.id.desc()).all()
    return jsonify(notifications=[{"id":x.id,"title":x.title,"message":x.message,"type":x.type,"is_read":x.is_read,"created_at":x.created_at.isoformat()} for x in n])
@bp.patch("/<int:nid>/read")
@roles("boss","mechanic","customer")
def read(nid):
    n=Notification.query.filter_by(id=nid,user_id=int(get_jwt_identity())).first_or_404();n.is_read=True;db.session.commit();return jsonify(ok=True)
@bp.delete("/<int:nid>")
@roles("boss","mechanic","customer")
def delete(nid):
    n=Notification.query.filter_by(id=nid,user_id=int(get_jwt_identity())).first_or_404();db.session.delete(n);db.session.commit();return jsonify(ok=True)
