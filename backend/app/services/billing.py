"""Subscriptions: which plan a company is on, what it allows, and taking payment for it.

Payment providers sit behind one interface (`Provider`): start a checkout, charge the saved card
for a renewal, confirm a checkout when the customer comes back, and read the provider's webhooks.
Whatever a provider reports becomes an `Event` ("paid", "failed", "cancelled", "plan_changed"),
handled the same way for every provider by `apply_event`.

- `test`: the app's own pretend card page, for development. Nothing leaves the server, and the
  app refuses to start with it in production.
- `paystack`: Paystack in test mode (keys starting sk_test_), cards and M-Pesa in KES. Live keys
  are refused until live payments are switched on (see SETUP.md).
- `none`: no online payment; companies can only start free trials.

Another provider (Flutterwave, Paddle, Lemon Squeezy...) fits by implementing the same methods.

Renewals: the daily run charges the saved card a day before a paid period ends. If that fails, or
there's no saved card, the company has GRACE_DAYS after the period ends to pay, with everything
still working; after that it's limited like an ended trial (work in progress carries on, nothing
new is added) until a plan is paid. Cancelling stops renewals: the plan ends with its period.
"""
import hashlib
import hmac
import json
import math
import secrets
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import timedelta

from flask import current_app

from app import db
from app.models.billing import BillingEvent, Payment, Subscription
from app.models.company import Company
from app.models.invitation import Invitation
from app.models.media import JobFile
from app.models.user import User
from app.services.plans import (
    ALL_FEATURES,
    CURRENCY,
    FEATURE_NAMES,
    GB,
    PLANS,
    TRIAL_DAYS,
    add_period,
    first_plan_with,
    price_cents,
)
from app.utils.time import utcnow
from app.utils.validation import ValidationError
from app.i18n import N_, _, local_time, speaking
from app.services import audit

PROVIDERS = ("test", "paystack", "none")
# Days after a paid period ends that an unpaid renewal keeps everything working.
GRACE_DAYS = 7
# How many times the daily run tries a declined card before leaving it to the manager.
RENEWAL_ATTEMPTS = 3
# Reminders this many days before a trial or an unrenewed plan ends.
REMIND_DAYS = 3


@dataclass
class Event:
    """What a provider says happened, in the app's terms."""

    kind: str  # paid, failed, cancelled, plan_changed
    reference: str | None = None  # the Payment's reference
    event_id: str | None = None  # the provider's id for the event, to handle it once
    token: str | None = None  # a reusable token for charging the same card or wallet again
    method: str | None = None  # how that card or wallet is shown
    reason: str | None = None  # why a payment failed, in the provider's words
    amount_cents: int | None = None
    currency: str | None = None
    company_id: int | None = None  # for events about a subscription rather than a payment
    plan: str | None = None
    interval: str | None = None


class Provider:
    name = ""

    def checkout_url(self, payment, user):
        """Where to send the manager to pay."""
        raise NotImplementedError

    def charge_saved(self, payment, subscription, email):
        """Charge the saved card for a renewal: an Event, or None while the provider decides."""
        return None

    def confirm(self, payment):
        """The checkout's outcome when the manager comes back: an Event, or None if not known yet."""
        return None

    def events(self, body, headers):
        """The events in a webhook, after checking it really came from the provider."""
        raise ValidationError("Not accepted", 400)


class TestProvider(Provider):
    """Checkout on the app's own pretend card page. Nothing leaves the server. Its webhooks are
    signed with HMAC-SHA256 of the body using the app's secret key, so tests can send them."""

    name = "test"
    TOKEN = "test_card_4242"
    DECLINED_TOKEN = "test_card_0002"

    def checkout_url(self, payment, user):
        return f"#/checkout/{payment.reference}"

    def charge_saved(self, payment, subscription, email):
        if subscription.payment_token == self.DECLINED_TOKEN:
            return Event("failed", payment.reference, reason="Declined (test card)")
        return Event("paid", payment.reference, token=subscription.payment_token, method=subscription.payment_method)

    def signature(self, body):
        return hmac.new(current_app.config["SECRET_KEY"].encode(), body, hashlib.sha256).hexdigest()

    def events(self, body, headers):
        if not hmac.compare_digest(headers.get("X-Test-Signature", ""), self.signature(body)):
            raise ValidationError("Bad signature", 401)
        data = json.loads(body)
        fields = {key: data.get(key) for key in Event.__dataclass_fields__ if key != "kind"}
        return [Event(data["kind"], **fields)]


