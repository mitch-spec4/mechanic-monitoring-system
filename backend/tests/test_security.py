"""PR 8: two-step sign-in, lockout, the activity log, data export, deleting a company, and the
privacy policy and terms."""
import csv
import io
import json
import zipfile
from datetime import timedelta

import pyotp
import pytest

from app import db
from app.models import AuditEvent, Company, Job, JobFile, JobPart, User
from app.services import two_factor
from app.services.company_data import delete_due_companies
from app.utils.time import utcnow
from conftest import PASSWORD, login

NOW = 1_800_000_000  # a fixed moment, so tests choose which 30-second code is "current"


@pytest.fixture
def clock(monkeypatch):
    """Controls the time authenticator codes are checked against."""
    state = {"now": float(NOW)}
    monkeypatch.setattr(two_factor.time, "time", lambda: state["now"])
    return state


@pytest.fixture
def outbox(app):
    box = app.extensions["email"].outbox
    box.clear()
    return box


@pytest.fixture
def required(app):
    app.config["TWO_FACTOR_REQUIRED"] = True


def enrol(email, secret="JBSWY3DPEHPK3PXP"):
    user = User.query.filter_by(email=email).one()
    user.totp_secret = two_factor.encrypt_secret(secret)
    user.totp_enabled_at = utcnow()
    codes = two_factor.new_backup_codes(user)
    db.session.commit()
    return user, codes


def code_at(seconds, secret="JBSWY3DPEHPK3PXP"):
    return pyotp.TOTP(secret).at(seconds)


def cookie_value(client, name, path="/api/"):
    found = client.get_cookie(name, path=path)
    return found.value if found else None


# ---------- Two-step sign-in ----------


def test_an_enrolled_person_needs_a_code_after_the_password(client, data, required, clock):
    enrol("boss@acme.test")
    first = login(client, "boss@acme.test")
    assert first.status_code == 200 and first.get_json()["two_factor_required"] is True
    # No session yet: the password alone opens nothing.
    assert cookie_value(client, "access_token_cookie") is None
    ticket = first.get_json()["ticket"]

    wrong = client.post("/api/auth/two-factor/verify", json={"ticket": ticket, "code": "000000"})
    assert wrong.status_code == 401
    right = client.post("/api/auth/two-factor/verify", json={"ticket": ticket, "code": code_at(NOW)})
    assert right.status_code == 200 and right.get_json()["user"]["two_factor_enabled"] is True
    assert cookie_value(client, "access_token_cookie")
    events = [event.action for event in AuditEvent.query.order_by(AuditEvent.id)]
    assert events == ["sign_in_failed", "sign_in"]


def test_a_code_works_once_and_a_phone_30_seconds_off_still_works(client, data, required, clock):
    enrol("boss@acme.test")
    ticket = login(client, "boss@acme.test").get_json()["ticket"]
    assert client.post("/api/auth/two-factor/verify", json={"ticket": ticket, "code": code_at(NOW)}).status_code == 200
    ticket = login(client, "boss@acme.test").get_json()["ticket"]
    replay = client.post("/api/auth/two-factor/verify", json={"ticket": ticket, "code": code_at(NOW)})
    assert replay.status_code == 401
    # The phone's clock runs 30 seconds fast: its next code is accepted.
    assert client.post("/api/auth/two-factor/verify", json={"ticket": ticket, "code": code_at(NOW + 30)}).status_code == 200


def test_backup_codes_work_once_each(client, data, required, clock):
    _user, codes = enrol("boss@acme.test")
    assert len(codes) == 10 and len(set(codes)) == 10
    ticket = login(client, "boss@acme.test").get_json()["ticket"]
    # Typed in lower case without the dash: still accepted.
    assert client.post("/api/auth/two-factor/verify", json={"ticket": ticket, "code": codes[0].replace("-", "").lower()}).status_code == 200
    ticket = login(client, "boss@acme.test").get_json()["ticket"]
    assert client.post("/api/auth/two-factor/verify", json={"ticket": ticket, "code": codes[0]}).status_code == 401
    assert client.post("/api/auth/two-factor/verify", json={"ticket": ticket, "code": codes[1]}).status_code == 200


