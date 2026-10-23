"""Load the demo company for local development. Refuses to run in production.

The data itself lives in app/services/demo.py, shared with "Try the demo". Here every account gets
the same password, which is why this script must never run in production.
"""
from flask_migrate import upgrade

from app import create_app, db
from app.models import Company, User
from app.services.demo import populate

DEMO_PASSWORD = "password"
BOSS_EMAIL = "james@mechanicpro.test"

app = create_app()
if app.config["IS_PRODUCTION"]:
    raise SystemExit("seed.py creates demo accounts with a shared password and must not run in production.")

with app.app_context():
    upgrade()
    if User.query.filter_by(email=BOSS_EMAIL).first():
        print("Demo data is already loaded.")
    else:
        company = Company(name="DK Engineering", location="Nairobi")
        db.session.add(company)
        db.session.flush()
        populate(company, password=DEMO_PASSWORD)
        db.session.commit()
        print(
            "Demo data ready: 3 customers, 3 mechanics, 6 machines, 6 jobs with worksheets and history, 3 checklists, "
            "shifts and locations, 6 service records, 3 reviews, 3 requests, notifications, and a paid Professional plan."
        )
