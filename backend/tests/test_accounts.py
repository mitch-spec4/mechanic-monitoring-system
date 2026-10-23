"""Account emails: verifying an address, forgotten passwords and emailed invitations."""
import re
import time

import pytest
from itsdangerous.timed import TimestampSigner

from app import db
from app.models import Invitation, User
from app.services.accounts import reset_token, verification_token
from tests.conftest import PASSWORD, cookie, login

SIGNUP = {"company_name": "Rift Valley Power", "name": "Wanjiku Kamau", "email": "owner@riftpower.test", "password": "a-long-password"}


@pytest.fixture
def outbox(app):
    box = app.extensions["email"].outbox
    box.clear()
    return box


def link_token(message, path):
    match = re.search(rf"/#/{path}\?token=([\w.-]+)", message.get_body(("plain",)).get_content())
    assert match, f"no /{path} link in the email"
    return match.group(1)


def signed_up(client):
    response = client.post("/api/signup", json=SIGNUP)
    assert response.status_code == 201
    return response.get_json()["user"], {"X-CSRF-TOKEN": cookie(client, "csrf_access_token")}


def made_hours_ago(hours, make):
    """A signed token stamped `hours` ago, to test expiry without waiting."""
    real = TimestampSigner.get_timestamp
    TimestampSigner.get_timestamp = lambda self: int(time.time()) - hours * 3600
    try:
        return make()
    finally:
        TimestampSigner.get_timestamp = real


def test_signup_emails_a_link_that_confirms_the_address(client, outbox):
    user, _ = signed_up(client)
    assert user["email_verified"] is False
    assert len(outbox) == 1 and outbox[0]["To"] == "owner@riftpower.test"
    assert outbox[0]["Subject"] == "Confirm your email for MechanicPro"
    token = link_token(outbox[0], "verify")

    response = client.post("/api/auth/verify-email", json={"token": token})
    assert response.status_code == 200 and response.get_json()["email"] == "owner@riftpower.test"
    assert client.get("/api/users/me").get_json()["user"]["email_verified"] is True
    # Opening the link again is harmless.
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200


@pytest.mark.parametrize("token", ["", "garbage", None, 42])
def test_bad_verification_links_are_refused(client, data, token):
    response = client.post("/api/auth/verify-email", json={"token": token})
    assert response.status_code == 400 and "invalid or has expired" in response.get_json()["error"]


def test_verification_links_expire_and_stop_working_for_an_old_address(client, data):
    user = db.session.get(User, data["boss"])
    user.email_verified_at = None
    db.session.commit()
    expired = made_hours_ago(49, lambda: verification_token(user))
    assert client.post("/api/auth/verify-email", json={"token": expired}).status_code == 400

    token = verification_token(user)
    user.email = "new-address@acme.test"
    db.session.commit()
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 400
    assert db.session.get(User, data["boss"]).email_verified_at is None


def test_resend_sends_a_new_link_only_while_unconfirmed(client, outbox):
    _, csrf = signed_up(client)
    outbox.clear()
    response = client.post("/api/auth/resend-verification", headers=csrf)
    assert response.status_code == 200 and response.get_json()["sent"] is True
    assert len(outbox) == 1
    client.post("/api/auth/verify-email", json={"token": link_token(outbox[0], "verify")})
    again = client.post("/api/auth/resend-verification", headers=csrf)
    assert again.status_code == 200 and again.get_json()["sent"] is False and len(outbox) == 1


def test_resending_is_rate_limited(app, client, outbox):
    _, csrf = signed_up(client)
    app.config.update(RATELIMIT_ENABLED=True, EMAIL_RATE_LIMIT="1 per hour")
    assert client.post("/api/auth/resend-verification", headers=csrf).status_code == 200
    assert client.post("/api/auth/resend-verification", headers=csrf).status_code == 429


def test_a_failed_email_does_not_stop_signup_and_resend_says_so(app, client, monkeypatch, outbox):
    def broken(message):
        raise OSError("SMTP server unreachable")

    monkeypatch.setattr(app.extensions["email"], "send", broken)
    _, csrf = signed_up(client)
    response = client.post("/api/auth/resend-verification", headers=csrf)
    assert response.status_code == 503 and "couldn't be sent" in response.get_json()["error"]


def test_an_unconfirmed_boss_cannot_invite_until_the_link_is_opened(client, outbox):
    _, csrf = signed_up(client)
    invite = lambda: client.post("/api/customers/invite", headers=csrf, json={"name": "Grace", "email": "grace@buyer.test"})
    refused = invite()
    assert refused.status_code == 403 and "owner@riftpower.test" in refused.get_json()["error"]
    assert Invitation.query.count() == 0
    client.post("/api/auth/verify-email", json={"token": link_token(outbox[0], "verify")})
    assert invite().status_code == 201


def test_invitations_are_emailed_with_a_link_that_fills_in_the_form(client, auth, outbox):
    response = client.post("/api/customers/invite", headers=auth("boss@acme.test"), json={"name": "Grace Wanjiru", "email": "grace+site@buyer.test", "role": "mechanic"})
    assert response.status_code == 201
    body = response.get_json()
    assert body["emailed"] is True
    email = outbox[-1]
    assert email["To"] == "grace+site@buyer.test"
    assert email["Subject"] == "Boss One invited you to Acme Service on MechanicPro"
    text = email.get_body(("plain",)).get_content()
    assert "as a mechanic" in text and body["code"] in text
    # The address is encoded, so "+" survives the trip through the link.
    assert f"/#/join?code={body['code']}&email=grace%2Bsite%40buyer.test" in text


