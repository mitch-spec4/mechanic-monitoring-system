"""Insights for managers (see app/services/insights.py), on screen and as Excel or PDF."""
import io
from datetime import timedelta

from flask import Blueprint, jsonify, request, send_file

from app import db
from app.models.company import Company
from app.services import audit
from app.services.equipment import company_today
from app.services.insights import MAX_DAYS, insights
from app.services.insights_export import to_pdf, to_xlsx
from app.utils.auth import current_user, roles
from app.utils.validation import ValidationError, iso_date
from app.i18n import _, speaking

bp = Blueprint("insights", __name__)

DEFAULT_DAYS = 30
FORMATS = {
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", to_xlsx),
    "pdf": ("application/pdf", to_pdf),
}


def report_for(user):
    """The range asked for (?start=&end=, both days in the company's zone), or the last 30 days."""
    company = db.session.get(Company, user.company_id)
    today = company_today(company)
    end = iso_date(request.args, "end", "To") or today
    start = iso_date(request.args, "start", "From") or end - timedelta(days=DEFAULT_DAYS - 1)
    if start > end:
        raise ValidationError(_("The start date must be on or before the end date."))
    if (end - start).days + 1 > MAX_DAYS:
        raise ValidationError(_("Choose at most {days} days.", days=MAX_DAYS))
    return company, insights(company, start, end)


@bp.get("")
@roles("boss")
def overview():
    _company, data = report_for(current_user())
    return jsonify(insights={key: value for key, value in data.items() if not key.startswith("_")})


@bp.get("/export.<kind>")
@roles("boss")
def export(kind):
    if kind not in FORMATS:
        raise ValidationError(_("Not found."), 404)
    user = current_user()
    company, data = report_for(user)
    mimetype, build = FORMATS[kind]
    # In the account's language: the file is opened outside the app, from a download link.
    with speaking(user.language):
        body = build(data, company)
    audit.record("report_exported", user=user, detail=f"{kind.upper()} {data['range']['start']} - {data['range']['end']}")
    db.session.commit()
    name = f"insights-{data['range']['start']}-to-{data['range']['end']}.{kind}"
    return send_file(io.BytesIO(body), mimetype=mimetype, as_attachment=True, download_name=name)