def test_tickets_are_short_lived_and_die_with_a_password_change(client, data, required, clock):
    user, _codes = enrol("boss@acme.test")
    ticket = login(client, "boss@acme.test").get_json()["ticket"]
    user.set_password("a-brand-new-password")
    db.session.commit()
    response = client.post("/api/auth/two-factor/verify", json={"ticket": ticket, "code": code_at(NOW)})
    assert response.status_code == 401 and response.get_json()["restart"] is True
    assert client.post("/api/auth/two-factor/verify", json={"ticket": "made-up", "code": code_at(NOW)}).status_code == 401


def test_a_remembered_device_skips_the_code_until_the_password_changes(client, data, required, clock):
    enrol("boss@acme.test")
    ticket = login(client, "boss@acme.test").get_json()["ticket"]
    client.post("/api/auth/two-factor/verify", json={"ticket": ticket, "code": code_at(NOW), "remember": True})
    assert cookie_value(client, two_factor.DEVICE_COOKIE, "/api/auth/")
    again = login(client, "boss@acme.test")
    assert again.status_code == 200 and "user" in again.get_json() and "ticket" not in again.get_json()

    changed = client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "another-long-password"},
        headers={"X-CSRF-TOKEN": cookie_value(client, "csrf_access_token", "/")},
    )
    assert changed.status_code == 200
    assert login(client, "boss@acme.test", "another-long-password").get_json()["two_factor_required"] is True


def test_someone_without_two_factor_can_only_set_it_up(client, data, auth, required, clock):
    headers = auth("mech@acme.test")
    blocked = client.get("/api/jobs", headers=headers)
    assert blocked.status_code == 403 and blocked.get_json()["two_factor_setup"] is True
    me = client.get("/api/users/me", headers=headers).get_json()["user"]
    assert me["two_factor_setup_needed"] is True and me["two_factor_enabled"] is False

    setup = client.post("/api/auth/two-factor/setup", headers=headers).get_json()
    assert setup["otpauth_uri"].startswith("otpauth://totp/MechanicPro:mech%40acme.test")
    assert setup["qr_svg"].startswith("data:image/svg+xml")
    wrong = client.post("/api/auth/two-factor/enable", headers=headers, json={"setup_token": setup["setup_token"], "code": "123456"})
    assert wrong.status_code == 400
    enabled = client.post(
        "/api/auth/two-factor/enable", headers=headers, json={"setup_token": setup["setup_token"], "code": code_at(NOW, setup["secret"])}
    )
    assert enabled.status_code == 200 and len(enabled.get_json()["backup_codes"]) == 10
    assert client.get("/api/jobs", headers=headers).status_code == 200
    user = User.query.filter_by(email="mech@acme.test").one()
    # Stored encrypted, never as the plain key.
    assert user.totp_secret and setup["secret"] not in user.totp_secret
    assert two_factor.decrypt_secret(user.totp_secret) == setup["secret"]


def test_a_setup_token_is_tied_to_its_person(client, data, auth, required, clock):
    setup = client.post("/api/auth/two-factor/setup", headers=auth("mech@acme.test")).get_json()
    stolen = client.post(
        "/api/auth/two-factor/enable",
        headers=auth("mech2@acme.test"),
        json={"setup_token": setup["setup_token"], "code": code_at(NOW, setup["secret"])},
    )
    assert stolen.status_code == 400


def test_demo_copies_skip_two_factor(client, app, required):
    response = client.post("/api/demo", json={"role": "boss"})
    assert response.status_code == 201
    assert response.get_json()["user"]["two_factor_setup_needed"] is False
    assert client.get("/api/jobs").status_code == 200


