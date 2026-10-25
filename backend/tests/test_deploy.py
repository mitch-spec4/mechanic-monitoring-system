"""Running in production: staging without keys, the health check, the web app on the same site,
the daily run, and backups that really restore."""
import os
import shutil
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from app import build_config, create_app, db
from app.services.billing import init_billing

BACKEND = Path(__file__).resolve().parents[1]
PRODUCTION = {
    "SECRET_KEY": "s" * 40,
    "JWT_SECRET_KEY": "j" * 40,
    "DATABASE_URL": "postgresql://user:pass@db.example.com/app",
    "CORS_ORIGINS": "https://app.example.com",
    "APP_URL": "https://app.example.com",
}


@pytest.fixture
def environment(monkeypatch):
    for name in ("EMAIL_BACKEND", "EMAIL_FROM", "SMTP_HOST", "BILLING_PROVIDER", "TEST_OUTBOX", "GIT_SHA", "RENDER_GIT_COMMIT"):
        monkeypatch.delenv(name, raising=False)
    for name, value in PRODUCTION.items():
        monkeypatch.setenv(name, value)
    return monkeypatch


def test_staging_runs_without_email_or_payment_keys(environment):
    environment.setenv("APP_ENV", "staging")
    config = build_config()
    assert config["IS_PRODUCTION"] and config["IS_STAGING"] and config["JWT_COOKIE_SECURE"]
    assert config["EMAIL_BACKEND"] == "log" and config["BILLING_PROVIDER"] == "test" and config["TWO_FACTOR_REQUIRED"]
    init_billing(SimpleNamespace(config=config, extensions={}))
    # Its security is production's: real secrets and an https address are still required.
    environment.setenv("SECRET_KEY", "short")
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        build_config()


def test_production_needs_email_and_refuses_test_payments(environment):
    environment.setenv("APP_ENV", "production")
    with pytest.raises(RuntimeError, match="Email must be set up"):
        build_config()
    environment.setenv("EMAIL_FROM", "MechanicPro <no-reply@example.com>")
    environment.setenv("SMTP_HOST", "smtp.example.com")
    config = build_config()
    assert config["BILLING_PROVIDER"] == "none" and not config["IS_STAGING"]
    with pytest.raises(RuntimeError, match="development and staging"):
        init_billing(SimpleNamespace(config={**config, "BILLING_PROVIDER": "test"}, extensions={}))


def test_the_version_comes_from_the_host(environment):
    environment.setenv("APP_ENV", "staging")
    environment.setenv("RENDER_GIT_COMMIT", "0123456789abcdef0123")
    assert build_config()["VERSION"] == "0123456789ab"


def test_the_health_check_asks_the_database(client, monkeypatch):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.get_json() == {"status": "ok", "database": "ok", "version": "dev"}

    def broken(*args, **kwargs):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(db.session, "execute", broken)
    down = client.get("/api/health")
    assert down.status_code == 503 and down.get_json()["database"] == "unreachable"


def test_every_answer_has_the_security_headers(client):
    response = client.get("/api/plans")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"


def test_the_web_app_is_served_from_the_same_site(tmp_path):
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<!doctype html><title>MechanicPro</title>")
    (web / "assets" / "index-abc123.js").write_text("console.log(1)")
    (web / "sw.js").write_text("self.addEventListener('install', () => {})")
    app = create_app({"SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'web.db'}", "TESTING": True, "FRONTEND_DIST": str(web)})
    client = app.test_client()

    page = client.get("/")
    assert page.status_code == 200 and b"MechanicPro" in page.data and "no-cache" in page.headers["Cache-Control"]
    asset = client.get("/assets/index-abc123.js")
    assert asset.status_code == 200 and "immutable" in asset.headers["Cache-Control"] and "max-age=31536000" in asset.headers["Cache-Control"]
    assert "no-cache" not in asset.headers["Cache-Control"]
    # The service worker is always checked, so phones find new versions.
    assert "no-cache" in client.get("/sw.js").headers["Cache-Control"]
    # Any other path is the page (its own routes come after "#"); the API stays the API.
    assert b"MechanicPro" in client.get("/billing").data
    missing = client.get("/api/no-such-thing")
    assert missing.status_code == 404 and missing.is_json
    assert client.get("/api/plans").is_json
    # No walking out of the folder.
    for path in ("/../../etc/passwd", "/assets/../../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd"):
        assert b"root:" not in client.get(path).data

    with pytest.raises(RuntimeError, match="no index.html"):
        create_app({"SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'web.db'}", "TESTING": True, "FRONTEND_DIST": str(tmp_path / "empty")})


