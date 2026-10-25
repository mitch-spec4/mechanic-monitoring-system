from app.utils.time import utcnow

from app import db

# How customers book a service: not at all (managers create its jobs), an inspection first and then
# the work, or the work directly at a time they pick.
BOOKING_TYPES = ("none", "inspection", "direct")


class ServiceTemplate(db.Model):
    """A service the company offers ("Generator 500-hour service"): what a job made from it starts
    with. No prices: quotes stay in the chat."""

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text)
    # Only for equipment of this type (as on the equipment's page); empty for any equipment.
    equipment_type = db.Column(db.String(80))
    # The checklist its jobs get (through the job type, as for any job).
    checklist_id = db.Column(db.Integer, db.ForeignKey("checklist_template.id"), nullable=True, index=True)
    # How long the work usually takes: the length of a booked visit, and the job's estimate.
    duration_minutes = db.Column(db.Integer, nullable=False, default=60)
    # The skills the work needs ("Electrical", "Welding"), shown on its jobs.
    skills = db.Column(db.JSON, nullable=False, default=list)
    booking = db.Column(db.String(20), nullable=False, default="none", server_default="none")
    # Turned off: not offered any more, but the jobs made from it keep it.
    active = db.Column(db.Boolean, nullable=False, default=True, server_default="1")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