def test_moving_two_step_sign_in_to_a_new_phone_needs_the_password(client, data, auth, required, clock):
    """A session alone (a browser left open, a stolen cookie) can't move someone's two-step
    sign-in to another phone and replace their backup codes."""
    enrol("boss@acme.test")
    headers = auth("boss@acme.test")
    setup = client.post("/api/auth/two-factor/setup", headers=headers).get_json()
    body = {"setup_token": setup["setup_token"], "code": code_at(NOW, setup["secret"])}
    assert client.post("/api/auth/two-factor/enable", headers=headers, json=body).status_code == 400
    wrong = client.post("/api/auth/two-factor/enable", headers=headers, json={**body, "password": "wrong"})
    assert wrong.status_code == 400 and "password" in wrong.get_json()["error"]
    assert two_factor.decrypt_secret(User.query.filter_by(email="boss@acme.test").one().totp_secret) == "JBSWY3DPEHPK3PXP"
    moved = client.post("/api/auth/two-factor/enable", headers=headers, json={**body, "password": PASSWORD})
    assert moved.status_code == 200 and len(moved.get_json()["backup_codes"]) == 10
    assert two_factor.decrypt_secret(User.query.filter_by(email="boss@acme.test").one().totp_secret) == setup["secret"]


def test_new_backup_codes_need_the_password(client, data, auth, required, clock):
    _user, old = enrol("boss@acme.test")
    headers = auth("boss@acme.test")
    assert client.post("/api/auth/two-factor/backup-codes", headers=headers, json={"password": "wrong"}).status_code == 400
    fresh = client.post("/api/auth/two-factor/backup-codes", headers=headers, json={"password": PASSWORD}).get_json()["backup_codes"]
    assert set(fresh).isdisjoint(old)
    ticket = login(client, "boss@acme.test").get_json()["ticket"]
    assert client.post("/api/auth/two-factor/verify", json={"ticket": ticket, "code": old[0]}).status_code == 401
    assert client.get("/api/auth/two-factor", headers=headers).get_json()["backup_codes_left"] == 10


def test_a_boss_resets_a_team_members_two_factor(client, data, auth, required, clock):
    enrol("boss@acme.test")
    enrol("mech@acme.test")
    enrol("cust@acme.test")
    boss = auth("boss@acme.test")
    mechanic_session = auth("mech@acme.test")
    # The lists say who has it on, so the reset is only offered where there's something to reset.
    technicians = {row["email"]: row["two_factor_enabled"] for row in client.get("/api/users/mechanics", headers=boss).get_json()["mechanics"]}
    assert technicians == {"mech@acme.test": True, "mech2@acme.test": False}
    assert [row["two_factor_enabled"] for row in client.get("/api/customers", headers=boss).get_json()["customers"]] == [True]
    assert client.post(f"/api/users/{data['mechanic']}/reset-two-factor", headers=boss).status_code == 200
    mechanic = db.session.get(User, data["mechanic"])
    assert mechanic.totp_enabled_at is None and two_factor.backup_codes_left(mechanic) == 0
    # Signed out everywhere; the next sign-in leads to setup.
    assert client.get("/api/jobs", headers=mechanic_session).status_code == 401
    assert client.post(f"/api/users/{data['boss']}/reset-two-factor", headers=boss).status_code == 400
    assert client.post(f"/api/users/{data['other_mechanic']}/reset-two-factor", headers=boss).status_code == 404
    assert client.post(f"/api/users/{data['boss']}/reset-two-factor", headers=auth("mech2@acme.test")).status_code == 403


def test_the_server_command_resets_a_boss(app, data, required):
    enrol("boss@acme.test")
    result = app.test_cli_runner().invoke(args=["reset-2fa", "BOSS@acme.test"])
    assert "Two-step sign-in is off" in result.output
    assert db.session.get(User, data["boss"]).totp_enabled_at is None
    assert app.test_cli_runner().invoke(args=["reset-2fa", "nobody@acme.test"]).exit_code != 0


