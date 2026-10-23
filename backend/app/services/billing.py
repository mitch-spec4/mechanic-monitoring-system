"""Subscriptions: which plan a company is on, what it allows, and taking payment for it.

Payment providers sit behind one small interface (a name and a checkout_url). The only one so
far is the built-in test provider: it takes no real money, and the app refuses to start with it
in production. A real provider (Paystack, Flutterwave, Paddle...) plugs in here once there is an
account for it; until then production runs with BILLING_PROVIDER=none (free trials only).
"""
import secrets
from datetime import timedelta

from flask import current_app

from app import db
from app.models.billing import Payment, Subscription
from app.models.company import Company
from app.models.invitation import Invitation
from app.models.media import JobFile
from app.models.user import User
from app.services.plans import CURRENCY, GB, PLANS, TRIAL_DAYS, add_period, price_cents
from app.utils.time import utcnow
from app.utils.validation import ValidationError
from app.i18n import _
from app.services import audit

PROVIDERS = ("test", "none")


class TestProvider:
    """Checkout on the app's own pretend card page. Nothing leaves the server."""

    name = "test"

    def checkout_url(self, payment):
        return f"#/checkout/{payment.reference}"


def init_billing(app):
    name = app.config["BILLING_PROVIDER"]
    if name not in PROVIDERS:
        raise RuntimeError("BILLING_PROVIDER must be 'test' or 'none'")
    if name == "test" and app.config["IS_PRODUCTION"]:
        raise RuntimeError("BILLING_PROVIDER=test takes no real money and is only for development")
    app.extensions["billing"] = TestProvider() if name == "test" else None


def provider():
    return current_app.extensions.get("billing")


def subscription_for(company_id):
    return Subscription.query.filter_by(company_id=company_id).first()


def start_trial(company_id, plan):
    trial = Subscription(
        company_id=company_id,
        plan=plan,
        interval="month",
        status="trialing",
        trial_ends_at=utcnow() + timedelta(days=TRIAL_DAYS),
    )
    db.session.add(trial)
    return trial


def state(subscription, now=None):
    """trialing, active, or expired (the trial or the paid period ran out)."""
    now = now or utcnow()
    if subscription.status == "trialing":
        return "trialing" if subscription.trial_ends_at and subscription.trial_ends_at > now else "expired"
    if subscription.current_period_end is None or subscription.current_period_end > now:
        return "active"
    return "expired"


def create_payment(user, plan, interval):
    checkout = provider()
    if not checkout:
        raise ValidationError(_("Online payments aren't set up yet. Start with the free trial."), 409)
    if checkout.name != "test" and db.session.get(Company, user.company_id).is_demo:
        raise ValidationError(_("This is a demo company, so it can't take real payments."), 403)
    payment = Payment(
        company_id=user.company_id,
        user_id=user.id,
        plan=plan,
        interval=interval,
        amount_cents=price_cents(plan, interval),
        currency=CURRENCY,
        provider=checkout.name,
        reference="pay_" + secrets.token_urlsafe(18),
    )
    db.session.add(payment)
    return payment, checkout


def mark_paid(payment):
    """Activate the paid plan. Renewing the same plan adds a period after the current one ends;
    a different plan or billing period starts today."""
    now = utcnow()
    subscription = subscription_for(payment.company_id)
    if not subscription:
        subscription = Subscription(company_id=payment.company_id)
        db.session.add(subscription)
    renewal = (
        subscription.status == "active"
        and subscription.plan == payment.plan
        and subscription.interval == payment.interval
        and subscription.current_period_end is not None
        and subscription.current_period_end > now
    )
    start = subscription.current_period_end if renewal else now
    subscription.plan, subscription.interval, subscription.status = payment.plan, payment.interval, "active"
    subscription.current_period_end = add_period(start, payment.interval)
    payment.status, payment.paid_at = "paid", now
    audit.record("plan_paid", company_id=payment.company_id, detail=f"{PLANS[payment.plan]['name']} / {payment.interval}")
    return subscription


def require_active(company_id, action):
    """Once a trial or paid period runs out, existing work carries on but nothing new is added.
    `action` is already translated, e.g. _("invite people")."""
    subscription = subscription_for(company_id)
    if subscription and state(subscription) == "expired":
        if subscription.status == "trialing":
            raise ValidationError(_("Your free trial has ended. Choose a plan under Billing to {action}.", action=action), 402)
        raise ValidationError(_("Your plan has run out. Choose a plan under Billing to {action}.", action=action), 402)


def mechanic_count(company_id):
    """Mechanics on the team plus invitations to mechanics that can still be accepted."""
    open_invitations = Invitation.query.filter(
        Invitation.company_id == company_id,
        Invitation.role == "mechanic",
        Invitation.used.is_(False),
        Invitation.expires_at > utcnow(),
    ).count()
    return User.query.filter_by(company_id=company_id, role="mechanic").count() + open_invitations


def check_mechanic_limit(company_id):
    subscription = subscription_for(company_id)
    if not subscription:
        return
    plan = PLANS[subscription.plan]
    if mechanic_count(company_id) >= plan["mechanics"]:
        raise ValidationError(
            _(
                "Your {plan} plan includes up to {count} technicians, counting open invitations. "
                "Choose a bigger plan under Billing to add more.",
                plan=plan["name"],
                count=plan["mechanics"],
            ),
            409,
        )


def storage_used(company_id):
    return (
        db.session.query(db.func.coalesce(db.func.sum(JobFile.size_bytes), 0))
        .filter(JobFile.company_id == company_id, JobFile.status == "ready")
        .scalar()
    )


def check_storage(company_id, adding_bytes, lock=False):
    """Refuse a file that would take the company past its plan's storage. With `lock`, checks made
    at the same moment wait for each other, so two uploads can't both squeeze into the last space."""
    query = Subscription.query.filter_by(company_id=company_id)
    subscription = (query.with_for_update() if lock else query).first()
    if not subscription:
        return
    plan = PLANS[subscription.plan]
    if storage_used(company_id) + adding_bytes > plan["storage_gb"] * GB:
        raise ValidationError(
            _(
                "Your {plan} plan's {size} GB of storage is full. Choose a bigger plan under Billing for more space.",
                plan=plan["name"],
                size=plan["storage_gb"],
            ),
            413,
        )
