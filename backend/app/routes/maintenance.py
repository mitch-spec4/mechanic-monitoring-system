"""The daily clean-up, for a scheduler (Vercel Cron, a host's cron job...) to call once a day.

GET or POST /api/cron/daily with the header "Authorization: Bearer <CRON_SECRET>". Without a
CRON_SECRET the URL doesn't exist; the same jobs also run as `flask` commands.
"""
import hmac

from flask import Blueprint, abort, current_app, jsonify, request

from app import db
from app.services.demo import purge_expired
from app.services.location import purge_old_live_points
from app.services.media import purge_abandoned_uploads

bp = Blueprint("maintenance", __name__)


def run_daily():
    removed = {"demo_companies": purge_expired()}
    removed["abandoned_uploads"] = purge_abandoned_uploads()
    removed["old_live_locations"] = purge_old_live_points()
    db.session.commit()
    return removed


@bp.route("/daily", methods=["GET", "POST"])
def daily():
    secret = current_app.config["CRON_SECRET"]
    if not secret:
        abort(404)
    if not hmac.compare_digest(request.headers.get("Authorization", "").encode(), f"Bearer {secret}".encode()):
        abort(401)
    return jsonify(removed=run_daily())