# ---------- Lockout ----------


def test_five_wrong_passwords_lock_the_account_and_email_its_owner(client, data, outbox):
    for _attempt in range(4):
        assert login(client, "boss@acme.test", "wrong").status_code == 401
    locked = login(client, "boss@acme.test", "wrong")
    assert locked.status_code == 423 and locked.get_json()["locked"] is True
    # The right password doesn't help while locked.
    assert login(client, "boss@acme.test").status_code == 423
    assert len(outbox) == 1 and outbox[0]["To"] == "boss@acme.test" and "locked" in outbox[0]["Subject"]
    assert {"sign_in_failed", "account_locked"} <= {event.action for event in AuditEvent.query}

    user = db.session.get(User, data["boss"])
    user.locked_until = utcnow() - timedelta(seconds=1)
    db.session.commit()
    assert login(client, "boss@acme.test").status_code == 200
    assert db.session.get(User, data["boss"]).failed_logins == 0


def test_wrong_codes_count_towards_the_lock(client, data, required, clock):
    enrol("boss@acme.test")
    ticket = login(client, "boss@acme.test").get_json()["ticket"]
    statuses = [client.post("/api/auth/two-factor/verify", json={"ticket": ticket, "code": "000000"}).status_code for _ in range(5)]
    assert statuses == [401, 401, 401, 401, 423]
    assert client.post("/api/auth/two-factor/verify", json={"ticket": ticket, "code": code_at(NOW)}).status_code == 423


def test_a_success_clears_the_count(client, data):
    for _attempt in range(4):
        login(client, "boss@acme.test", "wrong")
    assert login(client, "boss@acme.test").status_code == 200
    for _attempt in range(4):
        assert login(client, "boss@acme.test", "wrong").status_code == 401


def test_unknown_addresses_never_lock_anything(client, data):
    for _attempt in range(6):
        assert login(client, "nobody@acme.test", "wrong").status_code == 401


# ---------- Activity log ----------


def test_the_activity_log_is_the_bosses_and_only_their_company(client, data, auth):
    boss = auth("boss@acme.test")
    login(client, "boss@acme.test", "wrong")
    login(client, "boss@other.test", "wrong")
    client.post("/api/customers/invite", headers=boss, json={"name": "New", "email": "new@x.test"})
    events = client.get("/api/company/activity", headers=boss).get_json()["events"]
    assert [event["action"] for event in events] == ["invitation_sent", "sign_in_failed"]
    assert events[0]["user"] == "Boss One" and events[0]["detail"] == "new@x.test"
    assert client.get("/api/company/activity", headers=auth("mech@acme.test")).status_code == 403
    assert client.get("/api/company/activity", headers=auth("cust@acme.test")).status_code == 403


def test_the_activity_log_pages_and_forgets_after_a_year(client, data, auth, app):
    for number in range(55):
        db.session.add(AuditEvent(company_id=db.session.get(User, data["boss"]).company_id, action="sign_in", created_at=utcnow()))
    db.session.add(AuditEvent(company_id=db.session.get(User, data["boss"]).company_id, action="sign_in", created_at=utcnow() - timedelta(days=400)))
    db.session.commit()
    boss = auth("boss@acme.test")
    first = client.get("/api/company/activity", headers=boss).get_json()
    assert len(first["events"]) == 50 and first["more"] is True
    second = client.get(f"/api/company/activity?before={first['events'][-1]['id']}", headers=boss).get_json()
    assert len(second["events"]) == 6 and second["more"] is False
    app.test_cli_runner().invoke(args=["purge-activity"])
    assert AuditEvent.query.count() == 55


