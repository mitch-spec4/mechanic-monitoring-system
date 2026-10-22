from datetime import timedelta

import pytest

from app import create_app, db
from app.models import AuthAttempt, Invitation, User
from app.services.rate_limit import parse_limits
from tests.conftest import PASSWORD, cookie, login


def test_login_sets_httponly_session_cookies(client, data):
    response = login(client, "boss@acme.test")
    body = response.get_json()
    assert response.status_code == 200
    assert body["user"]["role"] == "boss"
    assert "token" not in body and "refresh_token" not in body
    set_cookies = response.headers.getlist("Set-Cookie")
    session = [c for c in set_cookies if c.startswith(("access_token_cookie=", "refresh_token_cookie="))]
    assert len(session) == 2 and all("HttpOnly" in c for c in session)
    assert cookie(client, "csrf_access_token")


@pytest.mark.parametrize("payload", [{}, {"email": "boss@acme.test"}, {"email": "boss@acme.test", "password": 5}, [1, 2]])
def test_bad_login_payloads_are_rejected_without_500(client, data, payload):
    response = client.post("/api/auth/login", json=payload)
    assert response.status_code in (400, 401)
    assert "error" in response.get_json()


def test_wrong_password(client, data):
    response = login(client, "boss@acme.test", "wrong-password")
    assert response.status_code == 401
    assert response.get_json()["error"] == "Invalid email or password"


def test_missing_and_invalid_tokens_return_json_errors(client, data):
    assert client.get("/api/jobs").get_json()["error"]
    response = client.get("/api/jobs", headers={"Authorization": "Bearer nonsense"})
    assert response.status_code == 401
    assert response.get_json()["error"]


def test_cookie_session_works_and_requires_csrf_for_changes(client, data):
    login(client, "boss@acme.test")
    assert client.get("/api/jobs").status_code == 200
    payload = {"title": "Cookie job", "description": "x"}
    assert client.post("/api/jobs", json=payload).status_code == 401
    csrf = {"X-CSRF-TOKEN": cookie(client, "csrf_access_token")}
    assert client.post("/api/jobs", json=payload, headers=csrf).status_code == 201


def test_refresh_issues_new_access_cookie(client, data):
    login(client, "mech@acme.test")
    client.delete_cookie("access_token_cookie", path="/api/")
    assert client.get("/api/jobs").status_code == 401
    response = client.post("/api/auth/refresh", headers={"X-CSRF-TOKEN": cookie(client, "csrf_refresh_token")})
    assert response.status_code == 200
    assert client.get("/api/jobs").status_code == 200


def test_logout_clears_session(client, data):
    login(client, "mech@acme.test")
    client.post("/api/auth/logout")
    assert client.get("/api/jobs").status_code == 401


def test_access_token_cannot_be_used_to_refresh(client, data, auth):
    response = client.post("/api/auth/refresh", headers=auth("mech@acme.test"))
    assert response.status_code == 401


def test_expired_token_returns_401_with_message(app, client, data, auth):
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(seconds=-1)
    response = client.get("/api/jobs", headers=auth("boss@acme.test"))
    assert response.status_code == 401
    assert "expired" in response.get_json()["error"]


def test_deleted_user_token_stops_working_immediately(client, data, auth):
    headers = auth("mech2@acme.test")
    assert client.get("/api/jobs", headers=headers).status_code == 200
    assert client.delete(f"/api/users/{data['mechanic2']}", headers=auth("boss@acme.test")).status_code == 200
    assert client.get("/api/jobs", headers=headers).status_code == 401


def test_failed_logins_are_rate_limited_in_the_database(app, client, data):
    app.config["RATELIMIT_ENABLED"] = True
    app.config["LOGIN_RATE_LIMIT"] = "3 per minute"
    statuses = [login(client, "boss@acme.test", "wrong").status_code for _ in range(4)]
    assert statuses == [401, 401, 401, 429]
    # The block is per email too, so the right password is refused until the window passes.
    assert login(client, "boss@acme.test").status_code == 429
    assert AuthAttempt.query.count() == 6  # three failures, each counted for IP and email


def test_successful_logins_do_not_count(app, client, data):
    app.config["RATELIMIT_ENABLED"] = True
    app.config["LOGIN_RATE_LIMIT"] = "2 per minute"
    assert [login(client, "boss@acme.test").status_code for _ in range(4)] == [200] * 4


def test_rate_limit_spec_is_validated():
    assert parse_limits("10 per minute;50 per hour") == [(10, 60), (50, 3600)]
    with pytest.raises(ValueError):
        parse_limits("lots")


def invite(client, auth, **payload):
    return client.post("/api/customers/invite", headers=auth("boss@acme.test"), json=payload)


def test_invitation_flow_creates_customer_account(client, auth):
    code = invite(client, auth, name="New Customer", email="New@Example.com").get_json()["code"]
    response = client.post(
        "/api/auth/accept-invitation",
        json={"code": code, "name": "New Customer", "email": "new@example.com", "password": "long-enough"},
    )
    assert response.status_code == 201
    assert login(client, "new@example.com", "long-enough").status_code == 200
    reused = client.post(
        "/api/auth/accept-invitation",
        json={"code": code, "name": "Again", "email": "new@example.com", "password": "long-enough"},
    )
    assert reused.status_code == 400


