from app.utils.time import utcnow

from app import db
from app.models.constants import DEFAULT_PRIORITY


class Job(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=False)
    priority = db.Column(db.String(30), nullable=False, default=DEFAULT_PRIORITY)
    status = db.Column(db.String(40), nullable=False, default="Pending")
    job_type = db.Column(db.String(80))
    location = db.Column(db.String(200))
    due_date = db.Column(db.Date)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    customer_id = db.Column(db.Integer, db.ForeignKey("customer.id"), nullable=True, index=True)
    machine_id = db.Column(db.Integer, db.ForeignKey("machine.id"), nullable=True, index=True)
    mechanic_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
