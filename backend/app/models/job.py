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
    # A visit booked by a customer for their service request: an inspection or the repair after
    # it, at a time they picked. The technician taps "On my way" before leaving for it; customers
    # get a reminder the day before (reminder_sent_at).
    request_id = db.Column(db.Integer, db.ForeignKey("service_request.id"), nullable=True, index=True)
    visit = db.Column(db.String(20))
    scheduled_start = db.Column(db.DateTime, index=True)
    scheduled_end = db.Column(db.DateTime)
    on_the_way_at = db.Column(db.DateTime)
    reminder_sent_at = db.Column(db.DateTime)
    # Made by a maintenance plan: completing it moves the plan's next due date on.
    plan_id = db.Column(db.Integer, db.ForeignKey("maintenance_plan.id"), nullable=True, index=True)
    # Its place in its technician's planned route for route_date (app/services/routing.py). Where
    # it is comes from its equipment's site.
    route_date = db.Column(db.Date)
    route_order = db.Column(db.Integer)
    # What the customer is charged, in cents (job costing; managers only).
    charged_cents = db.Column(db.Integer)
    # Customer sign-off at completion: a signature (stored as a JobFile of kind "signature")
    # with the signer's name, or the reason nobody could sign.
    signed_by_name = db.Column(db.String(120))
    signed_at = db.Column(db.DateTime)
    no_signature_reason = db.Column(db.Text)