class PaystackProvider(Provider):
    """Paystack (paystack.com): cards and M-Pesa, priced in KES. Test mode only, for now.

    Checkout: initialize a transaction, send the manager to its page, and verify it when they come
    back (and again from the charge.success webhook, whichever arrives first). Renewals charge the
    saved authorization. Webhooks are signed with HMAC-SHA512 of the body using the secret key."""

    name = "paystack"
    API = "https://api.paystack.co"

    def __init__(self, secret_key, timeout=15):
        self.secret_key = secret_key
        self.timeout = timeout

    def call(self, method, path, data=None):
        request = urllib.request.Request(
            f"{self.API}{path}",
            data=json.dumps(data).encode() if data is not None else None,
            method=method,
            headers={"Authorization": f"Bearer {self.secret_key}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            # Paystack explains refusals in the body ("Invalid email", "Insufficient funds"...).
            try:
                return json.loads(error.read())
            except ValueError:
                return {"status": False, "message": f"HTTP {error.code}"}
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            current_app.logger.warning("Paystack %s %s failed: %s", method, path, error)
            raise ValidationError(_("The payment service didn't answer. Try again in a minute."), 502) from None

    def checkout_url(self, payment, user):
        from app.services.email import app_link

        answer = self.call(
            "POST",
            "/transaction/initialize",
            {
                "email": user.email,
                "amount": payment.amount_cents,
                "currency": payment.currency,
                "reference": payment.reference,
                "callback_url": app_link(f"/billing?paid={payment.reference}"),
                "metadata": {"company_id": payment.company_id, "plan": payment.plan, "interval": payment.interval},
            },
        )
        if not answer.get("status"):
            raise ValidationError(_("The payment service refused the checkout: {reason}", reason=answer.get("message", "")), 502)
        return answer["data"]["authorization_url"]

    @staticmethod
    def method_of(data):
        authorization = data.get("authorization") or {}
        if authorization.get("channel") == "mobile_money" or data.get("channel") == "mobile_money":
            return f"{authorization.get('bank') or 'Mobile money'} •••• {authorization.get('last4', '')}".strip()
        if authorization.get("last4"):
            return f"{(authorization.get('card_type') or 'Card').strip().title()} •••• {authorization['last4']}"
        return None

    def from_transaction(self, data, event_id=None):
        authorization = data.get("authorization") or {}
        common = {"reference": data.get("reference"), "event_id": event_id, "amount_cents": data.get("amount"), "currency": data.get("currency")}
        if data.get("status") == "success":
            token = authorization.get("authorization_code") if authorization.get("reusable") else None
            return Event("paid", token=token, method=self.method_of(data), **common)
        if data.get("status") in ("failed", "abandoned", "reversed"):
            return Event("failed", reason=data.get("gateway_response") or data.get("status"), **common)
        return None

    def confirm(self, payment):
        answer = self.call("GET", f"/transaction/verify/{payment.reference}")
        event = self.from_transaction(answer.get("data") or {}) if answer.get("status") else None
        if event:
            event.reference = payment.reference
        return event

    def charge_saved(self, payment, subscription, email):
        answer = self.call(
            "POST",
            "/transaction/charge_authorization",
            {
                "email": email,
                "amount": payment.amount_cents,
                "currency": payment.currency,
                "reference": payment.reference,
                "authorization_code": subscription.payment_token,
            },
        )
        if not answer.get("status"):
            return Event("failed", payment.reference, reason=answer.get("message"))
        event = self.from_transaction(answer.get("data") or {})
        if event:
            event.reference = payment.reference
        return event

    def events(self, body, headers):
        expected = hmac.new(self.secret_key.encode(), body, hashlib.sha512).hexdigest()
        if not hmac.compare_digest(headers.get("X-Paystack-Signature", ""), expected):
            raise ValidationError("Bad signature", 401)
        data = json.loads(body)
        payload = data.get("data") or {}
        event_id = f"{data.get('event')}:{payload.get('id') or payload.get('reference')}"
        if data.get("event") == "charge.success":
            event = self.from_transaction(payload, event_id)
            return [event] if event else []
        # Other events (disputes, refunds, transfers...) aren't used yet.
        return []


def init_billing(app):
    name = app.config["BILLING_PROVIDER"]
    if name not in PROVIDERS:
        raise RuntimeError("BILLING_PROVIDER must be 'test', 'paystack' or 'none'")
    if name == "test" and app.config["IS_PRODUCTION"]:
        raise RuntimeError("BILLING_PROVIDER=test takes no real money and is only for development")
    if name == "paystack":
        key = app.config["PAYSTACK_SECRET_KEY"]
        if not key.startswith("sk_test_"):
            raise RuntimeError(
                "PAYSTACK_SECRET_KEY must be a Paystack test key (sk_test_...). Live payments aren't switched on yet: see SETUP.md."
            )
        app.extensions["billing"] = PaystackProvider(key)
        return
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
    """trialing; active; past_due (the paid period is over, its renewal unpaid, within the grace
    days); or expired (the trial ran out, a cancelled plan reached its end, or grace is over)."""
    now = now or utcnow()
    if subscription.status == "trialing":
        return "trialing" if subscription.trial_ends_at and subscription.trial_ends_at > now else "expired"
    end = subscription.current_period_end
    if end is None or end > now:
        return "active"
    if subscription.auto_renew and now < end + timedelta(days=GRACE_DAYS):
        return "past_due"
    return "expired"


def grace_ends(subscription):
    end = subscription.current_period_end
    return end + timedelta(days=GRACE_DAYS) if end and subscription.status == "active" and subscription.auto_renew else None


def mechanic_limit(subscription):
    return PLANS[subscription.plan]["mechanics"] + (subscription.extra_mechanics or 0)


def iso(moment):
    return moment.isoformat() if moment else None


def subscription_out(subscription, now=None):
    """What the app shows about a plan: the Billing page, and the banner every manager sees."""
    if not subscription:
        return None
    now = now or utcnow()
    current = state(subscription, now)
    ends = subscription.trial_ends_at if subscription.status == "trialing" else subscription.current_period_end
    days_left = None
    if ends and current in ("trialing", "active"):
        days_left = max(0, math.ceil((ends - now).total_seconds() / 86400))
    grace = grace_ends(subscription)
    return {
        "plan": subscription.plan,
        "plan_name": PLANS[subscription.plan]["name"],
        "interval": subscription.interval,
        "extra_mechanics": subscription.extra_mechanics or 0,
        "state": current,
        "trial_ends_at": iso(subscription.trial_ends_at),
        "current_period_end": iso(subscription.current_period_end),
        "days_left": days_left,
        "auto_renew": bool(subscription.auto_renew),
        "payment_method": subscription.payment_method,
        # A renewal is unpaid (declined, or nothing saved to charge): pay by grace_ends_at.
        "payment_problem": subscription.past_due_since is not None or current == "past_due",
        "grace_ends_at": iso(grace) if current in ("active", "past_due") and (subscription.past_due_since or current == "past_due") else None,
    }


# ---------- Features ----------


def features_for(company_id):
    """The features a company's plan includes. Companies from before plans existed have them all."""
    subscription = subscription_for(company_id)
    return ALL_FEATURES if not subscription else PLANS[subscription.plan]["features"]


def has_feature(company_id, feature):
    return feature in features_for(company_id)


def require_feature(company_id, feature):
    if not has_feature(company_id, feature):
        plan = PLANS[first_plan_with(feature)]["name"]
        raise ValidationError(
            _("{feature} is on the {plan} plan and up. Choose a plan under Billing to use it.", feature=_(FEATURE_NAMES[feature]), plan=plan),
            403,
        )


# ---------- Checkout and payments ----------


def check_plan_fits(company_id, plan, extra_mechanics):
    """A smaller plan must still hold the team and the files."""
    limit = PLANS[plan]["mechanics"] + extra_mechanics
    team = mechanic_count(company_id)
    if team > limit:
        raise ValidationError(
            _(
                "Your team has {team} technicians (counting open invitations), more than the {count} this choice includes. Add extra technicians or remove some first.",
                team=team,
                count=limit,
            ),
            409,
        )
    if storage_used(company_id) > PLANS[plan]["storage_gb"] * GB:
        raise ValidationError(
            _("Your files take more than the {plan} plan's {size} GB. Choose a bigger plan.", plan=PLANS[plan]["name"], size=PLANS[plan]["storage_gb"]),
            409,
        )


def create_payment(user, plan, interval, extra_mechanics=0, kind="checkout"):
    checkout = provider()
    if not checkout:
        raise ValidationError(_("Online payments aren't set up yet. Start with the free trial."), 409)
    if checkout.name != "test" and db.session.get(Company, user.company_id).is_demo:
        raise ValidationError(_("This is a demo company, so it can't take real payments."), 403)
    payment = Payment(
        company_id=user.company_id,
        user_id=user.id,
        kind=kind,
        plan=plan,
        interval=interval,
        extra_mechanics=extra_mechanics,
        amount_cents=price_cents(plan, interval, extra_mechanics),
        currency=CURRENCY,
        provider=checkout.name,
        reference="pay_" + secrets.token_urlsafe(18),
    )
    db.session.add(payment)
    return payment, checkout


def mark_paid(payment, now=None):
    """Activate the paid plan. Renewing the same plan and period carries on from the end of the
    current one (even a few days late, within the grace days); a different plan or billing period
    starts today."""
    now = now or utcnow()
    subscription = subscription_for(payment.company_id)
    if not subscription:
        subscription = Subscription(company_id=payment.company_id)
        db.session.add(subscription)
    end = subscription.current_period_end
    carries_on = (
        subscription.status == "active"
        and subscription.plan == payment.plan
        and subscription.interval == payment.interval
        and end is not None
        and now < end + timedelta(days=GRACE_DAYS)
    )
    start = end if carries_on else now
    subscription.plan, subscription.interval, subscription.status = payment.plan, payment.interval, "active"
    subscription.extra_mechanics = payment.extra_mechanics
    subscription.current_period_end = add_period(start, payment.interval)
    subscription.auto_renew, subscription.past_due_since, subscription.reminded_at = True, None, None
    payment.status, payment.paid_at = "paid", now
    audit.record("plan_paid", company_id=payment.company_id, detail=f"{PLANS[payment.plan]['name']} / {payment.interval}")
    return subscription


def apply_event(event, provider_name, now=None):
    """Act on what a provider reported, once. Returns the Payment or Subscription it changed."""
    now = now or utcnow()
    payment = Payment.query.filter_by(reference=event.reference, provider=provider_name).first() if event.reference else None
    company_id = payment.company_id if payment else event.company_id
    if event.event_id:
        if BillingEvent.query.filter_by(provider=provider_name, event_id=event.event_id).first():
            return None
        db.session.add(BillingEvent(provider=provider_name, event_id=event.event_id, kind=event.kind, reference=event.reference, company_id=company_id))

    if event.kind in ("paid", "failed"):
        if not payment:
            current_app.logger.warning("%s reported %s for an unknown payment %s", provider_name, event.kind, event.reference)
            return None
        if payment.status != "pending":
            return payment
        if event.kind == "paid":
            if (event.amount_cents is not None and event.amount_cents != payment.amount_cents) or (event.currency and event.currency != payment.currency):
                # Never activate a plan for less than its price.
                current_app.logger.error("Payment %s: paid %s %s, expected %s %s", payment.reference, event.amount_cents, event.currency, payment.amount_cents, payment.currency)
                return payment
            subscription = mark_paid(payment, now)
            if event.token:
                subscription.payment_token, subscription.payment_method = event.token, event.method
            send_receipt(payment, subscription)
            return payment
        payment.status, payment.failed_at = "failed", now
        payment.failure_reason = (event.reason or "")[:255] or None
        if payment.kind == "renewal":
            subscription = subscription_for(payment.company_id)
            if subscription and not subscription.past_due_since:
                subscription.past_due_since = now
            tell_renewal_failed(payment, subscription)
        return payment

    subscription = subscription_for(company_id) if company_id else None
    if not subscription:
        return None
    if event.kind == "cancelled":
        subscription.auto_renew = False
        audit.record("plan_cancelled", company_id=company_id, detail=provider_name)
    elif event.kind == "plan_changed" and event.plan in PLANS:
        subscription.plan = event.plan
        if event.interval:
            subscription.interval = event.interval
        audit.record("plan_changed", company_id=company_id, detail=PLANS[event.plan]["name"])
    return subscription


# ---------- Renewals and reminders (the daily run) ----------


def renew_due(now=None):
    """Charge saved cards for paid periods ending within a day, retry declined ones daily (up to
    RENEWAL_ATTEMPTS), and remind managers when a trial or an unrenewable plan is ending."""
    now = now or utcnow()
    checkout = provider()
    counts = {"charged": 0, "failed": 0, "reminded": 0}
    due = Subscription.query.filter(
        Subscription.status == "active",
        Subscription.auto_renew.is_(True),
        Subscription.current_period_end.isnot(None),
        Subscription.current_period_end <= now + timedelta(days=1),
        Subscription.current_period_end > now - timedelta(days=GRACE_DAYS),
    ).all()
    for subscription in due:
        company = db.session.get(Company, subscription.company_id)
        if not company or company.is_demo:
            continue
        window_start = subscription.current_period_end - timedelta(days=1)
        tries = Payment.query.filter(Payment.company_id == company.id, Payment.kind == "renewal", Payment.created_at >= window_start)
        if tries.filter(Payment.created_at > now - timedelta(hours=20)).first() or tries.filter(Payment.status == "failed").count() >= RENEWAL_ATTEMPTS:
            continue
        boss = User.query.filter_by(company_id=company.id, role="boss").order_by(User.id).first()
        if checkout and subscription.payment_token and boss:
            payment, _provider = create_payment(boss, subscription.plan, subscription.interval, subscription.extra_mechanics, kind="renewal")
            db.session.flush()
            event = checkout.charge_saved(payment, subscription, boss.email)
            if event:
                apply_event(event, checkout.name, now)
                counts["charged" if event.kind == "paid" else "failed"] += 1
        elif not subscription.past_due_since:
            # Nothing to charge: the manager pays under Billing.
            subscription.past_due_since = now
            tell_renewal_due(subscription)
            counts["reminded"] += 1
        db.session.commit()

    ending = Subscription.query.filter(
        Subscription.reminded_at.is_(None),
        db.or_(
            db.and_(Subscription.status == "trialing", Subscription.trial_ends_at > now, Subscription.trial_ends_at <= now + timedelta(days=REMIND_DAYS)),
            db.and_(
                Subscription.status == "active",
                Subscription.auto_renew.is_(False),
                Subscription.current_period_end > now,
                Subscription.current_period_end <= now + timedelta(days=REMIND_DAYS),
            ),
        ),
    ).all()
    for subscription in ending:
        company = db.session.get(Company, subscription.company_id)
        if company and not company.is_demo:
            tell_plan_ending(subscription)
            counts["reminded"] += 1
        subscription.reminded_at = now
    db.session.commit()
    return counts


# ---------- Telling the managers ----------


def _money(cents, currency):
    whole = cents / 100
    text = f"{whole:,.0f}" if cents % 100 == 0 else f"{whole:,.2f}"
    return f"KSh {text}" if currency == "KES" else f"{currency} {text}"


def _tell_bosses(company_id, title, message, email=None, when=None, **values):
    """A notification to each manager in their own language and, with `email` (subject, heading,
    paragraphs), an email too. Texts are N_() templates; `when` is written as {date} on the
    company's calendar."""
    from app.services.email import app_link, layout, send_email
    from app.services.notifications import notify

    company = db.session.get(Company, company_id)
    link = app_link("/billing")
    for boss in User.query.filter_by(company_id=company_id, role="boss").all():
        with speaking(boss.language):
            if when is not None:
                values["date"] = local_time(when, company.timezone, with_time=False)
            notify(boss.id, title, message, "billing", (), **values)
            if email:
                subject, heading, paragraphs = email
                lines = [_(paragraph, **values) for paragraph in paragraphs]
                button = _("Open Billing")
                send_email(
                    boss.email,
                    _(subject, **values),
                    "\n\n".join([*lines, f"{button}: {link}"]),
                    layout(_(heading, **values), lines, (button, link)),
                    company_id=company_id,
                )


def send_receipt(payment, subscription):
    _tell_bosses(
        payment.company_id,
        N_("Payment received"),
        N_("{amount} for the {plan} plan. Paid up to {date}."),
        (
            N_("Receipt: {amount} for MechanicPro {plan}"),
            N_("Payment received"),
            [N_("Thank you. We received {amount} for the {plan} plan."), N_("Your plan is paid up to {date}."), N_("Reference: {reference}")],
        ),
        when=subscription.current_period_end,
        plan=PLANS[payment.plan]["name"],
        amount=_money(payment.amount_cents, payment.currency),
        reference=payment.reference,
    )


def tell_renewal_failed(payment, subscription):
    _tell_bosses(
        payment.company_id,
        N_("Payment failed"),
        N_("Renewing the {plan} plan failed ({reason}). Pay under Billing by {date} to keep everything working."),
        (
            N_("Your MechanicPro payment failed"),
            N_("Payment failed"),
            [
                N_("We couldn't renew your {plan} plan: {reason}."),
                N_("Everything keeps working until {date}. After that, new jobs and invitations wait until the plan is paid. Nothing is deleted."),
            ],
        ),
        when=grace_ends(subscription) if subscription else None,
        plan=PLANS[payment.plan]["name"],
        reason=payment.failure_reason or "-",
        date="-",
    )


def tell_renewal_due(subscription):
    _tell_bosses(
        subscription.company_id,
        N_("Time to renew"),
        N_("Your {plan} plan is due for renewal. Pay under Billing by {date} to keep everything working."),
        (
            N_("Renew your MechanicPro plan"),
            N_("Time to renew"),
            [N_("Your {plan} plan is due for renewal."), N_("Pay under Billing by {date} to keep everything working. Nothing is deleted either way.")],
        ),
        when=grace_ends(subscription),
        plan=PLANS[subscription.plan]["name"],
    )


def tell_plan_ending(subscription):
    if subscription.status == "trialing":
        _tell_bosses(
            subscription.company_id,
            N_("Your free trial ends soon"),
            N_("Your free trial ends on {date}. Choose a plan under Billing to keep adding jobs."),
            (
                N_("Your MechanicPro trial ends on {date}"),
                N_("Your free trial ends soon"),
                [N_("Your free trial of the {plan} plan ends on {date}."), N_("Choose a plan to keep adding jobs and inviting people. Nothing is deleted when a trial ends.")],
            ),
            when=subscription.trial_ends_at,
            plan=PLANS[subscription.plan]["name"],
        )
    else:
        _tell_bosses(
            subscription.company_id,
            N_("Your plan ends soon"),
            N_("Your {plan} plan ends on {date} and won't renew. Turn renewal back on under Billing to keep it."),
            when=subscription.current_period_end,
            plan=PLANS[subscription.plan]["name"],
        )


# ---------- Limits ----------


def require_active(company_id, action):
    """Once a trial or paid period (and its grace days) runs out, existing work carries on but
    nothing new is added. `action` is already translated, e.g. _("invite people")."""
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
    limit = mechanic_limit(subscription)
    if mechanic_count(company_id) >= limit:
        raise ValidationError(
            _(
                "Your {plan} plan includes up to {count} technicians, counting open invitations. "
                "Add extra technicians or choose a bigger plan under Billing to add more.",
                plan=PLANS[subscription.plan]["name"],
                count=limit,
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

