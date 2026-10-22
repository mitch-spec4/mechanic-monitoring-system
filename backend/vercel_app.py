"""Entry point for the temporary Vercel demo deployment. Not a production setup.

The frontend and this API share one HTTPS address (vercel.json routes /api here), so the
session cookies work. On a cold start it brings the database schema up to date and, when
DEMO_SEED=1 and the database is empty, loads the demo data. A PostgreSQL advisory lock
keeps two instances starting at once from migrating or seeding together.
"""
import os
import runpy
from pathlib import Path

from flask_migrate import upgrade
from sqlalchemy import text

from app import create_app, db
from app.models import Company

HERE = Path(__file__).resolve().parent
LOCK_ID = 727001

app = create_app(
    {
        # Secure cookies over HTTPS even though the demo runs with APP_ENV=development.
        "JWT_COOKIE_SECURE": True,
        # Serverless instances sit idle; check pooled connections before using them.
        "SQLALCHEMY_ENGINE_OPTIONS": {"pool_pre_ping": True, "pool_recycle": 240},
    }
)


def prepare_database():
    with app.app_context():
        with db.engine.connect() as lock:
            lock.execute(text("SELECT pg_advisory_lock(:id)"), {"id": LOCK_ID})
            try:
                upgrade(directory=str(HERE / "migrations"))
                empty = Company.query.first() is None
                db.session.remove()
                if empty and os.getenv("DEMO_SEED") == "1":
                    runpy.run_path(str(HERE / "seed.py"), run_name="seed")
            finally:
                lock.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": LOCK_ID})
                lock.commit()


prepare_database()
