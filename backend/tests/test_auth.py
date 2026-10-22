from datetime import timedelta

import pytest

from app import create_app, db
from app.models import Invitation, User
from tests.conftest import login


def test_login_returns_access_and_refresh_tokens(client, data):
    response = login(client, "boss@acme.test")
    body = response.get_json()
    assert response.status_code == 200
    assert body["token"] and body["refresh_token"]
    assert body["user"]["role"] == "boss"


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


def test_refresh_issues_new_access_token(client, data):
    refresh = login(client, "mech@acme.test").get_json()["refresh_token"]
    response = client.post("/api/auth/refresh", headers={"Authorization": f"Bearer {refresh}"})
    assert response.status_code == 200
    token = response.get_json()["token"]
    assert client.get("/api/jobs", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_access_token_cannot_be_used_to_refresh(client, data, auth):
    response = client.post("/api/auth/refresh", headers=auth("mech@acme.test"))
    assert response.status_code == 401


def test_expired_token_returns_401_with_message(app, data):
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(seconds=-1)
    client = app.test_client()
    token = login(client, "boss@acme.test").get_json()["token"]
    response = client.get("/api/jobs", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert "expired" in response.get_json()["error"]


def test_deleted_user_token_stops_working_immediately(client, data, auth):
    headers = auth("mech2@acme.test")
    assert client.get("/api/jobs", headers=headers).status_code == 200
    assert client.delete(f"/api/users/{data['mechanic2']}", headers=auth("boss@acme.test")).status_code == 200
    assert client.get("/api/jobs", headers=headers).status_code == 401


def test_login_is_rate_limited(tmp_path):
    limited = create_app(
        {
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'limit.db'}",
            "RATELIMIT_ENABLED": True,
            "LOGIN_RATE_LIMIT": "3 per minute",
        }
    )
    with limited.app_context():
        db.create_all()
        client = limited.test_client()
        statuses = [login(client, "nobody@acme.test", "wrong").status_code for _ in range(4)]
        assert statuses == [401, 401, 401, 429]
        assert "error" in client.post("/api/auth/login", json={}).get_json()
        db.session.remove()


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
