"""Start the API on a fresh, seeded throwaway database for the browser tests.

Usage (from backend/): python scripts/e2e_server.py
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
DB_PATH = Path(tempfile.gettempdir()) / "mechanicpro-e2e.db"

os.environ.update(
    {
        "APP_ENV": "development",
        "DATABASE_URL": f"sqlite:///{DB_PATH.as_posix()}",
        "LOGIN_RATE_LIMIT": "1000 per minute",
    }
)
DB_PATH.unlink(missing_ok=True)
subprocess.run([sys.executable, "seed.py"], cwd=BACKEND, check=True)

sys.path.insert(0, str(BACKEND))
from app import create_app  # noqa: E402

create_app().run(host="127.0.0.1", port=int(os.getenv("E2E_API_PORT", "5000")))
