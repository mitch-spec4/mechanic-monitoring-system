import os
from datetime import timedelta

import click
from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import MetaData, event, inspect
from sqlalchemy.engine import Engine
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

# Named constraints keep future migrations portable between SQLite and Postgres.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

db = SQLAlchemy(metadata=MetaData(naming_convention=NAMING_CONVENTION))
jwt = JWTManager()
migrate = Migrate()

DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
PLACEHOLDER_SECRETS = {"change-me", "change-this-too", "replace-with-a-long-random-value"}


@event.listens_for(Engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, _record):
    # SQLite ignores foreign keys unless asked; enforce them so local behaviour matches Postgres.
    if dbapi_connection.__class__.__module__.startswith("sqlite3"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def normalize_database_url(url):
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def _minutes(name, default):
    return timedelta(minutes=int(os.getenv(name, default)))


def build_config():
    """Read settings from the environment. Production (the default) fails closed."""
    env = os.getenv("APP_ENV", "production").strip().lower()
    is_production = env not in {"development", "test"}

    secret_key = os.getenv("SECRET_KEY", "")
    jwt_secret_key = os.getenv("JWT_SECRET_KEY", "")
    origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "").split(",") if origin.strip()]
    database_url = os.getenv("DATABASE_URL", "")
    app_url = os.getenv("APP_URL", "").strip().rstrip("/")
    email_backend = os.getenv("EMAIL_BACKEND", "smtp" if is_production else "log").strip().lower()
    email_from = os.getenv("EMAIL_FROM", "").strip()
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    test_outbox = os.getenv("TEST_OUTBOX") == "1"

    if is_production:
        problems = []
        for name, value in (("SECRET_KEY", secret_key), ("JWT_SECRET_KEY", jwt_secret_key)):
            if len(value) < 32 or value in PLACEHOLDER_SECRETS:
                problems.append(f"{name} must be a random value of at least 32 characters")
        if not origins or "*" in origins:
            problems.append("CORS_ORIGINS must list your frontend origin(s); '*' is not allowed")
        if not database_url:
            problems.append("DATABASE_URL must be set")
        if not app_url.startswith("https://"):
            problems.append("APP_URL must be the https:// address of your site (it goes into links in emails)")
        if email_backend != "smtp" or not smtp_host or not email_from:
            problems.append("Email must be set up: EMAIL_BACKEND=smtp with SMTP_HOST and EMAIL_FROM (see SETUP.md, Email)")
        if test_outbox:
            problems.append("TEST_OUTBOX is only for the browser tests")
        if problems:
            raise RuntimeError(
                "Refusing to start in production mode (set APP_ENV=development for local work):\n- "
                + "\n- ".join(problems)
            )
    else:
        secret_key = secret_key or "local-development-secret-not-for-production"
        jwt_secret_key = jwt_secret_key or "local-development-jwt-secret-not-for-production"
        origins = origins or DEV_ORIGINS
        database_url = database_url or "sqlite:///mechanic_pro.db"
        app_url = app_url or origins[0].rstrip("/")
        email_from = email_from or "MechanicPro <no-reply@mechanicpro.test>"

    return {
        "APP_ENV": env,
        "IS_PRODUCTION": is_production,
        "SECRET_KEY": secret_key,
        "JWT_SECRET_KEY": jwt_secret_key,
        "JWT_ACCESS_TOKEN_EXPIRES": _minutes("JWT_ACCESS_MINUTES", 30),
        "JWT_REFRESH_TOKEN_EXPIRES": _minutes("JWT_REFRESH_MINUTES", 60 * 24 * 7),
        "SQLALCHEMY_DATABASE_URI": normalize_database_url(database_url),
        "SQLALCHEMY_TRACK_MODIFICATIONS": False,
        "CORS_ORIGINS": origins,
        "LOGIN_RATE_LIMIT": os.getenv("LOGIN_RATE_LIMIT", "10 per minute;50 per hour"),
        # Account emails (verification, password reset) one address can be sent.
        "EMAIL_RATE_LIMIT": os.getenv("EMAIL_RATE_LIMIT", "1 per minute;5 per hour"),
        # "Try the demo": private demo companies one visitor (IP address) can start.
        "DEMO_RATE_LIMIT": os.getenv("DEMO_RATE_LIMIT", "10 per hour"),
        # "Export my data": a whole company's data in one ZIP, so not too often.
        "EXPORT_RATE_LIMIT": os.getenv("EXPORT_RATE_LIMIT", "3 per hour"),
        # The public address of the web app, used in links inside emails.
        "APP_URL": app_url,
        # Email: "log" writes emails to the server log (development); "smtp" sends them (production).
        "EMAIL_BACKEND": email_backend,
        "EMAIL_FROM": email_from,
        "SMTP_HOST": smtp_host,
        "SMTP_PORT": int(os.getenv("SMTP_PORT", "587")),
        "SMTP_USERNAME": os.getenv("SMTP_USERNAME", ""),
        "SMTP_PASSWORD": os.getenv("SMTP_PASSWORD", ""),
        "SMTP_SECURITY": os.getenv("SMTP_SECURITY", "starttls").strip().lower(),
        # Lets the browser tests read the emails the app "sent" in log mode. Refused in production.
        "TEST_OUTBOX": test_outbox,
        # Protects /api/cron/daily, the daily clean-up a scheduler calls. Unset: the URL doesn't exist.
        "CRON_SECRET": os.getenv("CRON_SECRET", ""),
        "TRUSTED_PROXY_COUNT": int(os.getenv("TRUSTED_PROXY_COUNT", "0")),
        # Photos, videos and signatures: "local" disk (development) or "s3" (any S3-compatible
        # bucket: Cloudflare R2, Backblaze B2, AWS S3...). See SETUP.md.
        "STORAGE_BACKEND": os.getenv("STORAGE_BACKEND", "local").strip().lower(),
        "STORAGE_LOCAL_DIR": os.getenv("STORAGE_LOCAL_DIR", ""),
        "S3_BUCKET": os.getenv("S3_BUCKET", ""),
        "S3_ENDPOINT_URL": os.getenv("S3_ENDPOINT_URL", ""),
        "S3_REGION": os.getenv("S3_REGION", "auto"),
        "S3_ACCESS_KEY_ID": os.getenv("S3_ACCESS_KEY_ID", ""),
        "S3_SECRET_ACCESS_KEY": os.getenv("S3_SECRET_ACCESS_KEY", ""),
        "MAX_PHOTO_MB": int(os.getenv("MAX_PHOTO_MB", "10")),
        "MAX_VIDEO_MB": int(os.getenv("MAX_VIDEO_MB", "50")),
        "MAX_DOCUMENT_MB": int(os.getenv("MAX_DOCUMENT_MB", "25")),
        "MAX_VIDEO_SECONDS": int(os.getenv("MAX_VIDEO_SECONDS", "60")),
        # Taking payment for plans: "test" (a pretend card page, development only) or "none"
        # (free trials only) until a real provider is connected. See SETUP.md.
        "BILLING_PROVIDER": os.getenv("BILLING_PROVIDER", "none" if is_production else "test").strip().lower(),
        # Two-step sign-in for everyone (demo copies excepted). Only the API tests turn it off.
        "TWO_FACTOR_REQUIRED": os.getenv("TWO_FACTOR_REQUIRED", "1") != "0" or is_production,
        # Sessions live in httpOnly cookies (unreadable by page scripts), with CSRF protection
        # on every state-changing request. Headers are also accepted for API clients and tests.
        "JWT_TOKEN_LOCATION": ["headers", "cookies"],
        "JWT_COOKIE_SECURE": is_production,
        "JWT_COOKIE_SAMESITE": "Lax",
        "JWT_COOKIE_CSRF_PROTECT": True,
        "JWT_ACCESS_COOKIE_PATH": "/api/",
        "JWT_REFRESH_COOKIE_PATH": "/api/auth/",
        "JWT_SESSION_COOKIE": False,
    }


