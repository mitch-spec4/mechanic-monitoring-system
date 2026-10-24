"""Load the demo company for local development. Refuses to run in production.

The data itself lives in app/services/demo.py, shared with "Try the demo". Here every account gets
the same password, which is why this script must never run in production.
"""
from flask_migrate import upgrade

from app import create_app, db
from app.models import Company, User
from app.services import two_factor
from app.services.legal import record_agreement
from app.utils.time import utcnow
from app.services.demo import populate

DEMO_PASSWORD = "password"
# Every demo account's two-step sign-in key: add it to an authenticator app (Google Authenticator,
# Microsoft Authenticator...) as "MechanicPro demo" to get the codes. Local development only.
DEMO_TOTP_SECRET = "MECHANICPRODEMO2"
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
        db.session.flush()
        for user in User.query.filter_by(company_id=company.id):
            user.totp_secret = two_factor.encrypt_secret(DEMO_TOTP_SECRET)
            user.totp_enabled_at = utcnow()
            record_agreement(user)
        db.session.commit()
        print(
            "Demo data ready: 3 customers with 4 sites, 3 mechanics, 6 machines (2 with maintenance plans, 1 with a repeat fault), 8 jobs with worksheets and history (2 of them visits "
            "customers booked), 3 checklists, shifts and locations, 7 service records, 3 reviews, 3 requests, a customer chat, "
            "notifications, and a paid Professional plan."
        )
