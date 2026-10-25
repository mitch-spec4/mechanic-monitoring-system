from datetime import datetime, timedelta

import pytest

from app import db
from app.models import Invitation, JobFile, Subscription, User
from app.services.plans import GB, add_period
from app.utils.time import utcnow

SIGNUP = {
    "company_name": "Rift Valley Power",
    "name": "Wanjiku Kamau",
    "email": "owner@riftpower.test",
    "password": "a-long-password",
    "plan": "professional",
    "accept_terms": True,
}


def boss(auth):
    return auth("boss@acme.test")


def give_plan(company_id, plan="starter", status="active", **dates):
    subscription = Subscription(company_id=company_id, plan=plan, interval="month", status=status, **dates)
    db.session.add(subscription)
    db.session.commit()
    return subscription


def test_pricing_is_public(client):
    data = client.get("/api/plans").get_json()
    assert [plan["key"] for plan in data["plans"]] == ["starter", "professional", "business"]
    professional = data["plans"][1]
    assert professional["prices"] == {"month": 450_000, "year": 4_500_000}
    assert professional["mechanics"] == 10 and professional["storage_gb"] == 20
    assert data["trial_days"] == 14 and data["currency"] == "KES" and data["payment_provider"] == "test"


def test_signup_starts_a_free_trial_and_signs_the_owner_in(client, auth, data):
    response = client.post("/api/signup", json=SIGNUP)
    assert response.status_code == 201
    assert response.get_json()["user"]["role"] == "boss" and "checkout_url" not in response.get_json()
    assert any(cookie.startswith("access_token_cookie=") for cookie in response.headers.getlist("Set-Cookie"))
    owner = User.query.filter_by(email="owner@riftpower.test").one()
    assert owner.company_id not in (data["acme"], data["other"])

    billing = client.get("/api/billing", headers=auth("owner@riftpower.test")).get_json()
    assert billing["subscription"]["state"] == "trialing" and billing["subscription"]["plan"] == "professional"
    assert billing["subscription"]["days_left"] == 14
    assert billing["usage"] == {"mechanics": 0, "mechanic_limit": 10, "storage_bytes": 0, "storage_limit_bytes": 20 * GB}
    assert billing["payments"] == []
    # The new company starts empty: nothing from other companies leaks in.
    assert client.get("/api/jobs", headers=auth("owner@riftpower.test")).get_json()["jobs"] == []


@pytest.mark.parametrize(
    "change, status",
    [
        ({"company_name": ""}, 400),
        ({"plan": "platinum"}, 400),
        ({"interval": "week"}, 400),
        ({"password": "short"}, 400),
        ({"email": "boss@acme.test"}, 409),
    ],
)
def test_signup_checks_its_input(client, data, change, status):
    assert client.post("/api/signup", json={**SIGNUP, **change}).status_code == status


def test_paying_now_goes_through_checkout(client, auth, data):
    response = client.post("/api/signup", json={**SIGNUP, "pay_now": True, "interval": "year"})
    url = response.get_json()["checkout_url"]
    assert url.startswith("#/checkout/pay_")
    reference = url.rsplit("/", 1)[1]
    owner = auth("owner@riftpower.test")

    detail = client.get(f"/api/billing/payments/{reference}", headers=owner).get_json()
    assert detail["payment"]["amount_cents"] == 4_500_000 and detail["payment"]["status"] == "pending"
    assert detail["company"] == "Rift Valley Power"

    # A declined card leaves the checkout open to try again.
    declined = client.post(f"/api/billing/test/{reference}/pay", headers=owner, json={"outcome": "declined"})
    assert declined.status_code == 402
    assert client.get(f"/api/billing/payments/{reference}", headers=owner).get_json()["payment"]["status"] == "pending"

    paid = client.post(f"/api/billing/test/{reference}/pay", headers=owner, json={})
    assert paid.status_code == 200
    subscription = paid.get_json()["subscription"]
    assert subscription["state"] == "active" and subscription["interval"] == "year"
    assert 364 <= subscription["days_left"] <= 366
    assert client.post(f"/api/billing/test/{reference}/pay", headers=owner, json={}).status_code == 409
    payments = client.get("/api/billing", headers=owner).get_json()["payments"]
    assert [(p["plan"], p["amount_cents"], p["status"]) for p in payments] == [("professional", 4_500_000, "paid")]


