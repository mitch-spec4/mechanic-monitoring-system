from app import db
from app.models.notification import Notification
from app.models.user import User


def notify(user_id, title, message, kind="info"):
    """Queue a notification in the current transaction; the caller commits."""
    notification = Notification(user_id=user_id, title=title, message=message, type=kind)
    db.session.add(notification)
    return notification


def notify_bosses(company_id, title, message, kind="info"):
    for boss in User.query.filter_by(company_id=company_id, role="boss").all():
        notify(boss.id, title, message, kind)