def test_deleting_a_job_is_logged(client, data, auth):
    boss = auth("boss@acme.test")
    job = Job(title="Quick look", description="x", company_id=db.session.get(User, data["boss"]).company_id, status="Pending")
    db.session.add(job)
    db.session.commit()
    assert client.delete(f"/api/jobs/{job.id}", headers=boss).status_code == 200
    event = AuditEvent.query.filter_by(action="job_deleted").one()
    assert event.detail == "Quick look" and event.user_name == "Boss One"


# ---------- Export my data ----------


def test_the_export_is_a_zip_of_spreadsheets_without_secrets(client, data, auth):
    enrol("boss@acme.test")
    # A decimal quantity, which JSON can't hold as is.
    db.session.add(JobPart(job_id=data["job"], name="Coolant", quantity=1.5, added_by=data["mechanic"]))
    db.session.commit()
    boss = auth("boss@acme.test")
    assert client.post("/api/company/export", headers=boss, json={"password": "wrong"}).status_code == 400
    response = client.post("/api/company/export", headers=boss, json={"password": PASSWORD})
    assert response.status_code == 200 and response.mimetype == "application/zip"
    zipped = zipfile.ZipFile(io.BytesIO(response.data))
    names = set(zipped.namelist())
    assert {"jobs.csv", "customers.csv", "equipment.csv", "people.csv", "data.json", "README.txt", "files.csv"} <= names
    people = list(csv.DictReader(io.StringIO(zipped.read("people.csv").decode("utf-8-sig"))))
    assert {row["email"] for row in people} == {"boss@acme.test", "boss2@acme.test", "mech@acme.test", "mech2@acme.test", "cust@acme.test"}
    everything = zipped.read("data.json").decode()
    for secret in ("password_hash", "totp_secret", "code_hash", "pbkdf2", "scrypt"):
        assert secret not in everything
    # Nothing from the other company.
    assert "boss@other.test" not in everything and "Other Co" not in everything
    assert json.loads(everything)["company"] == "Acme Service"
    assert json.loads(everything)["tables"]["parts_used"][0]["quantity"] == "1.50"
    assert AuditEvent.query.filter_by(action="data_exported").count() == 1
    assert client.post("/api/company/export", headers=auth("mech@acme.test"), json={"password": PASSWORD}).status_code == 403


def test_file_links_in_the_export_work_without_signing_in_for_seven_days(client, data, auth, app, monkeypatch):
    company_id = db.session.get(User, data["boss"]).company_id
    from app.services.storage import storage

    storage().put("acme/report.jpg", b"photo-bytes", "image/jpeg")
    record = JobFile(
        company_id=company_id, job_id=data["job"], kind="before", storage_key="acme/report.jpg", content_type="image/jpeg",
        size_bytes=11, status="ready", uploaded_by=data["mechanic"], original_name="pump.jpg",
    )
    db.session.add(record)
    db.session.commit()
    zipped = zipfile.ZipFile(io.BytesIO(client.post("/api/company/export", headers=auth("boss@acme.test"), json={"password": PASSWORD}).data))
    rows = list(csv.DictReader(io.StringIO(zipped.read("files.csv").decode("utf-8-sig"))))
    link = rows[0]["download_link"]
    path = link.split("/api/", 1)[1]
    fresh = app.test_client().get(f"/api/{path}")
    assert fresh.status_code == 200 and fresh.data == b"photo-bytes"
    import itsdangerous.timed

    real = itsdangerous.timed.time.time
    monkeypatch.setattr(itsdangerous.timed.time, "time", lambda: real() + 8 * 86400)
    assert app.test_client().get(f"/api/{path}").status_code == 404


# ---------- Delete my company ----------