def test_renewing_adds_a_period_and_changing_plan_starts_today(client, auth, data):
    give_plan(data["acme"], "professional", trial_ends_at=None, current_period_end=utcnow() + timedelta(days=10))

    def pay(plan, interval="month"):
        url = client.post("/api/billing/checkout", headers=boss(auth), json={"plan": plan, "interval": interval}).get_json()["checkout_url"]
        return client.post(f"/api/billing/test/{url.rsplit('/', 1)[1]}/pay", headers=boss(auth), json={}).get_json()["subscription"]

    renewed = pay("professional")
    assert 38 <= renewed["days_left"] <= 42  # 10 days left plus one month
    changed = pay("business")
    assert changed["plan"] == "business" and 28 <= changed["days_left"] <= 31


def test_checkouts_belong_to_one_company(client, auth, data):
    url = client.post("/api/billing/checkout", headers=boss(auth), json={"plan": "starter"}).get_json()["checkout_url"]
    reference = url.rsplit("/", 1)[1]
    other = auth("boss@other.test")
    assert client.get(f"/api/billing/payments/{reference}", headers=other).status_code == 404
    assert client.post(f"/api/billing/test/{reference}/pay", headers=other, json={}).status_code == 404
    assert client.get("/api/billing", headers=auth("mech@acme.test")).status_code == 403
    assert client.post("/api/billing/checkout", headers=boss(auth), json={}).status_code == 400


def test_without_a_payment_provider_only_trials_start(tmp_path):
    from app import create_app

    app = create_app({"SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'none.db'}", "TESTING": True, "BILLING_PROVIDER": "none", "RATELIMIT_ENABLED": False})
    with app.app_context():
        db.create_all()
        client = app.test_client()
        assert client.get("/api/plans").get_json()["payment_provider"] is None
        assert client.post("/api/signup", json={**SIGNUP, "pay_now": True}).status_code == 409
        assert client.post("/api/signup", json=SIGNUP).status_code == 201
        db.session.remove()


def test_test_payments_are_refused_in_production():
    from types import SimpleNamespace

    from app.services.billing import init_billing

    with pytest.raises(RuntimeError, match="development"):
        init_billing(SimpleNamespace(config={"BILLING_PROVIDER": "test", "IS_PRODUCTION": True}, extensions={}))
    with pytest.raises(RuntimeError, match="BILLING_PROVIDER"):
        init_billing(SimpleNamespace(config={"BILLING_PROVIDER": "paypal", "IS_PRODUCTION": False}, extensions={}))


def test_mechanic_limit_counts_open_invitations(client, auth, data):
    give_plan(data["acme"], "starter")  # 3 mechanics; Acme has 2
    invite = lambda email, role="mechanic": client.post("/api/customers/invite", headers=boss(auth), json={"name": "New", "email": email, "role": role})
    assert invite("third@acme.test").status_code == 201
    refused = invite("fourth@acme.test")
    assert refused.status_code == 409 and "up to 3 technicians" in refused.get_json()["error"]
    # Customers aren't limited, and an expired invitation frees its place.
    assert invite("buyer@acme.test", "customer").status_code == 201
    Invitation.query.filter_by(email="third@acme.test").one().expires_at = utcnow() - timedelta(days=1)
    db.session.commit()
    assert invite("fourth@acme.test").status_code == 201


