from flask import Blueprint, jsonify

from app import db
from app.models.worksheet import ChecklistTemplate, ChecklistTemplateItem
from app.utils.auth import current_user, roles
from app.utils.validation import ValidationError, json_body, text

bp = Blueprint("checklists", __name__)
MAX_ITEMS = 50


def out(template):
    items = ChecklistTemplateItem.query.filter_by(template_id=template.id).order_by(ChecklistTemplateItem.position)
    return {
        "id": template.id,
        "job_type": template.job_type,
        "items": [{"id": i.id, "label": i.label, "required": i.required} for i in items],
    }


def read_items(data):
    items = data.get("items")
    if not isinstance(items, list) or not items:
        raise ValidationError("Add at least one checklist item")
    if len(items) > MAX_ITEMS:
        raise ValidationError(f"A checklist can have at most {MAX_ITEMS} items")
    rows = []
    for item in items:
        if not isinstance(item, dict):
            raise ValidationError("Each checklist item needs a label")
        label = text(item, "label", "Checklist item", required=True, max_length=200)
        rows.append((label, bool(item.get("required"))))
    return rows


def replace_items(template, rows):
    ChecklistTemplateItem.query.filter_by(template_id=template.id).delete()
    for position, (label, required) in enumerate(rows):
        db.session.add(ChecklistTemplateItem(template_id=template.id, label=label, required=required, position=position))


def unique_type(company_id, job_type, exclude_id=None):
    query = ChecklistTemplate.query.filter(
        ChecklistTemplate.company_id == company_id, db.func.lower(ChecklistTemplate.job_type) == job_type.lower()
    )
    if exclude_id:
        query = query.filter(ChecklistTemplate.id != exclude_id)
    if query.first():
        raise ValidationError(f"There is already a checklist for {job_type}", 409)


@bp.get("")
@roles("boss")
def list_checklists():
    templates = ChecklistTemplate.query.filter_by(company_id=current_user().company_id).order_by(ChecklistTemplate.job_type)
    return jsonify(checklists=[out(t) for t in templates.all()])


@bp.post("")
@roles("boss")
def create_checklist():
    company_id = current_user().company_id
    data = json_body()
    job_type = text(data, "job_type", "Job type", required=True, max_length=80)
    rows = read_items(data)
    unique_type(company_id, job_type)
    template = ChecklistTemplate(company_id=company_id, job_type=job_type)
    db.session.add(template)
    db.session.flush()
    replace_items(template, rows)
    db.session.commit()
    return jsonify(checklist=out(template)), 201


@bp.patch("/<int:tid>")
@roles("boss")
def update_checklist(tid):
    """Edits apply to jobs that start after the change; jobs already started keep their copy."""
    template = ChecklistTemplate.query.filter_by(id=tid, company_id=current_user().company_id).first_or_404()
    data = json_body()
    if "job_type" in data:
        job_type = text(data, "job_type", "Job type", required=True, max_length=80)
        unique_type(template.company_id, job_type, exclude_id=template.id)
        template.job_type = job_type
    if "items" in data:
        replace_items(template, read_items(data))
    db.session.commit()
    return jsonify(checklist=out(template))


@bp.delete("/<int:tid>")
@roles("boss")
def delete_checklist(tid):
    template = ChecklistTemplate.query.filter_by(id=tid, company_id=current_user().company_id).first_or_404()
    ChecklistTemplateItem.query.filter_by(template_id=template.id).delete()
    db.session.delete(template)
    db.session.commit()
    return jsonify(ok=True)
