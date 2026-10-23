""""Try the demo": each visitor gets a private copy of the demo company and can look at it as the
boss, a mechanic or a customer."""
from flask import Blueprint, request

from app import db
from app.models.company import Company
from app.models.constants import ROLES
from app.routes.auth import signed_in_response
from app.services import rate_limit
from app.services.demo import person_in, start_copy
from app.utils.auth import current_user, roles
from app.utils.validation import ValidationError, choice, json_body

bp = Blueprint("demo", __name__)


@bp.post("")
def start():
    if not request.is_json:
        # A form on another website can't send JSON, so it can't swap a visitor's own session
        # for a demo one behind their back.
        raise ValidationError("Send the request as JSON.", 415)
    key = f"demo-ip:{rate_limit.client_ip()}"
    rate_limit.check(key, setting="DEMO_RATE_LIMIT")
    role = choice(json_body(), "role", ROLES, "Role", default="boss")
    rate_limit.record(key)
    company = start_copy()
    user = person_in(company.id, role)
    db.session.commit()
    return signed_in_response(user, 201)


@bp.post("/switch")
@roles("boss", "mechanic", "customer")
def switch():
    """See the same demo company as someone else. Only works inside a demo copy."""
    company = db.session.get(Company, current_user().company_id)
    if not company.is_demo:
        raise ValidationError("Only demo companies can switch between people.", 403)
    role = choice(json_body(), "role", ROLES, "Role")
    if not role:
        raise ValidationError("Role is required")
    return signed_in_response(person_in(company.id, role))
