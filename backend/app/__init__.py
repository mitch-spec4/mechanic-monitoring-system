import os

from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
jwt = JWTManager()


def create_app():
    load_dotenv()
    app = Flask(__name__)
    is_production = os.getenv("APP_ENV", "development").lower() == "production"

    secret_key = os.getenv("SECRET_KEY")
    jwt_secret_key = os.getenv("JWT_SECRET_KEY")
    if is_production and (not secret_key or not jwt_secret_key):
        raise RuntimeError("SECRET_KEY and JWT_SECRET_KEY must be set in production.")

    app.config["SECRET_KEY"] = secret_key or "dev-secret-change-before-deployment"
    app.config["JWT_SECRET_KEY"] = jwt_secret_key or "jwt-dev-secret-change-before-deployment"
    database_url = os.getenv("DATABASE_URL", "sqlite:///mechanic_pro.db")
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    app.config["SQLALCHEMY_DATABASE_URI"] = database_url
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    configured_origins = os.getenv("CORS_ORIGINS", "").strip()
    if is_production and not configured_origins:
        raise RuntimeError("Set CORS_ORIGINS to your deployed frontend origin in production.")
    origins = [origin.strip() for origin in configured_origins.split(",") if origin.strip()]
    CORS(app, origins=origins if origins else "*")

    db.init_app(app)
    jwt.init_app(app)

    from app.routes.auth import bp as auth
    from app.routes.jobs import bp as jobs
    from app.routes.customers import bp as customers
    from app.routes.machines import bp as machines
    from app.routes.services import bp as services
    from app.routes.notifications import bp as notifications
    from app.routes.reviews import bp as reviews
    from app.routes.users import bp as users
    from app.routes.reports import bp as reports

    app.register_blueprint(auth, url_prefix="/api/auth")
    app.register_blueprint(jobs, url_prefix="/api/jobs")
    app.register_blueprint(customers, url_prefix="/api/customers")
    app.register_blueprint(machines, url_prefix="/api/machines")
    app.register_blueprint(services, url_prefix="/api/services")
    app.register_blueprint(notifications, url_prefix="/api/notifications")
    app.register_blueprint(reviews, url_prefix="/api/reviews")
    app.register_blueprint(users, url_prefix="/api/users")
    app.register_blueprint(reports, url_prefix="/api/reports")

    with app.app_context():
        db.create_all()

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    return app