def test_storage_limit_applies_to_uploads(client, auth, data):
    give_plan(data["acme"], "starter")  # 2 GB
    db.session.add(JobFile(company_id=data["acme"], job_id=data["job"], uploaded_by=data["mechanic"], kind="before", content_type="image/jpeg",
                           size_bytes=2 * GB - 500, storage_key="1/jobs/1/full.jpg", status="ready"))
    db.session.commit()
    mech = auth("mech@acme.test")
    assert client.patch(f"/api/jobs/{data['job']}", headers=mech, json={"status": "In Progress"}).status_code == 200
    response = client.post(f"/api/jobs/{data['job']}/files", headers=mech, json={"kind": "before", "content_type": "image/jpeg", "size": 1000})
    assert response.status_code == 413 and "2 GB" in response.get_json()["error"]
    assert client.post(f"/api/jobs/{data['job']}/files", headers=mech, json={"kind": "before", "content_type": "image/jpeg", "size": 400}).status_code == 201


def test_an_ended_trial_stops_new_work_until_a_plan_is_paid(client, auth, data):
    give_plan(data["acme"], "professional", status="trialing", trial_ends_at=utcnow() - timedelta(hours=1))
    job = {"title": "New job", "description": "Check the pump"}
    refused = client.post("/api/jobs", headers=boss(auth), json=job)
    assert refused.status_code == 402 and "free trial has ended" in refused.get_json()["error"]
    assert client.post("/api/customers/invite", headers=boss(auth), json={"name": "N", "email": "n@acme.test", "role": "customer"}).status_code == 402
    # Work already under way carries on.
    assert client.patch(f"/api/jobs/{data['job']}", headers=auth("mech@acme.test"), json={"status": "In Progress"}).status_code == 200
    billing = client.get("/api/billing", headers=boss(auth)).get_json()
    assert billing["subscription"]["state"] == "expired" and billing["subscription"]["days_left"] is None

    url = client.post("/api/billing/checkout", headers=boss(auth), json={"plan": "professional"}).get_json()["checkout_url"]
    client.post(f"/api/billing/test/{url.rsplit('/', 1)[1]}/pay", headers=boss(auth), json={})
    assert client.post("/api/jobs", headers=boss(auth), json=job).status_code == 201


def test_two_signups_with_one_email_at_once_give_a_clear_answer(client, monkeypatch):
    """The second signup passes the email check before the first is saved; the database refuses it."""
    import app.routes.billing as billing_routes

    assert client.post("/api/signup", json={**SIGNUP, "email": "same@riftpower.test"}).status_code == 201
    monkeypatch.setattr(billing_routes, "email_in_use", lambda email: False)
    raced = client.post("/api/signup", json={**SIGNUP, "email": "same@riftpower.test"})
    assert raced.status_code == 409 and "already exists" in raced.get_json()["error"]


def test_signups_are_rate_limited(client, app):
    app.config.update(RATELIMIT_ENABLED=True, LOGIN_RATE_LIMIT="2 per minute")
    for number in range(2):
        assert client.post("/api/signup", json={**SIGNUP, "email": f"owner{number}@riftpower.test"}).status_code == 201
    assert client.post("/api/signup", json={**SIGNUP, "email": "owner9@riftpower.test"}).status_code == 429


def test_periods_follow_the_calendar():
    assert add_period(datetime(2026, 1, 31, 9), "month") == datetime(2026, 2, 28, 9)
    assert add_period(datetime(2028, 2, 29), "year") == datetime(2029, 2, 28)
    assert add_period(datetime(2026, 12, 15), "month") == datetime(2027, 1, 15)


# ---------- Features, extra technicians, renewals, webhooks and providers ----------


@pytest.fixture
def outbox(app):
    box = app.extensions["email"].outbox
    box.clear()
    return box


