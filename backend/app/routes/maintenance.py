"""The daily clean-up, the day's reminders and plan renewals, for a scheduler (Vercel Cron, a host's cron job...) to call once a day.

GET or POST /api/cron/daily with the header "Authorization: Bearer <CRON_SECRET>". Without a
CRON_SECRET the URL doesn't exist; the same jobs also run as `flask` commands.
"""
import hmac

from flask import Blueprint, abort, current_app, jsonify, request

from app import db
from app.services.audit import purge_old_events
from app.services.billing import renew_due
from app.services.booking import send_reminders
from app.services.equipment import send_due_reminders
from app.services.company_data import delete_due_companies
from app.services.demo import purge_expired
from app.services.location import purge_old_live_points
from app.services.media import purge_abandoned_uploads
from app.services.sync import purge_old_requests

bp = Blueprint("maintenance", __name__)


def run_daily():
    removed = {"demo_companies": purge_expired()}
    removed["abandoned_uploads"] = purge_abandoned_uploads()
    removed["old_live_locations"] = purge_old_live_points()
    removed["old_activity"] = purge_old_events()
    removed["old_offline_changes"] = purge_old_requests()
    db.session.commit()
    # Not a clean-up: visit reminders, "book the repair" reminders and follow-ups (sent once each).
    removed["reminders"] = send_reminders()
    db.session.commit()
    # Planned maintenance coming due: its job and the reminders (app/services/equipment.py).
    removed["maintenance"] = send_due_reminders()
    db.session.commit()
    # Plans: renewals with the saved card, and reminders of trials and plans ending (commits).
    removed["billing"] = renew_due()
    # Companies whose 30 days after "Delete my company" are up (commits each one).
    removed["deleted_companies"] = delete_due_companies()
    return removed


@bp.route("/daily", methods=["GET", "POST"])
def daily():
    secret = current_app.config["CRON_SECRET"]
    if not secret:
        abort(404)
    if not hmac.compare_digest(request.headers.get("Authorization", "").encode(), f"Bearer {secret}".encode()):
        abort(401)
    return jsonify(removed=run_daily())
