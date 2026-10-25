""""Try the demo" copies, clearing them away, the daily clean-up URL and the setup guide."""
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app import db
from app.models import Company, JobFile, User
from app.services import demo
from app.utils.time import utcnow
from tests.conftest import cookie, login


@pytest.fixture
def outbox(app):
    box = app.extensions["email"].outbox
    box.clear()
    return box


def start(client, role="boss"):
    response = client.post("/api/demo", json={"role": role})
    assert response.status_code == 201, response.get_json()
    return response.get_json()["user"]


def csrf(client):
    return {"X-CSRF-TOKEN": cookie(client, "csrf_access_token")}


def row_counts():
    return {table.name: db.session.execute(select(func.count()).select_from(table)).scalar() for table in db.metadata.sorted_tables}


def test_each_visitor_gets_a_private_copy_of_the_demo_company(app, data):
    first, second = app.test_client(), app.test_client()
    boss = start(first)
    other = start(second)
    assert boss["role"] == "boss" and boss["name"] == "James Mwangi" and boss["email_verified"] is True
    assert boss["demo_until"] and boss["company_id"] != other["company_id"]
    company = db.session.get(Company, boss["company_id"])
    assert company.is_demo and company.demo_expires_at - utcnow() > timedelta(hours=23)

    jobs = first.get("/api/jobs").get_json()["jobs"]
    assert len(jobs) == 8 and {job["status"] for job in jobs} >= {"In Progress", "Completed", "Paused", "Pending"}
    assert len(first.get("/api/customers").get_json()["customers"]) == 3
    # Equipment has its sites and types, two maintenance plans, and the mixer a repeat fault.
    assert len(first.get("/api/sites").get_json()["sites"]) == 4
    machines = {row["name"]: row for row in first.get("/api/machines").get_json()["machines"]}
    assert machines["Generator G-102"]["equipment_type"] == "Generator" and machines["Generator G-102"]["site_id"]
    assert {name for name, row in machines.items() if row["repeat_faults"] >= 2} == {"Industrial Mixer MX-08"}
    generator = first.get(f"/api/machines/{machines['Generator G-102']['id']}").get_json()["machine"]
    assert [(plan["title"], plan["state"]) for plan in generator["plans"]] == [("Oil and filter change", "due")]
    # A change in one copy never shows up in another, or in a real company.
    first.delete(f"/api/jobs/{next(job['id'] for job in jobs if job['status'] == 'Pending')}", headers=csrf(first))
    assert len(first.get("/api/jobs").get_json()["jobs"]) == 7
    assert len(second.get("/api/jobs").get_json()["jobs"]) == 8
    assert db.session.get(Company, data["acme"]).demo_expires_at is None


def test_the_demo_opens_as_any_role_and_can_switch(client, data):
    mechanic = start(client, "mechanic")
    assert mechanic["role"] == "mechanic" and mechanic["name"] == "Mitch Kamau"
    assert {job["title"] for job in client.get("/api/jobs").get_json()["jobs"]} == {"Service Generator G-102", "Compressor C-55 maintenance"}

    customer = client.post("/api/demo/switch", headers=csrf(client), json={"role": "customer"})
    assert customer.status_code == 200 and customer.get_json()["user"]["name"] == "ABC Engineering"
    assert customer.get_json()["user"]["company_id"] == mechanic["company_id"]
    boss = client.post("/api/demo/switch", headers=csrf(client), json={"role": "boss"}).get_json()["user"]
    assert boss["role"] == "boss" and boss["company_id"] == mechanic["company_id"]
    assert client.post("/api/demo/switch", headers=csrf(client), json={"role": "admin"}).status_code == 400


def test_another_site_cannot_start_a_demo_with_a_plain_form(client, data):
    response = client.post("/api/demo", data={"role": "boss"})
    assert response.status_code == 415
    assert not any(header.startswith("access_token_cookie=") for header in response.headers.getlist("Set-Cookie"))
    assert Company.query.filter(Company.demo_expires_at.isnot(None)).count() == 0


def test_switching_only_works_inside_a_demo(client, data, auth):
    response = client.post("/api/demo/switch", headers=auth("boss@acme.test"), json={"role": "customer"})
    assert response.status_code == 403


def test_demo_accounts_cannot_be_signed_into_with_a_password(client, data):
    email = start(client)["email"]
    for password in ("password", "", "!demo"):
        assert login(client, email, password).status_code == 401


def test_demo_companies_never_send_email(client, outbox):
    start(client)
    response = client.post("/api/customers/invite", headers=csrf(client), json={"name": "Stranger", "email": "stranger@example.org"})
    assert response.status_code == 201 and response.get_json()["emailed"] is False
    client.post("/api/auth/forgot-password", json={"email": client.get("/api/users/me").get_json()["user"]["email"]})
    assert list(outbox) == []


def test_demo_companies_cannot_start_real_payments(app, client):
    class RealProvider:
        name = "paystack"

        def checkout_url(self, payment):
            return "https://checkout.example.com/" + payment.reference

    start(client)
    app.extensions["billing"] = RealProvider()
    response = client.post("/api/billing/checkout", headers=csrf(client), json={"plan": "starter", "interval": "month"})
    assert response.status_code == 403 and "demo company" in response.get_json()["error"]


