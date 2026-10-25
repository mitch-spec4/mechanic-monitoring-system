"""The restore test: bring a backup back into a scratch database and check it's whole and usable.

Usage (from backend/): python scripts/restore_check.py [FILE]
  FILE is a backup from scripts/backup.py; without it, the newest one in BACKUP_BUCKET (same
  settings as backup.py) or, with no bucket, in BACKUP_DIR (default backups/).

Needs RESTORE_DATABASE_URL: an empty scratch Postgres database. It is never the live database:
the script refuses to run if it's the same as DATABASE_URL.

Checks that pg_restore succeeds, that the schema is at the latest migration, and that every table
the app uses is there, then prints each table's rows and the newest job and payment, so a person
can compare them with the live app. Exits non-zero if anything is wrong.
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.backup import PREFIX, bucket, pg_tool, postgres_url  # noqa: E402


def newest_backup(scratch):
    name_of_bucket = os.getenv("BACKUP_BUCKET", "")
    if name_of_bucket:
        client = bucket()
        items = [item for page in client.get_paginator("list_objects_v2").paginate(Bucket=name_of_bucket, Prefix=PREFIX) for item in page.get("Contents", [])]
        if not items:
            sys.exit(f"No backups in {name_of_bucket}/{PREFIX}")
        newest = max(items, key=lambda item: item["LastModified"])
        path = Path(scratch) / Path(newest["Key"]).name
        client.download_file(name_of_bucket, newest["Key"], str(path))
        return path
    files = sorted(Path(os.getenv("BACKUP_DIR", "backups")).glob("mechanicpro-*.dump"))
    if not files:
        sys.exit("No backups found: run scripts/backup.py first, or pass a file")
    return files[-1]


def check(url, backup):
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import create_engine, inspect, text

    from app import db, normalize_database_url
    import app.models  # noqa: F401  (the tables the app uses)

    print(f"Restoring {backup} ...")
    subprocess.run([pg_tool("pg_restore", url), "--clean", "--if-exists", "--no-owner", "--no-privileges", f"--dbname={url}", str(backup)], check=True)

    problems = []
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "migrations"))
    head = ScriptDirectory.from_config(config).get_current_head()
    engine = create_engine(normalize_database_url(url))
    with engine.connect() as connection:
        present = set(inspect(connection).get_table_names())
        version = connection.execute(text("select version_num from alembic_version")).scalar() if "alembic_version" in present else None
        if version != head:
            problems.append(f"schema is at {version}, the code's latest migration is {head} (run `flask db upgrade` after restoring)")
        missing = sorted(set(db.metadata.tables) - present)
        if missing:
            problems.append("missing tables: " + ", ".join(missing))
        print(f"\nSchema: {version} (latest: {head})")
        print("\nRows per table:")
        for table in sorted(set(db.metadata.tables) & present):
            print(f"  {table:<28} {connection.execute(text(f'select count(*) from \"{table}\"')).scalar():>8}")
        if {"job", "payment"} <= present:
            newest_job = connection.execute(text("select max(created_at) from job")).scalar()
            newest_payment = connection.execute(text("select max(paid_at) from payment")).scalar()
            print(f"\nNewest job: {newest_job}\nNewest payment: {newest_payment}")
    engine.dispose()
    return problems


def main():
    url = postgres_url(os.getenv("RESTORE_DATABASE_URL", ""))
    if not url.startswith("postgresql://"):
        sys.exit("RESTORE_DATABASE_URL must be an empty scratch Postgres database")
    if url == postgres_url(os.getenv("DATABASE_URL", "")):
        sys.exit("RESTORE_DATABASE_URL is the live database. Use a scratch one: restoring replaces what's there.")
    with tempfile.TemporaryDirectory() as scratch:
        backup = Path(sys.argv[1]) if len(sys.argv) > 1 else newest_backup(scratch)
        problems = check(url, backup)
    if problems:
        print("\nRESTORE TEST FAILED:\n- " + "\n- ".join(problems))
        sys.exit(1)
    print("\nRestore test passed: the backup restores, its schema is current and every table is there.")


if __name__ == "__main__":
    main()
