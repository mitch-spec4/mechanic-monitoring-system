from flask import Blueprint, jsonify, request

from app import db
from app.models.notification import Notification
from app.utils.auth import current_user, roles
from app.utils.pages import listing, searched

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
    query = searched(Notification.query.filter_by(user_id=current_user().id), [Notification.title, Notification.message]).order_by(Notification.id.desc())
    # The bell shows the newest 100; the Notifications page goes back page by page.
    if "page" not in request.args:
        query = query.limit(100)
    return listing(query, "notifications", out)


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