def create_app(overrides=None):
    load_dotenv()
    app = Flask(__name__)
    app.config.update(build_config())
    if overrides:
        app.config.update(overrides)

    if app.config["TRUSTED_PROXY_COUNT"]:
        # Behind a load balancer: take the client IP (used for rate limiting) from X-Forwarded-For.
        count = app.config["TRUSTED_PROXY_COUNT"]
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=count, x_proto=count, x_host=count)

    from app.services.billing import init_billing
    from app.services.email import init_email
    from app.services.storage import init_storage

    init_storage(app)
    init_billing(app)
    init_email(app)
    CORS(app, origins=app.config["CORS_ORIGINS"], supports_credentials=True)
    db.init_app(app)
    jwt.init_app(app)
    migrate.init_app(app, db, render_as_batch=True)
    from app.services.sync import init_sync

    init_sync(app)

    from app import models  # noqa: F401  (register models for migrations)
    from app.routes.auth import bp as auth
    from app.routes.billing import bp as billing
    from app.routes.checklists import bp as checklists
    from app.routes.company import bp as company
    from app.routes.customers import bp as customers
    from app.routes.demo import bp as demo
    from app.routes.equipment import bp as equipment
    from app.routes.jobs import bp as jobs
    from app.routes.maintenance import bp as maintenance
    from app.routes.legal import bp as legal
    from app.routes.machines import bp as machines
    from app.routes.media import bp as media
    from app.routes.messages import bp as messages
    from app.routes.notifications import bp as notifications
    from app.routes.reports import bp as reports
    from app.routes.requests import bp as requests
    from app.routes.reviews import bp as reviews
    from app.routes.services import bp as services
    from app.routes.shifts import bp as shifts
    from app.routes.shifts import location_bp as location
    from app.routes.users import bp as users
    from app.routes.worksheet import bp as worksheet

    app.register_blueprint(auth, url_prefix="/api/auth")
    app.register_blueprint(company, url_prefix="/api/company")
    app.register_blueprint(jobs, url_prefix="/api/jobs")
    app.register_blueprint(worksheet, url_prefix="/api/jobs")
    app.register_blueprint(checklists, url_prefix="/api/checklists")
    app.register_blueprint(customers, url_prefix="/api/customers")
    app.register_blueprint(requests, url_prefix="/api/customers/requests")
    app.register_blueprint(messages, url_prefix="/api/messages")
    app.register_blueprint(machines, url_prefix="/api/machines")
    app.register_blueprint(services, url_prefix="/api/services")
    app.register_blueprint(notifications, url_prefix="/api/notifications")
    app.register_blueprint(reviews, url_prefix="/api/reviews")
    app.register_blueprint(users, url_prefix="/api/users")
    app.register_blueprint(reports, url_prefix="/api/reports")
    app.register_blueprint(media, url_prefix="/api")
    app.register_blueprint(equipment, url_prefix="/api")
    app.register_blueprint(shifts, url_prefix="/api/shifts")
    app.register_blueprint(location, url_prefix="/api/location")
    app.register_blueprint(billing, url_prefix="/api")
    app.register_blueprint(demo, url_prefix="/api/demo")
    app.register_blueprint(maintenance, url_prefix="/api/cron")
    app.register_blueprint(legal, url_prefix="/api/legal")

    @app.cli.command("purge-locations")
    def purge_locations():
        """Delete live positions older than 30 days (run daily in production)."""
        from app.services.location import purge_old_live_points

        removed = purge_old_live_points()
        db.session.commit()
        print(f"Removed {removed} live location point(s) older than 30 days.")

    @app.cli.command("purge-uploads")
    def purge_uploads():
        """Delete uploads that were started but never confirmed within a day (run daily)."""
        from app.services.media import purge_abandoned_uploads

        removed = purge_abandoned_uploads()
        db.session.commit()
        print(f"Removed {removed} abandoned upload(s).")

    @app.cli.command("purge-demos")
    def purge_demos():
        """Delete "Try the demo" companies whose 24 hours are up (run daily)."""
        from app.services.demo import purge_expired

        print(f"Removed {purge_expired()} expired demo company(ies).")

    @app.cli.command("reset-2fa")
    @click.argument("email")
    def reset_2fa(email):
        """Turn off someone's two-step sign-in so they set it up again at their next sign-in.
        For a boss who lost their phone and their backup codes; check who is asking first."""
        from app.models.user import User
        from app.services import audit, two_factor

        user = User.query.filter_by(email=email.strip().lower()).first()
        if not user:
            raise click.ClickException(f"No account uses {email}.")
        two_factor.disable(user)
        user.token_version = (user.token_version or 0) + 1
        audit.record("two_factor_reset", user=user, detail="server command")
        db.session.commit()
        print(f"Two-step sign-in is off for {user.email}; they will set it up again when they sign in.")

    @app.cli.command("delete-due-companies")
    def delete_due_companies():
        """Delete companies whose 30 days after "Delete my company" are up (run daily)."""
        from app.services.company_data import delete_due_companies as run

        print(f"Deleted {run()} company(ies).")

    @app.cli.command("purge-sync-requests")
    def purge_sync_requests():
        """Forget queued changes answered more than 30 days ago (run daily)."""
        from app.services.sync import purge_old_requests

        removed = purge_old_requests()
        db.session.commit()
        print(f"Removed {removed} remembered change(s) older than 30 days.")

    @app.cli.command("send-reminders")
    def send_reminders():
        """Visit reminders for tomorrow, "book the repair" reminders and follow-ups (run daily)."""
        from app.services.booking import send_reminders as run

        sent = run()
        db.session.commit()
        print(
            f"Sent {sent['visit_reminders']} visit reminder(s), {sent['repair_reminders']} repair reminder(s) "
            f"and {sent['follow_ups']} follow-up(s)."
        )

    @app.cli.command("send-service-due")
    def send_service_due():
        """Planned maintenance coming due: its job, and the reminders (run daily)."""
        from app.services.equipment import send_due_reminders

        sent = send_due_reminders()
        db.session.commit()
        print(f"Created {sent['maintenance_jobs']} maintenance job(s) and sent {sent['service_due_reminders']} service-due reminder(s).")

    @app.cli.command("purge-activity")
    def purge_activity():
        """Delete activity log entries older than 12 months (run daily)."""
        from app.services.audit import purge_old_events

        removed = purge_old_events()
        db.session.commit()
        print(f"Removed {removed} activity log entr(ies).")

    if app.config["TEST_OUTBOX"]:

        @app.get("/api/test/outbox")
        def test_outbox():
            """The emails written to the log, newest first, so the browser tests can open their links."""
            from app.services.email import mailer

            messages = reversed(getattr(mailer(), "outbox", []))
            return {"emails": [{"to": m["To"], "subject": m["Subject"], "text": m.get_body(("plain",)).get_content()} for m in messages]}

    register_error_handlers(app)
    if not app.config.get("TESTING") and not app.config["IS_PRODUCTION"]:
        check_schema(app)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.after_request
    def never_cache_api_data(response):
        # Personal data stays out of the browser's cache. That also keeps a browser that is offline
        # (Firefox serves its cache then) from passing an old answer off as the server's: the
        # technician's app keeps its own copy (frontend/src/offline).
        if response.mimetype == "application/json" and "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "no-store"
        return response

    return app


