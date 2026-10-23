from app import db
from app.utils.time import utcnow


class Subscription(db.Model):
    """A company's plan. Companies without a row (created before plans existed) have no limits."""

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, unique=True)
    plan = db.Column(db.String(20), nullable=False)  # starter, professional, business
    interval = db.Column(db.String(10), nullable=False, default="month")  # month, year
    # trialing or active; whether a trial or paid period has run out is worked out from the dates.
    status = db.Column(db.String(20), nullable=False, default="trialing")
    trial_ends_at = db.Column(db.DateTime)
    # End of the paid period. None on an active subscription means it doesn't expire.
    current_period_end = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class Payment(db.Model):
    """One checkout: created when the boss chooses a plan, marked paid by the payment provider."""

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    plan = db.Column(db.String(20), nullable=False)
    interval = db.Column(db.String(10), nullable=False)
    amount_cents = db.Column(db.Integer, nullable=False)
    currency = db.Column(db.String(3), nullable=False)
    provider = db.Column(db.String(20), nullable=False)
    reference = db.Column(db.String(64), nullable=False, unique=True)
    status = db.Column(db.String(20), nullable=False, default="pending")  # pending, paid, failed
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    paid_at = db.Column(db.DateTime)
