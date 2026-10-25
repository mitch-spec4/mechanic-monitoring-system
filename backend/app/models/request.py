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
    updated_at = db.Column(db.DateTime)
    # How long the repair takes, set by the manager after the inspection (else the company's default).
    repair_minutes = db.Column(db.Integer)
    inspected_at = db.Column(db.DateTime)
    completed_at = db.Column(db.DateTime)
    # Reminders sent once: to book the repair a few days after the inspection, and the follow-up
    # the day after the work is done.
    repair_reminder_sent_at = db.Column(db.DateTime)
    follow_up_sent_at = db.Column(db.DateTime)
    # The service the customer picked, and how it's booked (fixed when the request is made):
    # "inspection" first (also every request without a service), or "direct".
    service_id = db.Column(db.Integer, db.ForeignKey("service_template.id"), nullable=True, index=True)
    booking = db.Column(db.String(20), nullable=False, default="inspection", server_default="inspection")


class CustomerMessage(db.Model):
    """The chat between a customer and the company's managers (quotes, questions, changes)."""

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    customer_id = db.Column(db.Integer, db.ForeignKey("customer.id"), nullable=False, index=True)
    sender_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    from_customer = db.Column(db.Boolean, nullable=False, default=False)
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)
    # When the other side opened it.
    read_at = db.Column(db.DateTime)