def pay_with(client, auth, plan="starter", interval="month", extra=0, outcome="success"):
    response = client.post("/api/billing/checkout", headers=boss(auth), json={"plan": plan, "interval": interval, "extra_mechanics": extra})
    assert response.status_code == 201, response.get_json()
    reference = response.get_json()["checkout_url"].rsplit("/", 1)[1]
    paid = client.post(f"/api/billing/test/{reference}/pay", headers=boss(auth), json={"outcome": outcome})
    assert paid.status_code == 200, paid.get_json()
    return paid.get_json()


def test_plans_list_their_features_and_extra_technicians(client):
    data = client.get("/api/plans").get_json()
    assert {plan["key"]: plan["features"] for plan in data["plans"]} == {
        "starter": [],
        "professional": ["insights", "maintenance", "forms"],
        "business": ["insights", "maintenance", "forms", "routes", "costing"],
    }
    assert data["extra_mechanic_cents"] == 50_000 and data["max_extra_mechanics"] == 100


def test_features_follow_the_plan(client, auth, data):
    # Companies from before plans have everything.
    me = client.get("/api/users/me", headers=boss(auth)).get_json()["user"]
    assert me["features"] == ["insights", "maintenance", "forms", "routes", "costing"] and me["subscription"] is None
    subscription = give_plan(data["acme"], "starter")
    mech = client.get("/api/users/me", headers=auth("mech@acme.test")).get_json()["user"]
    assert mech["features"] == [] and mech["subscription"] is None

    refused = client.get("/api/insights", headers=boss(auth))
    assert refused.status_code == 403 and "Insights and exports is on the Professional plan" in refused.get_json()["error"]
    assert client.get("/api/insights/export.xlsx", headers=boss(auth)).status_code == 403
    routes = client.get(f"/api/routes?mechanic_id={data['mechanic']}", headers=boss(auth))
    assert routes.status_code == 403 and "Route planning is on the Business plan" in routes.get_json()["error"]
    assert client.get("/api/routes/mine", headers=auth("mech@acme.test")).status_code == 403
    assert "costing" not in client.get(f"/api/jobs/{data['job']}", headers=boss(auth)).get_json()["job"]
    assert client.patch(f"/api/jobs/{data['job']}/costing", headers=boss(auth), json={"charged": "100"}).status_code == 403
    assert client.patch(f"/api/users/{data['mechanic']}", headers=boss(auth), json={"pay_rate": "500"}).status_code == 403
    plan = {"title": "Oil change", "every": 3, "unit": "months", "next_due": "2026-12-01"}
    assert client.post(f"/api/machines/{data['machine']}/plans", headers=boss(auth), json=plan).status_code == 403

    subscription.plan = "professional"
    db.session.commit()
    insights = client.get("/api/insights", headers=boss(auth))
    assert insights.status_code == 200 and insights.get_json()["insights"]["money"] is None
    assert client.post(f"/api/machines/{data['machine']}/plans", headers=boss(auth), json=plan).status_code == 201
    assert client.get(f"/api/routes?mechanic_id={data['mechanic']}", headers=boss(auth)).status_code == 403

    subscription.plan = "business"
    db.session.commit()
    assert client.get("/api/insights", headers=boss(auth)).get_json()["insights"]["money"]["currency"] == "KES"
    assert client.get(f"/api/routes?mechanic_id={data['mechanic']}", headers=boss(auth)).status_code == 200
    assert "costing" in client.get(f"/api/jobs/{data['job']}", headers=boss(auth)).get_json()["job"]
    assert client.patch(f"/api/users/{data['mechanic']}", headers=boss(auth), json={"pay_rate": "500"}).status_code == 200


def test_planned_maintenance_waits_on_plans_without_it(app, client, auth, data):
    from app.models import MaintenancePlan
    from app.services.equipment import send_due_reminders

    give_plan(data["acme"], "starter")
    db.session.add(MaintenancePlan(company_id=data["acme"], machine_id=data["machine"], title="Oil change", every=3, unit="months", next_due=utcnow().date()))
    db.session.commit()
    assert send_due_reminders()["maintenance_jobs"] == 0
    Subscription.query.filter_by(company_id=data["acme"]).one().plan = "professional"
    db.session.commit()
    assert send_due_reminders()["maintenance_jobs"] == 1