def test_deleting_the_company_needs_its_name_and_the_password(client, data, auth):
    boss = auth("boss@acme.test")
    mechanic = auth("mech@acme.test")
    assert client.post("/api/company/delete", headers=boss, json={"password": PASSWORD, "company_name": "Acme"}).status_code == 400
    assert client.post("/api/company/delete", headers=boss, json={"password": "wrong", "company_name": "Acme Service"}).status_code == 400
    assert client.post("/api/company/delete", headers=mechanic, json={"password": PASSWORD, "company_name": "Acme Service"}).status_code == 403
    response = client.post("/api/company/delete", headers=boss, json={"password": PASSWORD, "company_name": " acme service "})
    assert response.status_code == 200
    company = db.session.get(Company, db.session.get(User, data["boss"]).company_id)
    assert company.deletion_due_at - utcnow() > timedelta(days=29)
    # Everyone is signed out.
    assert client.get("/api/jobs", headers=boss).status_code == 401
    assert client.get("/api/jobs", headers=mechanic).status_code == 401
    # Signed in again, the date shows, and a manager can cancel.
    boss = auth("boss@acme.test")
    assert client.get("/api/users/me", headers=boss).get_json()["user"]["deletion_due"]
    assert client.post("/api/company/delete/cancel", headers=boss).status_code == 200
    assert db.session.get(Company, company.id).deletion_due_at is None
    assert client.post("/api/company/delete/cancel", headers=boss).status_code == 409


def test_a_company_is_deleted_only_when_its_30_days_are_up(client, data, auth):
    company_id = db.session.get(User, data["boss"]).company_id
    client.post("/api/company/delete", headers=auth("boss@acme.test"), json={"password": PASSWORD, "company_name": "Acme Service"})
    assert delete_due_companies() == 0
    company = db.session.get(Company, company_id)
    company.deletion_due_at = utcnow() - timedelta(minutes=1)
    db.session.commit()
    assert delete_due_companies() == 1
    assert db.session.get(Company, company_id) is None
    assert User.query.filter_by(company_id=company_id).count() == 0
    assert AuditEvent.query.filter_by(company_id=company_id).count() == 0
    # The other company is untouched.
    assert User.query.filter_by(email="boss@other.test").one()


def test_demo_companies_cant_be_deleted_this_way(client, app):
    client.post("/api/demo", json={"role": "boss"})
    response = client.post(
        "/api/company/delete",
        json={"password": "x", "company_name": "x"},
        headers={"X-CSRF-TOKEN": cookie_value(client, "csrf_access_token", "/")},
    )
    assert response.status_code == 400 and "24 hours" in response.get_json()["error"]


# ---------- Privacy policy, terms and agreeing ----------


def test_the_legal_pages_come_from_their_files(client):
    privacy = client.get("/api/legal/privacy").get_json()
    terms = client.get("/api/legal/terms").get_json()
    assert privacy["version"] and privacy["text"].startswith("# Privacy policy")
    assert terms["text"].startswith("# Terms of service")
    assert client.get("/api/legal/cookies").status_code == 404


def test_signing_up_and_joining_need_agreement_and_record_it(client, data, auth):
    signup = {"company_name": "Pwani Power", "name": "Amani", "email": "amani@pwani.test", "password": "a-long-password"}
    refused = client.post("/api/signup", json=signup)
    assert refused.status_code == 400 and "agree" in refused.get_json()["error"]
    assert client.post("/api/signup", json={**signup, "accept_terms": "yes"}).status_code == 400
    assert client.post("/api/signup", json={**signup, "accept_terms": True}).status_code == 201
    owner = User.query.filter_by(email="amani@pwani.test").one()
    assert owner.terms_accepted_at and owner.terms_version

    code = client.post("/api/customers/invite", headers=auth("boss@acme.test"), json={"name": "J", "email": "j@x.test"}).get_json()["code"]
    join = {"code": code, "name": "J", "email": "j@x.test", "password": "long-enough"}
    assert client.post("/api/auth/accept-invitation", json=join).status_code == 400
    assert client.post("/api/auth/accept-invitation", json={**join, "accept_terms": True}).status_code == 201
    assert User.query.filter_by(email="j@x.test").one().terms_accepted_at
