"""Ask the running app to do its daily run (POST /api/cron/daily with CRON_SECRET).

For schedulers that run apart from the app, like Render's cron jobs (render.yaml), which can't
reach the app's disk: the work then happens in the app itself. Needs APP_URL and CRON_SECRET.
Exits non-zero if the run fails, so the scheduler shows it.

Usage: python scripts/call_daily.py
"""
import json
import os
import sys
import urllib.error
import urllib.request


def main():
    app_url, secret = os.getenv("APP_URL", "").rstrip("/"), os.getenv("CRON_SECRET", "")
    if not app_url or not secret:
        sys.exit("APP_URL and CRON_SECRET must be set")
    request = urllib.request.Request(f"{app_url}/api/cron/daily", method="POST", headers={"Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            print(json.dumps(json.loads(response.read()), indent=2))
    except urllib.error.HTTPError as error:
        sys.exit(f"The daily run failed: HTTP {error.code} {error.read()[:500]!r}")
    except urllib.error.URLError as error:
        sys.exit(f"Couldn't reach {app_url}: {error.reason}")


if __name__ == "__main__":
    main()
