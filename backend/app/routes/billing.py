"""Public pricing and company signup, the boss's Billing page with checkout, and the payment
provider's webhooks."""
from flask import Blueprint, abort, jsonify, request
from sqlalchemy.exc import IntegrityError

from app import db
from app.models.billing import Payment
from app.models.company import Company
from app.models.user import User
from app.routes.auth import new_password, signed_in_response
from app.routes.worksheet import iso
from app.services import audit, rate_limit
from app.services.accounts import send_verification
from app.services.billing import (
    Event,
    TestProvider,
    apply_event,
    check_plan_fits,
    create_payment,
    mechanic_count,
    mechanic_limit,
    provider,
    start_trial,
    state,
    storage_used,
    subscription_for,
    subscription_out,
)
from app.services.plans import CURRENCY, EXTRA_MECHANIC_CENTS, GB, INTERVALS, MAX_EXTRA_MECHANICS, PLANS, TRIAL_DAYS, YEARLY_MONTHS, plan_out
from app.utils.auth import current_user, roles
from app.utils.validation import ValidationError, agreed_to_terms, choice, integer, json_body, text
from app.services.legal import record_agreement
from app.utils.validation import email as read_email
from app.i18n import _, current_language

bp = Blueprint("billing", __name__)


def payment_out(payment):
    return {
        "reference": payment.reference,
        "kind": payment.kind,
        "plan": payment.plan,
        "plan_name": PLANS[payment.plan]["name"],
        "interval": payment.interval,
        "extra_mechanics": payment.extra_mechanics,
        "amount_cents": payment.amount_cents,
        "currency": payment.currency,
        "provider": payment.provider,
        "status": payment.status,
        "failure_reason": payment.failure_reason,
        "created_at": iso(payment.created_at),
        "paid_at": iso(payment.paid_at),
        "failed_at": iso(payment.failed_at),
    }


def pricing():
    checkout = provider()
    return {
        "plans": [plan_out(key) for key in PLANS],
        "currency": CURRENCY,
        "trial_days": TRIAL_DAYS,
        "yearly_months": YEARLY_MONTHS,
        # Each technician beyond a plan's own, a month (yearly: times YEARLY_MONTHS).
        "extra_mechanic_cents": EXTRA_MECHANIC_CENTS,
        "max_extra_mechanics": MAX_EXTRA_MECHANICS,
        # None means online payment isn't set up, so only free trials can start.
        "payment_provider": checkout.name if checkout else None,
    }


EMAIL_TAKEN = "An account with this email already exists. Sign in instead."


def email_in_use(email):
    return User.query.filter_by(email=email).first() is not None


def read_plan(data, required=False):
    plan = choice(data, "plan", tuple(PLANS), "Plan")
    if not plan and required:
        raise ValidationError(_("Plan is required"))
    return plan or "professional", choice(data, "interval", INTERVALS, "Billing period", default="month")


def read_extra_mechanics(data):
    extra = integer(data, "extra_mechanics", "Extra technicians") or 0
    if not 0 <= extra <= MAX_EXTRA_MECHANICS:
        raise ValidationError(_("Extra technicians must be between 0 and {most}", most=MAX_EXTRA_MECHANICS))
    return extra


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
    agreed_to_terms(data)
    if email_in_use(email):
        raise ValidationError(EMAIL_TAKEN, 409)
    if pay_now and not provider():
        raise ValidationError(_("Online payments aren't set up yet. Start with the free trial."), 409)

    # The company starts in the language its owner signed up in.
    company = Company(name=company_name, language=current_language())
    db.session.add(company)
    db.session.flush()
    boss = User(name=name, email=email, role="boss", company_id=company.id, language=company.language)
    boss.set_password(password)
    record_agreement(boss)
    db.session.add(boss)
    try:
        db.session.flush()
    except IntegrityError:
        # Another signup with this email got in first, after the check above.
        db.session.rollback()
        raise ValidationError(EMAIL_TAKEN, 409)
    start_trial(company.id, plan)
    extra = {}
    if pay_now:
        payment, checkout = create_payment(boss, plan, interval)
        db.session.flush()
        extra["checkout_url"] = checkout.checkout_url(payment, boss)
    db.session.commit()
    # Signing up doesn't wait on the email: if it fails, the boss can resend it from the banner.
    send_verification(boss)
    return signed_in_response(boss, 201, **extra)


@bp.get("/billing")
@roles("boss")
def billing():
    user = current_user()
    subscription = subscription_for(user.company_id)
    plan = PLANS[subscription.plan] if subscription else None
    finished = (
        Payment.query.filter(Payment.company_id == user.company_id, Payment.status.in_(("paid", "failed")))
        .order_by(db.func.coalesce(Payment.paid_at, Payment.failed_at).desc(), Payment.id.desc())
        .limit(24)
        .all()
    )
    return jsonify(
        subscription=subscription_out(subscription),
        usage={
            "mechanics": mechanic_count(user.company_id),
            "mechanic_limit": mechanic_limit(subscription) if subscription else None,
            "storage_bytes": storage_used(user.company_id),
            "storage_limit_bytes": plan["storage_gb"] * GB if plan else None,
        },
        payments=[payment_out(payment) for payment in finished],
        **pricing(),
    )