def check_schema(app):
    """Stop early with a clear message when the database predates migrations."""
    with app.app_context():
        tables = set(inspect(db.engine).get_table_names())
    if tables and "alembic_version" not in tables:
        raise RuntimeError(
            "This database was created by an older version of MechanicPro without migrations. "
            "For local development, delete backend/instance/mechanic_pro.db and run `python seed.py` again."
        )
    if not tables:
        app.logger.warning("Database is empty. Run `flask --app run.py db upgrade` (or `python seed.py` locally).")


def register_error_handlers(app):
    from app.i18n import N_, _
    from app.utils.validation import ValidationError

    # Werkzeug's own error texts are long and English-only; the common ones get a short, translated text.
    http_messages = {401: N_("Please sign in to continue."), 403: N_("Forbidden"), 404: N_("Not found.")}

    @app.errorhandler(ValidationError)
    def validation_error(error):
        db.session.rollback()
        return jsonify(error=error.message, **error.extra), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        message = http_messages.get(error.code)
        return jsonify(error=_(message) if message else error.description), error.code

    @app.errorhandler(Exception)
    def unexpected_error(error):
        db.session.rollback()
        app.logger.exception("Unhandled error")
        return jsonify(error=_("Something went wrong. Please try again.")), 500

    @jwt.expired_token_loader
    def expired(_header, _payload):
        return jsonify(error=_("Your session has expired. Please sign in again.")), 401

    @jwt.invalid_token_loader
    def invalid(reason):
        return jsonify(error=_("Invalid session. Please sign in again.")), 401

    @jwt.unauthorized_loader
    def missing(reason):
        return jsonify(error=_("Please sign in to continue.")), 401
