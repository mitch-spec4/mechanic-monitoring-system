from app import db
from datetime import datetime
class Invitation(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    code=db.Column(db.String(80),unique=True,nullable=False)
    company_id=db.Column(db.Integer,nullable=False)
    customer_name=db.Column(db.String(150),nullable=False)
    email=db.Column(db.String(160),nullable=False)
    role=db.Column(db.String(30),nullable=False,default="customer")
    used=db.Column(db.Boolean,default=False)
    expires_at=db.Column(db.DateTime,nullable=False)
