from flask import Blueprint, jsonify

from app import db
from app.models.company import Company
from app.models.user import User
from app.utils.auth import current_user, roles

bp = Blueprint("company", __name__)


@bp.get("")
@roles("boss", "mechanic", "customer")
def company():
    user = current_user()
    record = db.get_or_404(Company, user.company_id)
    bosses = User.query.filter_by(company_id=user.company_id, role="boss").order_by(User.name).all()
    return jsonify(
        company={
            "id": record.id,
            "name": record.name,
            "location": record.location,
            "contacts": [{"name": boss.name, "email": boss.email} for boss in bosses],
        }
    )