def test_extra_technicians_raise_the_limit_and_the_price(client, auth, data):
    give_plan(data["acme"], "starter", current_period_end=utcnow() + timedelta(days=3))
    for extra in (-1, 101, "two"):
        assert client.post("/api/billing/checkout", headers=boss(auth), json={"plan": "starter", "extra_mechanics": extra}).status_code == 400
    yearly = client.post("/api/billing/checkout", headers=boss(auth), json={"plan": "starter", "interval": "year", "extra_mechanics": 2})
    assert yearly.get_json()["payment"]["amount_cents"] == (150_000 + 2 * 50_000) * 10
    paid = pay_with(client, auth, "starter", extra=2)
    assert paid["payment"]["amount_cents"] == 250_000 and paid["subscription"]["extra_mechanics"] == 2
    billing = client.get("/api/billing", headers=boss(auth)).get_json()
    assert billing["usage"]["mechanic_limit"] == 5
    for number in range(3):
        assert client.post("/api/customers/invite", headers=boss(auth), json={"name": "N", "email": f"t{number}@acme.test", "role": "mechanic"}).status_code == 201
    refused = client.post("/api/customers/invite", headers=boss(auth), json={"name": "N", "email": "t9@acme.test", "role": "mechanic"})
    assert refused.status_code == 409 and "up to 5 technicians" in refused.get_json()["error"]


def test_a_smaller_plan_must_hold_the_team(client, auth, data):
    give_plan(data["acme"], "professional")
    for number in range(2):
        client.post("/api/customers/invite", headers=boss(auth), json={"name": "N", "email": f"t{number}@acme.test", "role": "mechanic"})
    refused = client.post("/api/billing/checkout", headers=boss(auth), json={"plan": "starter"})
    assert refused.status_code == 409 and "4 technicians" in refused.get_json()["error"]
    assert client.post("/api/billing/checkout", headers=boss(auth), json={"plan": "starter", "extra_mechanics": 1}).status_code == 201


def test_cancelling_ends_the_plan_with_its_period(client, auth, data):
    pay_with(client, auth, "professional")
    assert client.post("/api/billing/renewal", headers=auth("mech@acme.test"), json={"auto_renew": False}).status_code == 403
    assert client.post("/api/billing/renewal", headers=boss(auth), json={"auto_renew": "no"}).status_code == 400
    cancelled = client.post("/api/billing/renewal", headers=boss(auth), json={"auto_renew": False}).get_json()["subscription"]
    assert cancelled["auto_renew"] is False and cancelled["state"] == "active"
    resumed = client.post("/api/billing/renewal", headers=boss(auth), json={"auto_renew": True}).get_json()["subscription"]
    assert resumed["auto_renew"] is True
    client.post("/api/billing/renewal", headers=boss(auth), json={"auto_renew": False})
    # Cancelled plans get no grace days: past the end, new work waits.
    subscription = Subscription.query.filter_by(company_id=data["acme"]).one()
    subscription.current_period_end = utcnow() - timedelta(hours=1)
    db.session.commit()
    assert client.get("/api/billing", headers=boss(auth)).get_json()["subscription"]["state"] == "expired"
    assert client.post("/api/jobs", headers=boss(auth), json={"title": "New", "description": "d"}).status_code == 402
    assert client.post("/api/billing/renewal", headers=boss(auth), json={"auto_renew": True}).status_code == 409


