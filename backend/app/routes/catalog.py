"""The service catalog: the services a company offers, what a job made from one starts with, and
which ones customers can book (see app/models/service.py)."""
from flask import Blueprint, jsonify, request

from app import db
from app.models.company import Company
from app.models.job import Job
from app.models.machine import Machine
from app.models.request import ServiceRequest
from app.models.service import BOOKING_TYPES, ServiceTemplate
from app.models.worksheet import ChecklistTemplate, ChecklistTemplateItem
from app.services.booking import working_minutes
from app.services.catalog import fits
from app.utils.auth import current_user, roles
from app.utils.validation import ValidationError, choice, integer, json_body, text
from app.i18n import _

bp = Blueprint("catalog", __name__)
MAX_SERVICES = 200
MAX_SKILLS = 10
SHORTEST_MINUTES = 15


def service_out(service, counts=False):
    checklist = db.session.get(ChecklistTemplate, service.checklist_id) if service.checklist_id else None
    data = {
        "id": service.id,
        "name": service.name,
        "description": service.description,
        "equipment_type": service.equipment_type,
        "checklist": (
            {
                "id": checklist.id,
                "job_type": checklist.job_type,
                "items": ChecklistTemplateItem.query.filter_by(template_id=checklist.id).count(),
            }
            if checklist
            else None
        ),
        "duration_minutes": service.duration_minutes,
        "skills": service.skills or [],
        "booking": service.booking,
        "active": service.active,
    }
    if counts:
        data["jobs"] = Job.query.filter_by(service_id=service.id).count()
    return data


def customer_out(service):
    """What a customer sees: no checklist, no skills."""
    return {
        "id": service.id,
        "name": service.name,
        "description": service.description,
        "equipment_type": service.equipment_type,
        "duration_minutes": service.duration_minutes,
        "booking": service.booking,
    }


def read_skills(data):
    value = data.get("skills") or []
    if not isinstance(value, list):
        raise ValidationError(_("Skills must be a list"))
    skills = []
    for item in value:
        skill = text({"skill": item}, "skill", "Skill", max_length=40) if isinstance(item, str) else None
        if not skill:
            raise ValidationError(_("Each skill needs a name of up to 40 characters"))
        if skill.lower() not in (known.lower() for known in skills):
            skills.append(skill)
    if len(skills) > MAX_SKILLS:
        raise ValidationError(_("A service can need at most {count} skills", count=MAX_SKILLS))
    return skills


def read_checklist(data, company_id):
    checklist_id = integer(data, "checklist_id", "Checklist")
    if checklist_id and not ChecklistTemplate.query.filter_by(id=checklist_id, company_id=company_id).first():
        raise ValidationError(_("Checklist not found"), 404)
    return checklist_id


def read_duration(data, company, default=None):
    minutes = integer(data, "duration_minutes", "Duration (minutes)", required=default is None, minimum=SHORTEST_MINUTES, maximum=24 * 60)
    minutes = minutes or default
    if minutes > working_minutes(company):
        raise ValidationError(_("A visit has to fit in one working day ({count} minutes).", count=working_minutes(company)))
    return minutes


def unique_name(company_id, name, exclude_id=None):
    query = ServiceTemplate.query.filter(ServiceTemplate.company_id == company_id, db.func.lower(ServiceTemplate.name) == name.lower())
    if exclude_id:
        query = query.filter(ServiceTemplate.id != exclude_id)
    if query.first():
        raise ValidationError(_("There is already a service called {name}", name=name), 409)


def load_service(sid, company_id):
    return ServiceTemplate.query.filter_by(id=sid, company_id=company_id).first_or_404()


@bp.get("")
@roles("boss", "customer")
def list_services():
    """Managers: every service. Customers: the ones they can book, for one piece of their
    equipment when `machine_id` is given."""
    user = current_user()
    query = ServiceTemplate.query.filter_by(company_id=user.company_id)
    if user.role == "boss":
        return jsonify(services=[service_out(s, counts=True) for s in query.order_by(db.func.lower(ServiceTemplate.name)).all()])
    machine = None
    machine_id = request.args.get("machine_id", type=int)
    if machine_id:
        machine = Machine.query.filter_by(id=machine_id, company_id=user.company_id, customer_id=user.customer_id).first_or_404()
    bookable = query.filter(ServiceTemplate.active.is_(True), ServiceTemplate.booking != "none").order_by(db.func.lower(ServiceTemplate.name))
    return jsonify(services=[customer_out(s) for s in bookable.all() if fits(s, machine)])


@bp.post("")
@roles("boss")
def create_service():
    user = current_user()
    company = db.session.get(Company, user.company_id)
    if ServiceTemplate.query.filter_by(company_id=company.id).count() >= MAX_SERVICES:
        raise ValidationError(_("A company can have at most {count} services", count=MAX_SERVICES), 409)
    data = json_body()
    name = text(data, "name", "Name", required=True, max_length=120)
    unique_name(company.id, name)
    service = ServiceTemplate(
        company_id=company.id,
        name=name,
        description=text(data, "description", "Description"),
        equipment_type=text(data, "equipment_type", "Equipment type", max_length=80),
        checklist_id=read_checklist(data, company.id),
        duration_minutes=read_duration(data, company, default=60),
        skills=read_skills(data),
        booking=choice(data, "booking", BOOKING_TYPES, "Booking", default="none"),
        active=data.get("active", True) is not False,
    )
    db.session.add(service)
    db.session.commit()
    return jsonify(service=service_out(service, counts=True)), 201


@bp.patch("/<int:sid>")
@roles("boss")
def update_service(sid):
    """Changes apply to new jobs and requests; ones already made keep what they started with."""
    user = current_user()
    company = db.session.get(Company, user.company_id)
    service = load_service(sid, company.id)
    data = json_body()
    if "name" in data:
        name = text(data, "name", "Name", required=True, max_length=120)
        unique_name(company.id, name, exclude_id=service.id)
        service.name = name
    if "description" in data:
        service.description = text(data, "description", "Description")
    if "equipment_type" in data:
        service.equipment_type = text(data, "equipment_type", "Equipment type", max_length=80)
    if "checklist_id" in data:
        service.checklist_id = read_checklist(data, company.id)
    if "duration_minutes" in data:
        service.duration_minutes = read_duration(data, company)
    if "skills" in data:
        service.skills = read_skills(data)
    if "booking" in data:
        service.booking = choice(data, "booking", BOOKING_TYPES, "Booking", default=service.booking)
    if "active" in data:
        service.active = data["active"] is not False
    db.session.commit()
    return jsonify(service=service_out(service, counts=True))


@bp.delete("/<int:sid>")
@roles("boss")
def delete_service(sid):
    """Only a service nothing was made from; one with jobs or requests is turned off instead, so
    their history keeps it."""
    service = load_service(sid, current_user().company_id)
    used = Job.query.filter_by(service_id=service.id).count() + ServiceRequest.query.filter_by(service_id=service.id).count()
    if used:
        raise ValidationError(_("Jobs or requests were made from this service. Turn it off instead, so they keep it."), 409)
    db.session.delete(service)
    db.session.commit()
    return jsonify(ok=True)
