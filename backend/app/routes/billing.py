"""Public pricing and company signup, and the boss's Billing page with checkout."""
import math

from flask import Blueprint, abort, jsonify

from app import db
from app.models.billing import Payment
from app.models.company import Company
from app.models.user import User
from app.routes.auth import new_password, signed_in_response
from app.routes.worksheet import iso
from app.services import rate_limit
from app.services.billing import (
    create_payment,
    mark_paid,
    mechanic_count,
    provider,
    start_trial,
    state,
    storage_used,
    subscription_for,
)
from app.services.plans import CURRENCY, GB, INTERVALS, PLANS, TRIAL_DAYS, YEARLY_MONTHS, plan_out
from app.utils.auth import current_user, roles
from app.utils.time import utcnow
from app.utils.validation import ValidationError, choice, json_body, text
from app.utils.validation import email as read_email

bp = Blueprint("billing", __name__)


def subscription_out(subscription):
    if not subscription:
        return None
    current = state(subscription)
    ends = subscription.trial_ends_at if subscription.status == "trialing" else subscription.current_period_end
    days_left = None
    if ends and current != "expired":
        days_left = max(0, math.ceil((ends - utcnow()).total_seconds() / 86400))
    return {
        "plan": subscription.plan,
        "plan_name": PLANS[subscription.plan]["name"],
        "interval": subscription.interval,
        "state": current,
        "trial_ends_at": iso(subscription.trial_ends_at),
        "current_period_end": iso(subscription.current_period_end),
        "days_left": days_left,
    }


def payment_out(payment):
    return {
        "reference": payment.reference,
        "plan": payment.plan,
        "plan_name": PLANS[payment.plan]["name"],
        "interval": payment.interval,
        "amount_cents": payment.amount_cents,
        "currency": payment.currency,
        "provider": payment.provider,
        "status": payment.status,
        "created_at": iso(payment.created_at),
        "paid_at": iso(payment.paid_at),
    }


def pricing():
    checkout = provider()
    return {
        "plans": [plan_out(key) for key in PLANS],
        "currency": CURRENCY,
        "trial_days": TRIAL_DAYS,
        "yearly_months": YEARLY_MONTHS,
        # None means online payment isn't set up, so only free trials can start.
        "payment_provider": checkout.name if checkout else None,
    }


def read_plan(data, required=False):
    plan = choice(data, "plan", tuple(PLANS), "Plan")
    if not plan and required:
        raise ValidationError("Plan is required")
    return plan or "professional", choice(data, "interval", INTERVALS, "Billing period", default="month")


@bp.get("/plans")
def plans():
    return jsonify(pricing())


@bp.post("/signup")
def signup():
    """A new company and its owner (the boss). Every company starts on a free trial; paying now
    also returns the checkout to go to. The boss is signed in either way."""
    key = f"signup-ip:{rate_limit.client_ip()}"
    rate_limit.check(key)
    rate_limit.record(key)
    data = json_body()
    company_name = text(data, "company_name", "Company name", required=True, max_length=150)
    name = text(data, "name", "Your name", required=True, max_length=120)
    email = read_email(data)
    password = new_password(data)
    plan, interval = read_plan(data)
    pay_now = data.get("pay_now") is True
    if User.query.filter_by(email=email).first():
        raise ValidationError("An account with this email already exists. Sign in instead.", 409)
    if pay_now and not provider():
        raise ValidationError("Online payments aren't set up yet. Start with the free trial.", 409)

    company = Company(name=company_name)
    db.session.add(company)
    db.session.flush()
    boss = User(name=name, email=email, role="boss", company_id=company.id)
    boss.set_password(password)
    db.session.add(boss)
    db.session.flush()
    start_trial(company.id, plan)
    extra = {}
    if pay_now:
        payment, checkout = create_payment(boss, plan, interval)
        db.session.flush()
        extra["checkout_url"] = checkout.checkout_url(payment)
    db.session.commit()
    return signed_in_response(boss, 201, **extra)


@bp.get("/billing")
@roles("boss")
def billing():
    user = current_user()
    subscription = subscription_for(user.company_id)
    plan = PLANS[subscription.plan] if subscription else None
    paid = (
        Payment.query.filter_by(company_id=user.company_id, status="paid")
        .order_by(Payment.paid_at.desc(), Payment.id.desc())
        .limit(24)
        .all()
    )
    return jsonify(
        subscription=subscription_out(subscription),
        usage={
            "mechanics": mechanic_count(user.company_id),
            "mechanic_limit": plan["mechanics"] if plan else None,
            "storage_bytes": storage_used(user.company_id),
            "storage_limit_bytes": plan["storage_gb"] * GB if plan else None,
        },
        payments=[payment_out(payment) for payment in paid],
        **pricing(),
    )


@bp.post("/billing/checkout")
@roles("boss")
def checkout():
    user = current_user()
    plan, interval = read_plan(json_body(), required=True)
    payment, checkout_provider = create_payment(user, plan, interval)
    db.session.commit()
    return jsonify(checkout_url=checkout_provider.checkout_url(payment), payment=payment_out(payment)), 201


@bp.get("/billing/payments/<reference>")
@roles("boss")
def payment_detail(reference):
    user = current_user()
    payment = Payment.query.filter_by(reference=reference, company_id=user.company_id).first_or_404()
    company = db.session.get(Company, user.company_id)
    return jsonify(payment=payment_out(payment), company=company.name, email=user.email)


@bp.post("/billing/test/<reference>/pay")
@roles("boss")
def test_pay(reference):
    """The test provider's card page posts here. A declined card leaves the checkout open."""
    checkout_provider = provider()
    if not checkout_provider or checkout_provider.name != "test":
        abort(404)
    user = current_user()
    payment = Payment.query.filter_by(reference=reference, company_id=user.company_id, provider="test").first_or_404()
    if payment.status != "pending":
        raise ValidationError("This checkout is already finished.", 409)
    outcome = choice(json_body(), "outcome", ("success", "declined"), "Outcome", default="success")
    if outcome == "declined":
        raise ValidationError("The card was declined. No money was taken; try again.", 402)
    subscription = mark_paid(payment)
    db.session.commit()
    return jsonify(payment=payment_out(payment), subscription=subscription_out(subscription))
