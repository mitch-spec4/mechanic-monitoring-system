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
    assert refused.status_code == 409 and "up to 3 mechanics" in refused.get_json()["error"]
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
