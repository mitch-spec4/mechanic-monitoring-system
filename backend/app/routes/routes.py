"""Technicians' routes for a day (app/services/routing.py): managers plan and save the order;
technicians see theirs."""
from flask import Blueprint, jsonify, request

from app import db
from app.models.company import Company
from app.models.user import User
from app.services.equipment import company_today, written_date
from app.services.notifications import notify
from app.services.routing import apply_order, plan_day
from app.utils.auth import current_user, roles
from app.utils.validation import ValidationError, integer, iso_date, json_body
from app.i18n import N_, _, speaking

bp = Blueprint("routes", __name__)


def day_asked(company, data):
    return iso_date(data, "date", "Date") or company_today(company)


def technician(company_id, mechanic_id):
    person = User.query.filter_by(id=mechanic_id, company_id=company_id, role="mechanic").first()
    if not person:
        raise ValidationError(_("Technician not found"), 404)
    return person


@bp.get("")
@roles("boss")
def plan():
    """The suggested order of a technician's jobs for a day (?mechanic_id=&date=), with the drive
    it saves against the order they're in now."""
    user = current_user()
    company = db.session.get(Company, user.company_id)
    person = technician(company.id, integer(request.args, "mechanic_id", "Technician", required=True))
    return jsonify(plan=plan_day(company, person, day_asked(company, request.args)))


@bp.post("")
@roles("boss")
def save():
    """Save an order for the day ({mechanic_id, date, job_ids}): the technician's list follows it."""
    user = current_user()
    company = db.session.get(Company, user.company_id)
    data = json_body()
    person = technician(company.id, integer(data, "mechanic_id", "Technician", required=True))
    day = day_asked(company, data)
    job_ids = data.get("job_ids")
    if not isinstance(job_ids, list) or any(not isinstance(i, int) or isinstance(i, bool) for i in job_ids) or len(set(job_ids)) != len(job_ids):
        raise ValidationError(_("Send the jobs in their new order."))
    routable = set(plan_day(company, person, day)["current"]["job_ids"])
    if not set(job_ids) <= routable:
        raise ValidationError(_("Only this technician's jobs for the day can be in the route."), 409)
    apply_order(person, day, job_ids)
    if job_ids:
        with speaking(person.language):
            when = written_date(day)
        notify(
            person.id,
            N_("Your route is planned"),
            N_("{count} stops on {date}, in the order to drive them. Today's jobs follow it."),
            "job",
            count=len(job_ids),
            date=when,
        )
    db.session.commit()
    return jsonify(plan=plan_day(company, person, day))


@bp.get("/mine")
@roles("mechanic")
def mine():
    """A technician's own route for a day: the saved order, with where each stop is."""
    user = current_user()
    company = db.session.get(Company, user.company_id)
    return jsonify(plan=plan_day(company, user, day_asked(company, request.args)))
