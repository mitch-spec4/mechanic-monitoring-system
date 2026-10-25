from app import db
from app.i18n import _, speaking
from app.models.notification import Notification
from app.models.user import User


def notify(user_id, title, message, kind="info", translate=(), /, **values):
    """Queue a notification in the current transaction; the caller commits.

    `title` and `message` are English templates marked with N_(), written out in the recipient's
    language with `values`; the values named in `translate` (a job status, say) are translated too."""
    recipient = db.session.get(User, user_id)
    with speaking(recipient.language if recipient else None):
        values = {key: _(value) if key in translate else value for key, value in values.items()}
        notification = Notification(user_id=user_id, title=_(title), message=_(message, **values), type=kind)
    db.session.add(notification)
    return notification


def notify_bosses(company_id, title, message, kind="info", translate=(), /, **values):
    for boss in User.query.filter_by(company_id=company_id, role="boss", removed_at=None).all():
        notify(boss.id, title, message, kind, translate, **values)