def test_renewals_charge_the_saved_card(client, auth, data, outbox):
    from app.models import Notification
    from app.services.billing import renew_due

    pay_with(client, auth, "professional")
    outbox.clear()
    subscription = Subscription.query.filter_by(company_id=data["acme"]).one()
    assert subscription.payment_method == "Test card •••• 4242"
    old_end = utcnow() + timedelta(hours=12)
    subscription.current_period_end = old_end
    db.session.commit()

    assert renew_due() == {"charged": 1, "failed": 0, "reminded": 0}
    db.session.refresh(subscription)
    assert subscription.current_period_end == add_period(old_end, "month") and subscription.past_due_since is None
    # A receipt to each manager, and a notification.
    assert sorted(message["To"] for message in outbox) == ["boss2@acme.test", "boss@acme.test"]
    assert outbox[0]["Subject"] == "Receipt: KSh 4,500 for MechanicPro Professional"
    assert Notification.query.filter_by(user_id=data["boss"], title="Payment received").count() == 2  # the checkout and the renewal
    # Paid up: nothing more to do.
    assert renew_due() == {"charged": 0, "failed": 0, "reminded": 0}
    payments = client.get("/api/billing", headers=boss(auth)).get_json()["payments"]
    assert [(p["kind"], p["status"]) for p in payments] == [("renewal", "paid"), ("checkout", "paid")]


def test_a_declined_renewal_gives_grace_days_then_limits(client, auth, data, outbox):
    from app.services.billing import RENEWAL_ATTEMPTS, renew_due

    pay_with(client, auth, "professional", outcome="declines_later")
    outbox.clear()
    subscription = Subscription.query.filter_by(company_id=data["acme"]).one()
    end = utcnow() + timedelta(hours=12)
    subscription.current_period_end = end
    db.session.commit()

    assert renew_due() == {"charged": 0, "failed": 1, "reminded": 0}
    assert outbox[0]["Subject"] == "Your MechanicPro payment failed"
    body = outbox[0].get_body(("plain",)).get_content()
    assert "Declined (test card)" in body and "Nothing is deleted" in body
    plan = client.get("/api/billing", headers=boss(auth)).get_json()["subscription"]
    assert plan["state"] == "active" and plan["payment_problem"] is True and plan["grace_ends_at"]
    # Tried once a day, up to RENEWAL_ATTEMPTS times.
    assert renew_due() == {"charged": 0, "failed": 0, "reminded": 0}
    for day in range(1, RENEWAL_ATTEMPTS + 2):
        renew_due(utcnow() + timedelta(days=day))
    failed = [p for p in client.get("/api/billing", headers=boss(auth)).get_json()["payments"] if p["status"] == "failed"]
    assert len(failed) == RENEWAL_ATTEMPTS and failed[0]["failure_reason"] == "Declined (test card)"

    # Past the end, within the grace days: everything still works.
    subscription.current_period_end = utcnow() - timedelta(days=2)
    db.session.commit()
    assert client.get("/api/billing", headers=boss(auth)).get_json()["subscription"]["state"] == "past_due"
    assert client.post("/api/jobs", headers=boss(auth), json={"title": "New", "description": "d"}).status_code == 201
    # After them, new work waits until the plan is paid; work under way carries on.
    subscription.current_period_end = utcnow() - timedelta(days=8)
    db.session.commit()
    assert client.get("/api/billing", headers=boss(auth)).get_json()["subscription"]["state"] == "expired"
    refused = client.post("/api/jobs", headers=boss(auth), json={"title": "New", "description": "d"})
    assert refused.status_code == 402 and "plan has run out" in refused.get_json()["error"]
    assert client.patch(f"/api/jobs/{data['job']}", headers=auth("mech@acme.test"), json={"status": "In Progress"}).status_code == 200
    paid = pay_with(client, auth, "professional")["subscription"]
    assert paid["state"] == "active" and paid["payment_problem"] is False
    assert client.post("/api/jobs", headers=boss(auth), json={"title": "New", "description": "d"}).status_code == 201


