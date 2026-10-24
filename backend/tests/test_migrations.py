import sqlite3

from flask_migrate import upgrade

from app import create_app


def test_migrations_build_the_schema(tmp_path):
    path = tmp_path / "migrated.db"
    app = create_app({"SQLALCHEMY_DATABASE_URI": f"sqlite:///{path}"})
    with app.app_context():
        upgrade(directory=str(__import__("pathlib").Path(__file__).resolve().parents[1] / "migrations"))
    tables = {row[0] for row in sqlite3.connect(path).execute("select name from sqlite_master where type='table'")}
    assert {"company", "user", "customer", "machine", "job", "service_record", "review", "service_request", "notification", "invitation"} <= tables


def test_legacy_database_without_migrations_gets_clear_error(tmp_path):
    import pytest

    path = tmp_path / "legacy.db"
    sqlite3.connect(path).execute("create table user (id integer primary key)")
    with pytest.raises(RuntimeError, match="older version"):
        create_app({"SQLALCHEMY_DATABASE_URI": f"sqlite:///{path}"})


def test_upgrading_a_database_that_already_has_data(tmp_path):
    """Every migration must apply on top of real data, not just an empty database."""
    from pathlib import Path

    path = tmp_path / "existing.db"
    migrations = str(Path(__file__).resolve().parents[1] / "migrations")
    app = create_app({"SQLALCHEMY_DATABASE_URI": f"sqlite:///{path}"})
    with app.app_context():
        upgrade(directory=migrations, revision="0001_initial_schema")
    db = sqlite3.connect(path)
    db.executescript(
        """
        insert into company (id, name) values (1, 'Acme');
        insert into customer (id, name, email, company_id) values (1, 'Cust', 'c@x.test', 1);
        insert into user (id, name, email, password_hash, role, company_id, token_version)
            values (1, 'Mech', 'm@x.test', 'x', 'mechanic', 1, 0);
        insert into machine (id, name, serial_no, customer_id, company_id, status) values (1, 'Gen', 'S1', 1, 1, 'Operational');
        insert into job (id, title, description, priority, status, company_id, customer_id, machine_id, mechanic_id, created_at)
            values (1, 'Fix', 'Broken', 'Medium', 'Completed', 1, 1, 1, 1, '2026-01-01');
        insert into service_record (id, machine_id, customer_id, mechanic_id, company_id, service_type, service_date)
            values (1, 1, 1, 1, 1, 'Repair', '2026-01-01');
        insert into review (id, customer_id, mechanic_id, machine_id, company_id, service_record_id, rating, created_at)
            values (1, 1, 1, 1, 1, 1, 5, '2026-01-02');
        insert into service_request (id, customer_id, company_id, machine_id, subject, description, priority, status, created_at)
            values (1, 1, 1, 1, 'Noise', 'Loud', 'Medium', 'Reviewing', '2026-01-03'),
                   (2, 1, 1, 1, 'Leak', 'Drips', 'Medium', 'Completed', '2026-01-04');
        """
    )
    db.commit()
    db.close()
    with app.app_context():
        upgrade(directory=migrations)
    db = sqlite3.connect(path)
    assert db.execute("select count(*) from review").fetchone() == (1,)
    assert db.execute("select job_id from service_record").fetchone() == (None,)
    assert db.execute("pragma foreign_key_check").fetchall() == []
    # Requests at the old hand-set steps wait for the customer to book a visit.
    assert db.execute("select status from service_request order by id").fetchall() == [("Submitted",), ("Completed",)]
    # Companies from before plans existed get the largest plan with no end date.
    assert db.execute("select company_id, plan, status, current_period_end from subscription").fetchall() == [(1, "business", "active", None)]
    # People from before email verification count as confirmed, and the setup guide is for new companies only.
    assert db.execute("select email_verified_at is not null from user").fetchall() == [(1,)]
    assert db.execute("select setup_dismissed_at is not null, demo_expires_at from company").fetchall() == [(1, None)]


def test_migrations_roll_back_and_forward(tmp_path):
    """A deploy can be undone: every migration downgrades and upgrades again cleanly."""
    from pathlib import Path

    from flask_migrate import downgrade

    path = tmp_path / "rollback.db"
    migrations = str(Path(__file__).resolve().parents[1] / "migrations")
    app = create_app({"SQLALCHEMY_DATABASE_URI": f"sqlite:///{path}"})
    with app.app_context():
        upgrade(directory=migrations)
        downgrade(directory=migrations, revision="base")
        upgrade(directory=migrations)
    assert sqlite3.connect(path).execute("select version_num from alembic_version").fetchone() == ("0012_booking",)


def test_the_old_team_plan_becomes_professional(tmp_path):
    """Databases that ran the first version of plans name the middle plan "team"."""
    from pathlib import Path

    path = tmp_path / "team.db"
    migrations = str(Path(__file__).resolve().parents[1] / "migrations")
    app = create_app({"SQLALCHEMY_DATABASE_URI": f"sqlite:///{path}"})
    with app.app_context():
        upgrade(directory=migrations, revision="0005_billing")
    db = sqlite3.connect(path)
    db.executescript(
        """
        insert into company (id, name) values (1, 'Acme'), (2, 'Bolt');
        insert into user (id, name, email, password_hash, role, company_id, token_version)
            values (1, 'Boss', 'b@x.test', 'x', 'boss', 1, 0);
        insert into subscription (company_id, plan, interval, status, created_at, updated_at)
            values (1, 'team', 'month', 'trialing', '2026-10-01', '2026-10-01'),
                   (2, 'starter', 'year', 'active', '2026-10-01', '2026-10-01');
        insert into payment (company_id, user_id, plan, interval, amount_cents, currency, provider, reference, status, created_at)
            values (1, 1, 'team', 'month', 4900, 'USD', 'test', 'pay_old', 'paid', '2026-10-02');
        """
    )
    db.commit()
    db.close()
    with app.app_context():
        upgrade(directory=migrations)
    db = sqlite3.connect(path)
    assert db.execute("select company_id, plan from subscription order by company_id").fetchall() == [(1, "professional"), (2, "starter")]
    # Past payments keep what was charged; only the plan's name changes.
    assert db.execute("select plan, amount_cents, currency from payment").fetchall() == [("professional", 4900, "USD")]
