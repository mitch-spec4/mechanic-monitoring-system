from flask import Blueprint, jsonify

from app import db
from app.models.notification import Notification
from app.utils.auth import current_user, roles

bp = Blueprint("notifications", __name__)


def out(notification):
    return {
        "id": notification.id,
        "title": notification.title,
        "message": notification.message,
        "type": notification.type,
        "is_read": notification.is_read,
        "created_at": notification.created_at.isoformat(),
    }


@bp.get("")
@roles("boss", "mechanic", "customer")
def notifications():
    rows = (
        Notification.query.filter_by(user_id=current_user().id)
        .order_by(Notification.id.desc())
        .limit(100)
        .all()
    )
    return jsonify(notifications=[out(row) for row in rows])


@bp.patch("/read-all")
@roles("boss", "mechanic", "customer")
def read_all():
    Notification.query.filter_by(user_id=current_user().id, is_read=False).update({"is_read": True})
    db.session.commit()
    return jsonify(ok=True)


@bp.patch("/<int:nid>/read")
@roles("boss", "mechanic", "customer")
def read(nid):
    notification = Notification.query.filter_by(id=nid, user_id=current_user().id).first_or_404()
    notification.is_read = True
    db.session.commit()
    return jsonify(ok=True)


@bp.delete("/<int:nid>")
@roles("boss", "mechanic", "customer")
def delete(nid):
    notification = Notification.query.filter_by(id=nid, user_id=current_user().id).first_or_404()
    db.session.delete(notification)
    db.session.commit()
    return jsonify(ok=True)