def test_expired_copies_are_deleted_with_every_row_and_file(app, client, data):
    before = row_counts()
    boss = start(client)
    signatures = JobFile.query.filter_by(company_id=boss["company_id"], kind="signature").all()
    stored = [Path(app.config["STORAGE_LOCAL_DIR"]) / signature.storage_key for signature in signatures]
    assert len(stored) == 2 and all(path.exists() for path in stored)

    assert demo.purge_expired() == 0
    db.session.get(Company, boss["company_id"]).demo_expires_at = utcnow() - timedelta(minutes=1)
    db.session.commit()
    assert demo.purge_expired() == 1
    after = row_counts()
    after.pop("auth_attempt"), before.pop("auth_attempt")
    assert after == before
    assert not any(path.exists() for path in stored)


def test_an_expired_copy_ends_its_session(client, data):
    boss = start(client)
    db.session.get(Company, boss["company_id"]).demo_expires_at = utcnow() - timedelta(minutes=1)
    db.session.commit()
    response = client.post("/api/auth/refresh", headers={"X-CSRF-TOKEN": cookie(client, "csrf_refresh_token")})
    assert response.status_code == 401


def test_starting_a_demo_clears_expired_copies_and_respects_the_ceiling(app, data, monkeypatch):
    old = start(app.test_client())
    db.session.get(Company, old["company_id"]).demo_expires_at = utcnow() - timedelta(hours=1)
    db.session.commit()
    start(app.test_client())
    # (SQLite may hand the new copy the old one's id, so count rather than look the id up.)
    demos = Company.query.filter(Company.demo_expires_at.isnot(None))
    assert demos.count() == 1 and demos.one().demo_expires_at > utcnow()

    monkeypatch.setattr(demo, "MAX_LIVE_COPIES", 1)
    busy = app.test_client().post("/api/demo", json={"role": "boss"})
    assert busy.status_code == 503 and "busy" in busy.get_json()["error"]


def test_starting_demos_is_rate_limited_per_visitor(app, client, data):
    app.config.update(RATELIMIT_ENABLED=True, DEMO_RATE_LIMIT="2 per hour")
    assert client.post("/api/demo", json={}).status_code == 201
    assert client.post("/api/demo", json={}).status_code == 201
    assert client.post("/api/demo", json={}).status_code == 429


def test_the_local_seed_and_a_demo_copy_hold_the_same_data(app, data):
    company = Company(name="DK Engineering")
    db.session.add(company)
    db.session.flush()
    boss = demo.populate(company, password="password")
    db.session.commit()
    assert boss.email == "james@mechanicpro.test" and boss.check_password("password")
    assert User.query.filter_by(email="abc@example.com").one().role == "customer"
    copy = demo.start_copy()
    db.session.commit()
    for model in (User, JobFile):
        assert model.query.filter_by(company_id=company.id).count() == model.query.filter_by(company_id=copy.id).count()


def test_the_daily_url_needs_the_cron_secret(app, client, data):
    assert client.get("/api/cron/daily").status_code == 404
    app.config["CRON_SECRET"] = "s3cret-value"
    assert client.get("/api/cron/daily").status_code == 401
    assert client.get("/api/cron/daily", headers={"Authorization": "Bearer wrong"}).status_code == 401

    boss = start(app.test_client())
    db.session.get(Company, boss["company_id"]).demo_expires_at = utcnow() - timedelta(minutes=1)
    db.session.commit()
    response = client.get("/api/cron/daily", headers={"Authorization": "Bearer s3cret-value"})
    assert response.status_code == 200
    assert response.get_json()["removed"] == {
        "demo_companies": 1,
        "abandoned_uploads": 0,
        "old_live_locations": 0,
        "old_activity": 0,
        "old_offline_changes": 0,
        "deleted_companies": 0,
        "reminders": {"visit_reminders": 0, "repair_reminders": 0, "follow_ups": 0},
        "maintenance": {"maintenance_jobs": 0, "service_due_reminders": 0},
        "billing": {"charged": 0, "failed": 0, "reminded": 0},
    }


def test_the_setup_guide_follows_real_data(client, outbox):
    response = client.post(
        "/api/signup",
        json={"company_name": "Rift Valley Power", "name": "Wanjiku Kamau", "email": "owner@riftpower.test", "password": "a-long-password", "accept_terms": True},
    )
    assert response.status_code == 201
    steps = lambda: {step["key"]: step for step in client.get("/api/company/setup").get_json()["steps"]}
    guide = client.get("/api/company/setup").get_json()
    assert guide["dismissed"] is False and [step["key"] for step in guide["steps"]] == ["verify", "customer", "machine", "mechanic", "job"]
    assert not any(step["done"] for step in guide["steps"]) and steps()["machine"]["waiting"] is True

    import re

    token = re.search(r"token=([\w.-]+)", outbox[0].get_body(("plain",)).get_content()).group(1)
    client.post("/api/auth/verify-email", json={"token": token})
    client.post("/api/customers/invite", headers=csrf(client), json={"name": "Grace", "email": "grace@buyer.test"})
    client.post("/api/customers/invite", headers=csrf(client), json={"name": "Otieno", "email": "otieno@riftpower.test", "role": "mechanic"})
    client.post("/api/jobs", headers=csrf(client), json={"title": "First job", "description": "Check the generator"})
    done = steps()
    assert [done[key]["done"] for key in ("verify", "customer", "machine", "mechanic", "job")] == [True, True, False, True, True]

    assert client.post("/api/company/setup/dismiss", headers=csrf(client)).status_code == 200
    assert client.get("/api/company/setup").get_json()["dismissed"] is True


def test_the_setup_guide_is_for_managers_only(client, data, auth):
    assert client.get("/api/company/setup", headers=auth("mech@acme.test")).status_code == 403
    assert client.post("/api/company/setup/dismiss", headers=auth("cust@acme.test")).status_code == 403