def test_reminders_go_once(client, auth, data, outbox):
    from app.services.billing import renew_due

    # A trial ending in two days.
    give_plan(data["acme"], "professional", status="trialing", trial_ends_at=utcnow() + timedelta(days=2))
    assert renew_due()["reminded"] == 1
    assert outbox[0]["Subject"].startswith("Your MechanicPro trial ends on ")
    assert renew_due()["reminded"] == 0

    # A paid plan with no saved card to charge: pay under Billing, once.
    subscription = Subscription.query.filter_by(company_id=data["acme"]).one()
    subscription.status, subscription.trial_ends_at, subscription.current_period_end = "active", None, utcnow() + timedelta(hours=6)
    db.session.commit()
    outbox.clear()
    assert renew_due()["reminded"] == 1
    assert outbox[0]["Subject"] == "Renew your MechanicPro plan"
    assert renew_due()["reminded"] == 0
    assert client.get("/api/billing", headers=boss(auth)).get_json()["subscription"]["payment_problem"] is True


def test_demo_companies_are_never_charged(client, data):
    from app.models import Company
    from app.services.billing import renew_due

    db.session.get(Company, data["acme"]).demo_expires_at = utcnow() + timedelta(hours=5)
    give_plan(data["acme"], "business", current_period_end=utcnow() + timedelta(hours=2), payment_token="test_card_4242")
    assert renew_due() == {"charged": 0, "failed": 0, "reminded": 0}


def signed(app, payload):
    import json

    body = json.dumps(payload).encode()
    from app.services.billing import TestProvider

    with app.app_context():
        return body, {"X-Test-Signature": TestProvider().signature(body), "Content-Type": "application/json"}


def test_webhooks_are_signed_and_count_once(app, client, auth, data):
    give_plan(data["acme"], "starter", status="trialing", trial_ends_at=utcnow() + timedelta(days=5))
    reference = client.post("/api/billing/checkout", headers=boss(auth), json={"plan": "professional"}).get_json()["payment"]["reference"]
    event = {"kind": "paid", "reference": reference, "event_id": "evt_1", "amount_cents": 450_000, "currency": "KES", "token": "tok_1", "method": "Visa •••• 4081"}
    body, headers = signed(app, event)
    assert client.post("/api/billing/webhooks/test", data=body, headers={**headers, "X-Test-Signature": "forged"}).status_code == 401
    assert client.post("/api/billing/webhooks/paystack", data=body, headers=headers).status_code == 404
    assert client.post("/api/billing/webhooks/test", data=body, headers=headers).status_code == 200
    first = client.get("/api/billing", headers=boss(auth)).get_json()["subscription"]
    assert first["plan"] == "professional" and first["state"] == "active" and first["payment_method"] == "Visa •••• 4081"
    # Resent: no second month.
    assert client.post("/api/billing/webhooks/test", data=body, headers=headers).status_code == 200
    assert client.get("/api/billing", headers=boss(auth)).get_json()["subscription"]["current_period_end"] == first["current_period_end"]

    # Paid too little: never activates a plan.
    business = client.post("/api/billing/checkout", headers=boss(auth), json={"plan": "business"}).get_json()["payment"]["reference"]
    client.post("/api/billing/webhooks/test", data=signed(app, {**event, "reference": business, "event_id": "evt_2"})[0], headers=signed(app, {**event, "reference": business, "event_id": "evt_2"})[1])
    assert client.get(f"/api/billing/payments/{business}", headers=boss(auth)).get_json()["payment"]["status"] == "pending"

    for payload, check in (
        ({"kind": "cancelled", "company_id": data["acme"], "event_id": "evt_3"}, lambda s: s.auto_renew is False),
        ({"kind": "plan_changed", "company_id": data["acme"], "plan": "business", "interval": "year", "event_id": "evt_4"}, lambda s: (s.plan, s.interval) == ("business", "year")),
    ):
        body, headers = signed(app, payload)
        assert client.post("/api/billing/webhooks/test", data=body, headers=headers).status_code == 200
        subscription = Subscription.query.filter_by(company_id=data["acme"]).one()
        db.session.refresh(subscription)
        assert check(subscription)


