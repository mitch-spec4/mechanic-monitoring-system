from app import db
from datetime import datetime
class Review(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    customer_id=db.Column(db.Integer,nullable=False)
    mechanic_id=db.Column(db.Integer,nullable=False)
    machine_id=db.Column(db.Integer,nullable=False)
    company_id=db.Column(db.Integer,nullable=False)
    service_record_id=db.Column(db.Integer,nullable=False)
    rating=db.Column(db.Integer,nullable=False)
    comment=db.Column(db.Text)
    advice=db.Column(db.Text)
    created_at=db.Column(db.DateTime,default=datetime.utcnow)
