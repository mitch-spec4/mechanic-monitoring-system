from app.utils.time import utcnow

from app import db


class Site(db.Model):
    """A place a customer has equipment: a factory, a branch, a quarry. Jobs on its equipment go there."""

    __table_args__ = (db.UniqueConstraint("customer_id", "name", name="uq_site_customer_name"),)

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    customer_id = db.Column(db.Integer, db.ForeignKey("customer.id"), nullable=False, index=True)
    name = db.Column(db.String(150), nullable=False)
    address = db.Column(db.String(255))
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class MaintenancePlan(db.Model):
    """Service a piece of equipment needs again and again: every N days, weeks or months. The daily
    run creates its job when it comes due (lead_days ahead) and sends the reminders, once per due date
    (reminded_for); completing that job moves next_due on (app/services/equipment.py)."""

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    machine_id = db.Column(db.Integer, db.ForeignKey("machine.id"), nullable=False, index=True)
    title = db.Column(db.String(150), nullable=False)
    job_type = db.Column(db.String(80))
    every = db.Column(db.Integer, nullable=False)
    unit = db.Column(db.String(10), nullable=False)  # days, weeks, months
    next_due = db.Column(db.Date, nullable=False, index=True)
    lead_days = db.Column(db.Integer, nullable=False, default=7, server_default="7")
    active = db.Column(db.Boolean, nullable=False, default=True, server_default="1")
    last_done = db.Column(db.Date)
    reminded_for = db.Column(db.Date)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
