from app import db
from datetime import datetime
class Notification(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    user_id=db.Column(db.Integer,db.ForeignKey("user.id"),nullable=False,index=True)
    title=db.Column(db.String(180),nullable=False)
    message=db.Column(db.Text,nullable=False)
    type=db.Column(db.String(40),default="info")
    is_read=db.Column(db.Boolean,default=False)
    created_at=db.Column(db.DateTime,default=datetime.utcnow)
