"""A copy of the database, made with pg_dump, kept for BACKUP_KEEP_DAYS.

Usage (from backend/, with DATABASE_URL pointing at Postgres): python scripts/backup.py

- With BACKUP_BUCKET set, the copy goes to that S3-compatible bucket (Cloudflare R2, Backblaze B2,
  AWS S3) under backups/, using BACKUP_ENDPOINT_URL, BACKUP_REGION, BACKUP_ACCESS_KEY_ID and
  BACKUP_SECRET_ACCESS_KEY; copies older than BACKUP_KEEP_DAYS (default 30) are then deleted.
  Use a different bucket (or at least different keys) from the app's photos, so one leaked key
  can't reach both.
- Without it, the copy is written to BACKUP_DIR (default backups/), to try it out.

Uses pg_dump from the database's own major Postgres version when it's installed (see pg_tool). The
restore test (scripts/restore_check.py) checks that a copy can actually be brought back.
"""
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

PREFIX = "backups/"
# Where Debian and Ubuntu keep each Postgres version's tools: /usr/lib/postgresql/16/bin/pg_dump.
PG_LIB = Path("/usr/lib/postgresql")


def postgres_url(url):
    """pg_dump wants plain postgresql:// (the app's URLs may name its driver)."""
    for prefix in ("postgresql+psycopg://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql://" + url[len(prefix):]
    return url


def server_major(url):
    """The database server's major version: 16 for 16.4."""
    from sqlalchemy import create_engine, text

    engine = create_engine("postgresql+psycopg://" + url[len("postgresql://"):])
    try:
        with engine.connect() as connection:
            return int(connection.execute(text("show server_version_num")).scalar()) // 10000
    finally:
        engine.dispose()


def pg_tool(name, url):
    """pg_dump or pg_restore from the server's own major version when it's installed, else the one on
    the PATH. A newer pg_dump can write copies an older pg_restore can't read, and pg_restore 17 and
    later start with a setting (transaction_timeout) that Postgres 16 refuses."""
    matching = PG_LIB / str(server_major(url)) / "bin" / name
    return str(matching) if matching.exists() else name


def bucket():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=os.getenv("BACKUP_ENDPOINT_URL") or None,
        region_name=os.getenv("BACKUP_REGION", "auto"),
        aws_access_key_id=os.getenv("BACKUP_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("BACKUP_SECRET_ACCESS_KEY"),
    )


def dump(url, path):
    subprocess.run([pg_tool("pg_dump", url), "--format=custom", "--no-owner", "--no-privileges", f"--dbname={url}", f"--file={path}"], check=True)


def main():
    url = postgres_url(os.getenv("DATABASE_URL", ""))
    if not url.startswith("postgresql://"):
        sys.exit("DATABASE_URL must be a Postgres database (backups are for production; SQLite is a file you can copy)")
    now = datetime.now(timezone.utc)
    name = f"mechanicpro-{now:%Y%m%d-%H%M%S}.dump"
    name_of_bucket = os.getenv("BACKUP_BUCKET", "")
    if not name_of_bucket:
        folder = Path(os.getenv("BACKUP_DIR", "backups"))
        folder.mkdir(parents=True, exist_ok=True)
        dump(url, folder / name)
        print(f"Backup written to {folder / name} ({(folder / name).stat().st_size} bytes). Set BACKUP_BUCKET to keep backups off this machine.")
        return
    keep_days = int(os.getenv("BACKUP_KEEP_DAYS", "30"))
    with tempfile.TemporaryDirectory() as scratch:
        path = Path(scratch) / name
        dump(url, path)
        size = path.stat().st_size
        client = bucket()
        client.upload_file(str(path), name_of_bucket, PREFIX + name)
    print(f"Backup uploaded to {name_of_bucket}/{PREFIX}{name} ({size} bytes).")
    cutoff = now - timedelta(days=keep_days)
    old = [
        item["Key"]
        for page in client.get_paginator("list_objects_v2").paginate(Bucket=name_of_bucket, Prefix=PREFIX)
        for item in page.get("Contents", [])
        if item["LastModified"] < cutoff and item["Key"] != PREFIX + name
    ]
    for key in old:
        client.delete_object(Bucket=name_of_bucket, Key=key)
    print(f"Removed {len(old)} backup(s) older than {keep_days} days.")


if __name__ == "__main__":
    main()
