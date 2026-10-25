from app import db
from app.utils.time import utcnow


class Subscription(db.Model):
    """A company's plan. Companies without a row (created before plans existed) have no limits."""

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, unique=True)
    plan = db.Column(db.String(20), nullable=False)  # starter, professional, business
    interval = db.Column(db.String(10), nullable=False, default="month")  # month, year
    # Technicians bought on top of the plan's own.
    extra_mechanics = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    # trialing or active; whether a trial or paid period has run out is worked out from the dates.
    status = db.Column(db.String(20), nullable=False, default="trialing")
    trial_ends_at = db.Column(db.DateTime)
    # End of the paid period. None on an active subscription means it doesn't expire.
    current_period_end = db.Column(db.DateTime)
    # Off once the manager cancels: the plan then ends with the paid period.
    auto_renew = db.Column(db.Boolean, nullable=False, default=True, server_default=db.true())
    # The provider's token for charging the card or wallet used last (never the card itself),
    # and how it's shown ("Visa •••• 4081", "M-Pesa 0712 •••• 678").
    payment_token = db.Column(db.String(255))
    payment_method = db.Column(db.String(80))
    # When a renewal first went unpaid (a declined card, or no saved card to charge).
    past_due_since = db.Column(db.DateTime)
    # When the "your trial ends soon" or "your plan renews soon" reminder went out, so it goes once.
    reminded_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class Payment(db.Model):
    """One charge: a checkout the boss starts, or a renewal the daily run makes with the saved card."""

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    # Who started it; renewals are on behalf of the boss who first paid.
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    kind = db.Column(db.String(10), nullable=False, default="checkout", server_default="checkout")  # checkout, renewal
    plan = db.Column(db.String(20), nullable=False)
    interval = db.Column(db.String(10), nullable=False)
    extra_mechanics = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    amount_cents = db.Column(db.Integer, nullable=False)
    currency = db.Column(db.String(3), nullable=False)
    provider = db.Column(db.String(20), nullable=False)
    reference = db.Column(db.String(64), nullable=False, unique=True)
    status = db.Column(db.String(20), nullable=False, default="pending")  # pending, paid, failed
    failure_reason = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    paid_at = db.Column(db.DateTime)
    failed_at = db.Column(db.DateTime)


class BillingEvent(db.Model):
    """A webhook event already handled: providers resend events, and each must count once."""

    __table_args__ = (db.UniqueConstraint("provider", "event_id", name="uq_billing_event"),)

    id = db.Column(db.Integer, primary_key=True)
    provider = db.Column(db.String(20), nullable=False)
    event_id = db.Column(db.String(128), nullable=False)
    kind = db.Column(db.String(20), nullable=False)
    reference = db.Column(db.String(64))
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), index=True)
    received_at = db.Column(db.DateTime, nullable=False, default=utcnow)
