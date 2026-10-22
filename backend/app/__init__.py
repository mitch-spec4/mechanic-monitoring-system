import os
from datetime import timedelta

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

    if is_production:
        problems = []
        for name, value in (("SECRET_KEY", secret_key), ("JWT_SECRET_KEY", jwt_secret_key)):
            if len(value) < 32 or value in PLACEHOLDER_SECRETS:
                problems.append(f"{name} must be a random value of at least 32 characters")
        if not origins or "*" in origins:
            problems.append("CORS_ORIGINS must list your frontend origin(s); '*' is not allowed")
        if not database_url:
            problems.append("DATABASE_URL must be set")
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
        "TRUSTED_PROXY_COUNT": int(os.getenv("TRUSTED_PROXY_COUNT", "0")),
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

    CORS(app, origins=app.config["CORS_ORIGINS"], supports_credentials=True)
    db.init_app(app)
    jwt.init_app(app)
    migrate.init_app(app, db, render_as_batch=True)

    from app import models  # noqa: F401  (register models for migrations)
    from app.routes.auth import bp as auth
    from app.routes.checklists import bp as checklists
    from app.routes.company import bp as company
    from app.routes.customers import bp as customers
    from app.routes.jobs import bp as jobs
    from app.routes.machines import bp as machines
    from app.routes.notifications import bp as notifications
    from app.routes.reports import bp as reports
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
    app.register_blueprint(machines, url_prefix="/api/machines")
    app.register_blueprint(services, url_prefix="/api/services")
    app.register_blueprint(notifications, url_prefix="/api/notifications")
    app.register_blueprint(reviews, url_prefix="/api/reviews")
    app.register_blueprint(users, url_prefix="/api/users")
    app.register_blueprint(reports, url_prefix="/api/reports")
    app.register_blueprint(shifts, url_prefix="/api/shifts")
    app.register_blueprint(location, url_prefix="/api/location")

    @app.cli.command("purge-locations")
    def purge_locations():
        """Delete live positions older than 30 days (run daily in production)."""
        from app.services.location import purge_old_live_points

        removed = purge_old_live_points()
        db.session.commit()
        print(f"Removed {removed} live location point(s) older than 30 days.")

    register_error_handlers(app)
    if not app.config.get("TESTING") and not app.config["IS_PRODUCTION"]:
        check_schema(app)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

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
    from app.utils.validation import ValidationError

    @app.errorhandler(ValidationError)
    def validation_error(error):
        db.session.rollback()
        return jsonify(error=error.message), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.description), error.code

    @app.errorhandler(Exception)
    def unexpected_error(error):
        db.session.rollback()
        app.logger.exception("Unhandled error")
        return jsonify(error="Something went wrong. Please try again."), 500

    @jwt.expired_token_loader
    def expired(_header, _payload):
        return jsonify(error="Your session has expired. Please sign in again."), 401

    @jwt.invalid_token_loader
    def invalid(reason):
        return jsonify(error="Invalid session. Please sign in again."), 401

    @jwt.unauthorized_loader
    def missing(reason):
        return jsonify(error="Please sign in to continue."), 401