@bp.post("/billing/checkout")
@roles("boss")
def checkout():
    """Pay for a plan: the same one again (a renewal, or more technicians), or another."""
    user = current_user()
    data = json_body()
    plan, interval = read_plan(data, required=True)
    extra = read_extra_mechanics(data)
    check_plan_fits(user.company_id, plan, extra)
    payment, checkout_provider = create_payment(user, plan, interval, extra)
    db.session.flush()
    url = checkout_provider.checkout_url(payment, user)
    db.session.commit()
    return jsonify(checkout_url=url, payment=payment_out(payment)), 201


@bp.post("/billing/renewal")
@roles("boss")
def renewal():
    """Cancel renewal (the plan ends with its paid period) or turn it back on."""
    user = current_user()
    subscription = subscription_for(user.company_id)
    if not subscription or subscription.status != "active" or not subscription.current_period_end:
        raise ValidationError(_("There's no paid plan to renew."), 409)
    renew = json_body().get("auto_renew")
    if not isinstance(renew, bool):
        raise ValidationError(_("Say whether the plan should renew."))
    if renew:
        if state(subscription) == "expired":
            raise ValidationError(_("This plan has ended. Choose a plan to start a new one."), 409)
        subscription.auto_renew = True
        audit.record("plan_renewal_on", user=user)
    else:
        apply_event(Event("cancelled", company_id=user.company_id), "app")
    db.session.commit()
    return jsonify(subscription=subscription_out(subscription))


@bp.get("/billing/payments/<reference>")
@roles("boss")
def payment_detail(reference):
    user = current_user()
    payment = Payment.query.filter_by(reference=reference, company_id=user.company_id).first_or_404()
    company = db.session.get(Company, user.company_id)
    return jsonify(payment=payment_out(payment), company=company.name, email=user.email)


@bp.post("/billing/payments/<reference>/confirm")
@roles("boss")
def confirm(reference):
    """Back from the provider's checkout: ask it how it went (the webhook may already have said)."""
    user = current_user()
    payment = Payment.query.filter_by(reference=reference, company_id=user.company_id).first_or_404()
    checkout_provider = provider()
    if payment.status == "pending" and checkout_provider and checkout_provider.name == payment.provider:
        event = checkout_provider.confirm(payment)
        if event:
            event.reference = payment.reference
            apply_event(event, checkout_provider.name)
            db.session.commit()
    return jsonify(payment=payment_out(payment), subscription=subscription_out(subscription_for(user.company_id)))


@bp.post("/billing/webhooks/<name>")
def webhook(name):
    """The payment provider tells us what happened. Only the configured provider's, correctly
    signed; each event counts once however often it's resent."""
    checkout_provider = provider()
    if not checkout_provider or checkout_provider.name != name:
        abort(404)
    for event in checkout_provider.events(request.get_data(), request.headers):
        apply_event(event, name)
    db.session.commit()
    return jsonify(ok=True)


def test_provider():
    checkout_provider = provider()
    if not checkout_provider or checkout_provider.name != "test":
        abort(404)
    return checkout_provider


@bp.post("/billing/test/<reference>/pay")
@roles("boss")
def test_pay(reference):
    """The test provider's card page posts here. A declined card leaves the checkout open; the
    "renews with a declined card" one pays now and fails when it's next charged."""
    test_provider()
    user = current_user()
    payment = Payment.query.filter_by(reference=reference, company_id=user.company_id, provider="test").first_or_404()
    if payment.status != "pending":
        raise ValidationError(_("This checkout is already finished."), 409)
    outcome = choice(json_body(), "outcome", ("success", "declined", "declines_later"), "Outcome", default="success")
    if outcome == "declined":
        raise ValidationError(_("The card was declined. No money was taken; try again."), 402)
    token = TestProvider.DECLINED_TOKEN if outcome == "declines_later" else TestProvider.TOKEN
    apply_event(Event("paid", payment.reference, token=token, method=f"Test card •••• {token[-4:]}"), "test")
    db.session.commit()
    return jsonify(payment=payment_out(payment), subscription=subscription_out(subscription_for(user.company_id)))


@bp.post("/billing/test/renew")
@roles("boss")
def test_renew():
    """Test mode only: charge the saved test card for the next period now, as the daily run will a
    day before the period ends."""
    checkout_provider = test_provider()
    user = current_user()
    subscription = subscription_for(user.company_id)
    if not subscription or subscription.status != "active" or not subscription.payment_token:
        raise ValidationError(_("Pay with a test card first, so there's a card to charge."), 409)
    payment, _provider = create_payment(user, subscription.plan, subscription.interval, subscription.extra_mechanics, kind="renewal")
    db.session.flush()
    apply_event(checkout_provider.charge_saved(payment, subscription, user.email), "test")
    db.session.commit()
    return jsonify(payment=payment_out(payment), subscription=subscription_out(subscription))