def test_paystack_checkout_webhooks_and_renewals(app, client, auth, data, monkeypatch):
    import hashlib
    import hmac
    import json
    from types import SimpleNamespace

    from app.services.billing import PaystackProvider, init_billing, renew_due

    with pytest.raises(RuntimeError, match="test key"):
        init_billing(SimpleNamespace(config={"BILLING_PROVIDER": "paystack", "PAYSTACK_SECRET_KEY": "sk_live_abc", "IS_PRODUCTION": True}, extensions={}))
    paystack = PaystackProvider("sk_test_secret")
    calls = []
    answers = {}

    def fake_call(method, path, body=None):
        calls.append((method, path, body))
        return answers[path.split("/")[2] if path.startswith("/transaction/verify") else path]

    monkeypatch.setattr(paystack, "call", fake_call)
    monkeypatch.setitem(app.extensions, "billing", paystack)
    give_plan(data["acme"], "starter", status="trialing", trial_ends_at=utcnow() + timedelta(days=5))

    answers["/transaction/initialize"] = {"status": True, "data": {"authorization_url": "https://checkout.paystack.com/abc123"}}
    started = client.post("/api/billing/checkout", headers=boss(auth), json={"plan": "business", "interval": "month"}).get_json()
    assert started["checkout_url"] == "https://checkout.paystack.com/abc123"
    reference = started["payment"]["reference"]
    method, path, body = calls[-1]
    assert (method, path) == ("POST", "/transaction/initialize")
    assert body["amount"] == 1_200_000 and body["currency"] == "KES" and body["reference"] == reference and body["email"] == "boss@acme.test"
    assert body["callback_url"].endswith(f"/#/billing?paid={reference}")

    # Back from the checkout before the webhook: still pending at Paystack.
    answers["verify"] = {"status": True, "data": {"status": "ongoing", "reference": reference}}
    assert client.post(f"/api/billing/payments/{reference}/confirm", headers=boss(auth)).get_json()["payment"]["status"] == "pending"

    charge = {
        "event": "charge.success",
        "data": {
            "id": 991, "reference": reference, "status": "success", "amount": 1_200_000, "currency": "KES", "channel": "card",
            "authorization": {"authorization_code": "AUTH_abc", "reusable": True, "card_type": "visa ", "last4": "4081", "channel": "card"},
        },
    }
    raw = json.dumps(charge).encode()
    signature = hmac.new(b"sk_test_secret", raw, hashlib.sha512).hexdigest()
    assert client.post("/api/billing/webhooks/paystack", data=raw, headers={"X-Paystack-Signature": "0" * 128}).status_code == 401
    assert client.post("/api/billing/webhooks/paystack", data=raw, headers={"X-Paystack-Signature": signature}).status_code == 200
    plan = client.get("/api/billing", headers=boss(auth)).get_json()["subscription"]
    assert plan["plan"] == "business" and plan["state"] == "active" and plan["payment_method"] == "Visa •••• 4081"
    assert Subscription.query.filter_by(company_id=data["acme"]).one().payment_token == "AUTH_abc"

    # Renewal: the saved authorization is charged; a decline is reported in Paystack's words.
    subscription = Subscription.query.filter_by(company_id=data["acme"]).one()
    subscription.current_period_end = utcnow() + timedelta(hours=3)
    db.session.commit()
    answers["/transaction/charge_authorization"] = {"status": True, "data": {"status": "failed", "gateway_response": "Insufficient Funds", "amount": 1_200_000, "currency": "KES"}}
    assert renew_due() == {"charged": 0, "failed": 1, "reminded": 0}
    method, path, body = calls[-1]
    assert path == "/transaction/charge_authorization" and body["authorization_code"] == "AUTH_abc" and body["amount"] == 1_200_000
    failed = client.get("/api/billing", headers=boss(auth)).get_json()["payments"][0]
    assert failed["kind"] == "renewal" and failed["failure_reason"] == "Insufficient Funds"