def test_the_daily_command_runs_everything(app, data):
    result = app.test_cli_runner().invoke(args=["daily"])
    assert result.exit_code == 0, result.output
    for part in ("demo_companies", "reminders", "maintenance", "billing", "deleted_companies"):
        assert f'"{part}"' in result.output


POSTGRES = os.getenv("TEST_DATABASE_URL", "").startswith(("postgres://", "postgresql")) and shutil.which("pg_dump") and shutil.which("pg_restore")


@pytest.mark.skipif(not POSTGRES, reason="needs TEST_DATABASE_URL on Postgres, and pg_dump and pg_restore")
def test_a_backup_restores_into_a_scratch_database(tmp_path):
    """The written restore test (SETUP.md, Backups), run for real: migrate a database, back it up,
    restore the copy into an empty one, and check it."""
    from sqlalchemy import create_engine, text

    from app import normalize_database_url
    from scripts.backup import postgres_url

    server = postgres_url(os.environ["TEST_DATABASE_URL"]).rsplit("/", 1)[0]
    admin = create_engine(normalize_database_url(f"{server}/postgres"), isolation_level="AUTOCOMMIT")
    names = ("mp_backup_source", "mp_backup_scratch")
    with admin.connect() as connection:
        for name in names:
            connection.execute(text(f"drop database if exists {name}"))
            connection.execute(text(f"create database {name}"))
    source, scratch = (f"{server}/{name}" for name in names)
    env = {**os.environ, "APP_ENV": "development", "DATABASE_URL": source, "BACKUP_DIR": str(tmp_path / "backups")}
    env.pop("BACKUP_BUCKET", None)
    try:
        run = lambda *args, **extra: subprocess.run([*args], cwd=BACKEND, env={**env, **extra}, capture_output=True, text=True)  # noqa: E731
        migrated = run(sys.executable, "-m", "flask", "--app", "run.py", "db", "upgrade")
        assert migrated.returncode == 0, migrated.stderr
        backed_up = run(sys.executable, "scripts/backup.py")
        assert backed_up.returncode == 0 and "Backup written to" in backed_up.stdout, backed_up.stderr
        assert len(list((tmp_path / "backups").glob("mechanicpro-*.dump"))) == 1

        restored = run(sys.executable, "scripts/restore_check.py", RESTORE_DATABASE_URL=scratch)
        assert restored.returncode == 0, restored.stdout + restored.stderr
        assert "Restore test passed" in restored.stdout and "company" in restored.stdout
        # Never into the live database.
        refused = run(sys.executable, "scripts/restore_check.py", RESTORE_DATABASE_URL=source)
        assert refused.returncode != 0 and "live database" in refused.stderr
    finally:
        with admin.connect() as connection:
            for name in names:
                connection.execute(text(f"drop database if exists {name} with (force)"))
        admin.dispose()


def test_on_render_the_address_comes_from_the_host(environment):
    environment.setenv("APP_ENV", "staging")
    environment.delenv("APP_URL")
    environment.delenv("CORS_ORIGINS")
    environment.setenv("RENDER_EXTERNAL_URL", "https://mechanicpro.onrender.com")
    config = build_config()
    assert config["APP_URL"] == "https://mechanicpro.onrender.com" and config["CORS_ORIGINS"] == ["https://mechanicpro.onrender.com"]


def test_error_reports_leave_out_personal_data(tmp_path, monkeypatch):
    import sentry_sdk

    sent = {}
    monkeypatch.setattr(sentry_sdk, "init", lambda **options: sent.update(options))
    create_app({"SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'sentry.db'}", "TESTING": True, "SENTRY_DSN": "https://key@o1.ingest.sentry.io/1"})
    assert sent["dsn"] == "https://key@o1.ingest.sentry.io/1" and sent["release"] == "dev"
    assert sent["send_default_pii"] is False and sent["max_request_body_size"] == "never" and sent["include_local_variables"] is False
