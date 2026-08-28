from flask import Flask
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
import os

db=SQLAlchemy(); jwt=JWTManager()
def create_app():
    load_dotenv(); app=Flask(__name__)
    app.config["SECRET_KEY"]=os.getenv("SECRET_KEY","dev-secret")
    app.config["JWT_SECRET_KEY"]=os.getenv("JWT_SECRET_KEY","jwt-dev-secret")
    app.config["SQLALCHEMY_DATABASE_URI"]=os.getenv("DATABASE_URL","sqlite:///mechanic_pro.db")
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"]=False
    db.init_app(app);jwt.init_app(app);CORS(app)
    from app.routes.auth import bp as auth
    from app.routes.jobs import bp as jobs
    from app.routes.customers import bp as customers
    from app.routes.machines import bp as machines
    from app.routes.services import bp as services
    from app.routes.notifications import bp as notifications
    from app.routes.reviews import bp as reviews
    from app.routes.users import bp as users
    from app.routes.reports import bp as reports
    app.register_blueprint(auth,url_prefix="/api/auth");app.register_blueprint(jobs,url_prefix="/api/jobs");app.register_blueprint(customers,url_prefix="/api/customers");app.register_blueprint(machines,url_prefix="/api/machines");app.register_blueprint(services,url_prefix="/api/services");app.register_blueprint(notifications,url_prefix="/api/notifications");app.register_blueprint(reviews,url_prefix="/api/reviews");app.register_blueprint(users,url_prefix="/api/users");app.register_blueprint(reports,url_prefix="/api/reports")
    with app.app_context(): db.create_all()
    @app.get("/api/health")
    def health():return {"status":"ok"}
    return app
