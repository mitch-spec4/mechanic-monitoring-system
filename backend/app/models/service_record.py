from app import db
from datetime import datetime
class ServiceRecord(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    machine_id=db.Column(db.Integer,db.ForeignKey("machine.id"),nullable=False)
    customer_id=db.Column(db.Integer,db.ForeignKey("customer.id"),nullable=False)
    mechanic_id=db.Column(db.Integer,db.ForeignKey("user.id"),nullable=False)
    company_id=db.Column(db.Integer,db.ForeignKey("company.id"),nullable=False)
    service_type=db.Column(db.String(80),nullable=False)
    problem=db.Column(db.Text)
    work_done=db.Column(db.Text)
    parts_replaced=db.Column(db.Text)
    solution=db.Column(db.Text)
    advice=db.Column(db.Text)
    service_date=db.Column(db.DateTime,default=datetime.utcnow)