def test_invitation_requires_matching_email_and_valid_input(client, auth):
    assert invite(client, auth, name="X", email="not-an-email").status_code == 400
    assert invite(client, auth, name="X", email="x@example.com", role="boss").status_code == 400
    code = invite(client, auth, name="X", email="x@example.com").get_json()["code"]
    wrong_email = client.post(
        "/api/auth/accept-invitation",
        json={"code": code, "name": "X", "email": "y@example.com", "password": "long-enough"},
    )
    assert wrong_email.status_code == 403
    short = client.post(
        "/api/auth/accept-invitation", json={"code": code, "name": "X", "email": "x@example.com", "password": "short"}
    )
    assert short.status_code == 400


def test_expired_invitation_is_rejected(client, auth):
    code = invite(client, auth, name="Late", email="late@example.com").get_json()["code"]
    invitation = Invitation.query.filter_by(code=code).first()
    invitation.expires_at -= timedelta(days=8)
    db.session.commit()
    response = client.post(
        "/api/auth/accept-invitation",
        json={"code": code, "name": "Late", "email": "late@example.com", "password": "long-enough"},
    )
    assert response.status_code == 400


def test_registration_is_invite_only(client):
    assert client.post("/api/auth/register", json={}).status_code == 403


def test_production_refuses_weak_or_missing_settings(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SECRET_KEY", "change-me")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    monkeypatch.setenv("CORS_ORIGINS", "*")
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    with pytest.raises(RuntimeError) as error:
        create_app()
    assert "SECRET_KEY" in str(error.value) and "CORS_ORIGINS" in str(error.value)


def test_unset_app_env_is_treated_as_production(monkeypatch):
    for name in ("APP_ENV", "SECRET_KEY", "JWT_SECRET_KEY", "CORS_ORIGINS", "DATABASE_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr("app.load_dotenv", lambda: None)
    with pytest.raises(RuntimeError):
        create_app()


def test_production_starts_with_strong_settings(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SECRET_KEY", "s" * 40)
    monkeypatch.setenv("JWT_SECRET_KEY", "j" * 40)
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com")
    monkeypatch.setenv("DATABASE_URL", "postgres://user:pass@db.example.com/app")
    app = create_app()
    assert app.config["SQLALCHEMY_DATABASE_URI"].startswith("postgresql+psycopg://")
    assert app.config["CORS_ORIGINS"] == ["https://app.example.com"]


def test_user_role_change_invalidates_old_token(client, data, auth):
    headers = auth("mech2@acme.test")
    user = db.session.get(User, data["mechanic2"])
    user.role = "boss"
    db.session.commit()
    assert client.get("/api/jobs", headers=headers).status_code == 401


def test_invite_rejects_email_that_already_has_an_account(client, auth):
    assert invite(client, auth, name="Dup", email="MECH@acme.test").status_code == 409


def reset_code(client, auth, user_id):
    return client.post(f"/api/users/{user_id}/reset-code", headers=auth("boss@acme.test"))


def test_manager_reset_code_lets_user_set_new_password(client, data, auth):
    old_session = auth("mech@acme.test")
    response = reset_code(client, auth, data["mechanic"])
    assert response.status_code == 201
    code = response.get_json()["code"]

    wrong = client.post("/api/auth/reset-password", json={"email": "mech2@acme.test", "code": code, "password": "brand-new-pass"})
    assert wrong.status_code == 400
    ok = client.post("/api/auth/reset-password", json={"email": "mech@acme.test", "code": code.lower(), "password": "brand-new-pass"})
    assert ok.status_code == 200
    assert login(client, "mech@acme.test", "brand-new-pass").status_code == 200
    assert login(client, "mech@acme.test").status_code == 401
    assert client.get("/api/jobs", headers=old_session).status_code == 401
    reused = client.post("/api/auth/reset-password", json={"email": "mech@acme.test", "code": code, "password": "another-pass"})
    assert reused.status_code == 400


def test_new_reset_code_replaces_old_one_and_rules(client, data, auth):
    first = reset_code(client, auth, data["mechanic"]).get_json()["code"]
    reset_code(client, auth, data["mechanic"])
    stale = client.post("/api/auth/reset-password", json={"email": "mech@acme.test", "code": first, "password": "brand-new-pass"})
    assert stale.status_code == 400
    assert reset_code(client, auth, data["boss"]).status_code == 400
    assert reset_code(client, auth, data["other_mechanic"]).status_code == 404
    assert client.post(f"/api/users/{data['mechanic2']}/reset-code", headers=auth("mech@acme.test")).status_code == 403


def test_change_password(client, data, auth):
    login(client, "cust@acme.test")
    csrf = {"X-CSRF-TOKEN": cookie(client, "csrf_access_token")}
    other_session = auth("cust@acme.test")
    bad = client.post("/api/auth/change-password", headers=csrf, json={"current_password": "nope", "new_password": "fresh-password"})
    assert bad.status_code == 400
    short = client.post("/api/auth/change-password", headers=csrf, json={"current_password": PASSWORD, "new_password": "short"})
    assert short.status_code == 400
    ok = client.post("/api/auth/change-password", headers=csrf, json={"current_password": PASSWORD, "new_password": "fresh-password"})
    assert ok.status_code == 200
    assert client.get("/api/jobs").status_code == 200  # this browser stays signed in
    assert client.get("/api/jobs", headers=other_session).status_code == 401  # other sessions end
    assert login(client, "cust@acme.test", "fresh-password").status_code == 200
