import os
import sys
from datetime import date

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["APP_ENV"] = "test"

from app import create_app, db, normalize_database_url  # noqa: E402
from app.models import Company, Customer, Job, Machine, ServiceRecord, Shift, User  # noqa: E402
from app.utils.time import utcnow  # noqa: E402

PASSWORD = "correct-horse-battery"
# A real 1x1 PNG, as the signature pad sends it.
SIGNATURE_PNG = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)
# Completing a job needs the customer's sign-off.
SIGNED = {"signature": {"name": "Jane Customer", "image": SIGNATURE_PNG}}


@pytest.fixture
def app(tmp_path):
    # TEST_DATABASE_URL runs the suite against another database (CI uses PostgreSQL); its
    # tables are dropped and recreated for every test.
    database_url = normalize_database_url(os.getenv("TEST_DATABASE_URL") or f"sqlite:///{tmp_path / 'test.db'}")
    app = create_app(
        {
            "SQLALCHEMY_DATABASE_URI": database_url,
            "RATELIMIT_ENABLED": False,
            "TESTING": True,
            "STORAGE_LOCAL_DIR": str(tmp_path / "uploads"),
        }
    )
    with app.app_context():
        db.drop_all()
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


def make_user(name, email, role, company, customer=None):
    user = User(name=name, email=email, role=role, company_id=company.id, customer_id=customer.id if customer else None)
    user.set_password(PASSWORD)
    db.session.add(user)
    db.session.flush()
    return user


@pytest.fixture
def data(app):
    """Two companies so every test can check that data never crosses between them."""
    acme = Company(name="Acme Service")
    other = Company(name="Other Co")
    db.session.add_all([acme, other])
    db.session.flush()

    acme_customer = Customer(name="Acme Customer", email="cust@acme.test", company_id=acme.id)
    other_customer = Customer(name="Other Customer", email="cust@other.test", company_id=other.id)
    db.session.add_all([acme_customer, other_customer])
    db.session.flush()

    boss = make_user("Boss One", "boss@acme.test", "boss", acme)
    boss2 = make_user("Boss Two", "boss2@acme.test", "boss", acme)
    mechanic = make_user("Mech One", "mech@acme.test", "mechanic", acme)
    mechanic2 = make_user("Mech Two", "mech2@acme.test", "mechanic", acme)
    customer = make_user("Acme Customer", "cust@acme.test", "customer", acme, acme_customer)
    other_boss = make_user("Other Boss", "boss@other.test", "boss", other)
    other_mechanic = make_user("Other Mech", "mech@other.test", "mechanic", other)

    machine = Machine(name="Generator", serial_no="SN-1", customer_id=acme_customer.id, company_id=acme.id)
    other_machine = Machine(name="Pump", serial_no="SN-OTHER", customer_id=other_customer.id, company_id=other.id)
    db.session.add_all([machine, other_machine])
    db.session.flush()

    job = Job(
        title="Fix generator",
        description="Overheats",
        company_id=acme.id,
        customer_id=acme_customer.id,
        machine_id=machine.id,
        mechanic_id=mechanic.id,
        status="Assigned",
        due_date=date(2026, 9, 1),
    )
    record = ServiceRecord(
        machine_id=machine.id,
        customer_id=acme_customer.id,
        mechanic_id=mechanic.id,
        company_id=acme.id,
        service_type="Repair",
    )
    db.session.add_all([job, record])
    # Mech One starts the day clocked in (with location consent) so job tests can start work;
    # Mech Two is clocked out. test_location.py covers clocking in and out.
    mechanic.location_consent_at = utcnow()
    db.session.add(Shift(company_id=acme.id, user_id=mechanic.id, clocked_in_at=utcnow()))
    db.session.commit()
    return {
        "acme": acme.id,
        "other": other.id,
        "acme_customer": acme_customer.id,
        "other_customer": other_customer.id,
        "boss": boss.id,
        "boss2": boss2.id,
        "mechanic": mechanic.id,
        "mechanic2": mechanic2.id,
        "customer": customer.id,
        "other_boss": other_boss.id,
        "other_mechanic": other_mechanic.id,
        "machine": machine.id,
        "other_machine": other_machine.id,
        "job": job.id,
        "record": record.id,
    }


def login(client, email, password=PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


@pytest.fixture
def auth(client, data):
    """Bearer headers for a user. Browsers use cookies; headers keep API tests independent."""
    from app.routes.auth import access_token_for

    def headers(email):
        user = User.query.filter_by(email=email).one()
        return {"Authorization": f"Bearer {access_token_for(user)}"}

    return headers


def cookie(client, name):
    paths = {"access_token_cookie": "/api/", "refresh_token_cookie": "/api/auth/"}
    found = client.get_cookie(name, path=paths.get(name, "/"))
    return found.value if found else None
