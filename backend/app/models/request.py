from app import db
from datetime import datetime

class ServiceRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.Integer, nullable=False)
    company_id = db.Column(db.Integer, nullable=False)
    machine_id = db.Column(db.Integer, nullable=False)
    subject = db.Column(db.String(180), nullable=False)
    description = db.Column(db.Text, nullable=False)
    priority = db.Column(db.String(30), default="Normal")
    status = db.Column(db.String(40), default="Open")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
