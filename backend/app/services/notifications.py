from app import db
from app.models.notification import Notification
def notify(user_id,title,message,kind="info"):
    n=Notification(user_id=user_id,title=title,message=message,type=kind)
    db.session.add(n); db.session.commit()
    return n
