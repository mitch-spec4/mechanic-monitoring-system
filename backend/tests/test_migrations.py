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