def test_names_in_emails_cannot_inject_html(client, auth, outbox):
    client.post("/api/customers/invite", headers=auth("boss@acme.test"), json={"name": "<script>alert(1)</script>", "email": "x@buyer.test"})
    html = outbox[-1].get_body(("html",)).get_content()
    assert "<script>" not in html and "&lt;script&gt;" in html


def test_forgot_password_emails_a_link_that_works_once(client, data, outbox):
    user = db.session.get(User, data["mechanic"])
    user.email_verified_at = None
    db.session.commit()
    response = client.post("/api/auth/forgot-password", json={"email": "MECH@acme.test"})
    assert response.status_code == 200 and "If an account uses that email" in response.get_json()["message"]
    assert len(outbox) == 1 and outbox[0]["Subject"] == "Reset your MechanicPro password"
    token = link_token(outbox[0], "reset")

    short = client.post("/api/auth/reset-password", json={"token": token, "password": "short"})
    assert short.status_code == 400
    done = client.post("/api/auth/reset-password", json={"token": token, "password": "a-brand-new-password"})
    assert done.status_code == 200 and done.get_json()["email"] == "mech@acme.test"
    assert login(client, "mech@acme.test", "a-brand-new-password").status_code == 200
    assert login(client, "mech@acme.test", PASSWORD).status_code == 401
    # Opening the link proves the address, and the link is spent.
    assert db.session.get(User, data["mechanic"]).email_verified_at is not None
    again = client.post("/api/auth/reset-password", json={"token": token, "password": "another-password"})
    assert again.status_code == 400 and "already used" in again.get_json()["error"]


def test_forgot_password_gives_the_same_answer_for_unknown_addresses(client, data, outbox):
    known = client.post("/api/auth/forgot-password", json={"email": "boss@acme.test"}).get_json()
    unknown = client.post("/api/auth/forgot-password", json={"email": "nobody@acme.test"}).get_json()
    assert known == unknown and len(outbox) == 1


def test_reset_links_expire_after_an_hour_and_when_the_password_changes(client, data):
    user = db.session.get(User, data["boss"])
    expired = made_hours_ago(2, lambda: reset_token(user))
    assert client.post("/api/auth/reset-password", json={"token": expired, "password": "a-brand-new-password"}).status_code == 400

    token = reset_token(user)
    user.set_password("changed-in-settings")
    db.session.commit()
    assert client.post("/api/auth/reset-password", json={"token": token, "password": "a-brand-new-password"}).status_code == 400


def test_manager_reset_codes_still_work_alongside_links(client, data, auth):
    code = client.post(f"/api/users/{data['mechanic']}/reset-code", headers=auth("boss@acme.test")).get_json()["code"]
    response = client.post("/api/auth/reset-password", json={"email": "mech@acme.test", "code": code, "password": "set-by-code-1"})
    assert response.status_code == 200


def test_a_boss_whose_email_changes_must_confirm_the_new_one(client, data, auth, outbox):
    response = client.patch(f"/api/users/{data['boss2']}", headers=auth("boss@acme.test"), json={"email": "boss.two@acme.test"})
    assert response.status_code == 200
    changed = db.session.get(User, data["boss2"])
    assert changed.email_verified_at is None
    assert outbox[-1]["To"] == "boss.two@acme.test"
    # Saving the same address again changes nothing.
    client.patch(f"/api/users/{data['boss']}", headers=auth("boss@acme.test"), json={"email": "boss@acme.test"})
    assert db.session.get(User, data["boss"]).email_verified_at is not None


def test_the_log_backend_writes_emails_to_the_log(app, client, data, caplog):
    with caplog.at_level("WARNING"):
        client.post("/api/auth/forgot-password", json={"email": "boss@acme.test"})
    assert "Email not sent (EMAIL_BACKEND=log)" in caplog.text and "To: boss@acme.test" in caplog.text


def test_smtp_backend_sends_through_the_configured_server(app, monkeypatch):
    from app.services import email as email_service

    sent = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            sent["server"] = (host, port)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def starttls(self):
            sent["tls"] = True

        def login(self, username, password):
            sent["login"] = username

        def send_message(self, message):
            sent["to"] = message["To"]

    monkeypatch.setattr(email_service.smtplib, "SMTP", FakeSMTP)
    app.config.update(SMTP_HOST="smtp.example.com", SMTP_PORT=587, SMTP_USERNAME="resend", SMTP_PASSWORD="key", SMTP_SECURITY="starttls")
    app.extensions["email"] = email_service.SmtpMailer(app.config)
    assert email_service.send_email("someone@example.com", "Hello", "Text") is True
    assert sent == {"server": ("smtp.example.com", 587), "tls": True, "login": "resend", "to": "someone@example.com"}


def test_email_settings_are_checked_at_startup():
    from types import SimpleNamespace

    from app.services.email import init_email

    config = {"EMAIL_BACKEND": "smtp", "SMTP_HOST": "", "EMAIL_FROM": "x@example.com", "SMTP_SECURITY": "starttls"}
    with pytest.raises(RuntimeError, match="SMTP_HOST"):
        init_email(SimpleNamespace(config=config, extensions={}))
    with pytest.raises(RuntimeError, match="EMAIL_BACKEND"):
        init_email(SimpleNamespace(config={**config, "EMAIL_BACKEND": "carrier-pigeon"}, extensions={}))
