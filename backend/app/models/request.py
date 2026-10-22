from app.utils.time import utcnow

from app import db
from app.models.constants import DEFAULT_PRIORITY


class ServiceRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.Integer, db.ForeignKey("customer.id"), nullable=False, index=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    machine_id = db.Column(db.Integer, db.ForeignKey("machine.id"), nullable=False, index=True)
    subject = db.Column(db.String(180), nullable=False)
    description = db.Column(db.Text, nullable=False)
    priority = db.Column(db.String(30), nullable=False, default=DEFAULT_PRIORITY)
    status = db.Column(db.String(40), nullable=False, default="Submitted")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
