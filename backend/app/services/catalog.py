"""What a job or a customer's request takes from the service it's made from (app/models/service.py)."""
from app import db
from app.models.service import ServiceTemplate
from app.models.worksheet import ChecklistTemplate
from app.utils.validation import ValidationError
from app.i18n import _


def fits(service, machine):
    """A service for one type of equipment only fits equipment of that type."""
    if not service.equipment_type or not machine:
        return True
    return (machine.equipment_type or "").strip().lower() == service.equipment_type.strip().lower()


def find_service(company_id, service_id, machine=None, bookable=False):
    """An active service of the company that fits the equipment (and that customers can book)."""
    service = ServiceTemplate.query.filter_by(id=service_id, company_id=company_id, active=True).first()
    if not service or (bookable and service.booking == "none"):
        raise ValidationError(_("Service not found"), 404)
    if not fits(service, machine):
        raise ValidationError(_("{service} is for {type} equipment.", service=service.name, type=service.equipment_type))
    return service


def service_job_type(service):
    """The job type that gives a job the service's checklist."""
    checklist = db.session.get(ChecklistTemplate, service.checklist_id) if service and service.checklist_id else None
    return checklist.job_type if checklist else None


def service_summary(job_or_request):
    service = db.session.get(ServiceTemplate, job_or_request.service_id) if job_or_request.service_id else None
    return {"id": service.id, "name": service.name, "skills": service.skills or []} if service else None
