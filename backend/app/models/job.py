from app import db
from datetime import datetime
class Job(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    title=db.Column(db.String(200),nullable=False)
    description=db.Column(db.Text,nullable=False)
    priority=db.Column(db.String(30),default="Normal")
    status=db.Column(db.String(40),default="Pending")
    location=db.Column(db.String(200))
    due_date=db.Column(db.String(80))
    company_id=db.Column(db.Integer,db.ForeignKey("company.id"),nullable=False)
    customer_id=db.Column(db.Integer,db.ForeignKey("customer.id"),nullable=True)
    machine_id=db.Column(db.Integer,db.ForeignKey("machine.id"),nullable=True)
    mechanic_id=db.Column(db.Integer,db.ForeignKey("user.id"),nullable=True)
    created_at=db.Column(db.DateTime,default=datetime.utcnow)
