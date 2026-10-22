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
