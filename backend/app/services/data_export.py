"""'Export my data': everything a company has in MechanicPro, as a ZIP.

- One CSV per kind of record (opens in Excel or Google Sheets), and data.json with all of it.
- files.csv lists every photo, video and signature with a download link that works for 7 days.
  The files themselves aren't in the ZIP: a company can have up to 100 GB, too much to zip in
  one web request.
- Password hashes, 2FA secrets and backup codes are never exported.
"""
import csv
import io
import json
import zipfile
from datetime import date, datetime
from decimal import Decimal

from flask import current_app
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app import db
from app.models import (
    AuditEvent,
    ChecklistTemplate,
    ChecklistTemplateItem,
    Company,
    Customer,
    CustomerMessage,
    Invitation,
    Job,
    JobChecklistItem,
    JobEvent,
    JobFile,
    JobPart,
    LocationPoint,
    Machine,
    MaintenancePlan,
    Payment,
    Review,
    ServiceRecord,
    ServiceRequest,
    Shift,
    Site,
    Subscription,
    User,
    WorkEntry,
)
from app.utils.time import utcnow

LINK_DAYS = 7
# Never leave the server, whatever table they're in.
SECRET_COLUMNS = {"password_hash", "totp_secret", "totp_last_step", "code", "code_hash", "token_hash"}


def _rows(model, query):
    columns = [column.name for column in model.__table__.columns if column.name not in SECRET_COLUMNS]
    return columns, [{name: getattr(row, name) for name in columns} for row in query.all()]


def _tables(company_id):
    jobs = db.session.query(Job.id).filter(Job.company_id == company_id)
    templates = db.session.query(ChecklistTemplate.id).filter(ChecklistTemplate.company_id == company_id)
    return {
        "company": (Company, Company.query.filter_by(id=company_id)),
        "people": (User, User.query.filter_by(company_id=company_id)),
        "customers": (Customer, Customer.query.filter_by(company_id=company_id)),
        "equipment": (Machine, Machine.query.filter_by(company_id=company_id)),
        "sites": (Site, Site.query.filter_by(company_id=company_id)),
        "maintenance_plans": (MaintenancePlan, MaintenancePlan.query.filter_by(company_id=company_id)),
        "jobs": (Job, Job.query.filter_by(company_id=company_id)),
        "job_history": (JobEvent, JobEvent.query.filter(JobEvent.job_id.in_(jobs))),
        "time_entries": (WorkEntry, WorkEntry.query.filter(WorkEntry.job_id.in_(jobs))),
        "parts_used": (JobPart, JobPart.query.filter(JobPart.job_id.in_(jobs))),
        "job_checklists": (JobChecklistItem, JobChecklistItem.query.filter(JobChecklistItem.job_id.in_(jobs))),
        "checklist_templates": (ChecklistTemplate, ChecklistTemplate.query.filter_by(company_id=company_id)),
        "checklist_template_items": (ChecklistTemplateItem, ChecklistTemplateItem.query.filter(ChecklistTemplateItem.template_id.in_(templates))),
        "service_records": (ServiceRecord, ServiceRecord.query.filter_by(company_id=company_id)),
        "service_requests": (ServiceRequest, ServiceRequest.query.filter_by(company_id=company_id)),
        "customer_messages": (CustomerMessage, CustomerMessage.query.filter_by(company_id=company_id)),
        "reviews": (Review, Review.query.filter_by(company_id=company_id)),
        "shifts": (Shift, Shift.query.filter_by(company_id=company_id)),
        "locations": (LocationPoint, LocationPoint.query.filter_by(company_id=company_id)),
        "invitations": (Invitation, Invitation.query.filter_by(company_id=company_id)),
        "subscriptions": (Subscription, Subscription.query.filter_by(company_id=company_id)),
        "payments": (Payment, Payment.query.filter_by(company_id=company_id)),
        "activity_log": (AuditEvent, AuditEvent.query.filter_by(company_id=company_id)),
        "files": (JobFile, JobFile.query.filter_by(company_id=company_id, status="ready")),
    }


def _plain(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    # Quantities like 1.50: written exactly as stored, not rounded through a float.
    if isinstance(value, Decimal):
        return str(value)
    return value


def _serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="export-file")


def file_link(record):
    token = _serializer().dumps({"f": record.id, "c": record.company_id})
    return f"{current_app.config['APP_URL'].rstrip('/')}/api/files/export/{token}"


def file_for_link(token):
    try:
        data = _serializer().loads(token, max_age=LINK_DAYS * 86400)
    except (BadSignature, SignatureExpired):
        return None
    if not isinstance(data, dict):
        return None
    return JobFile.query.filter_by(id=data.get("f"), company_id=data.get("c"), status="ready").first()


def build_export(company_id):
    """The ZIP's bytes and its file name."""
    company = db.session.get(Company, company_id)
    everything = {}
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
        for name, (model, query) in _tables(company_id).items():
            columns, rows = _rows(model, query)
            if name == "files":
                columns = [*columns, "download_link"]
                records = {record.id: record for record in query}
                for row in rows:
                    row["download_link"] = file_link(records[row["id"]])
            everything[name] = [{key: _plain(value) for key, value in row.items()} for row in rows]
            text = io.StringIO()
            writer = csv.DictWriter(text, fieldnames=columns)
            writer.writeheader()
            for row in everything[name]:
                writer.writerow(row)
            # The byte order mark makes Excel read the file as UTF-8 (names like "Wanjirū").
            zipped.writestr(f"{name}.csv", "﻿" + text.getvalue())
        zipped.writestr(
            "data.json",
            json.dumps({"exported_at": utcnow().isoformat(), "company": company.name, "tables": everything}, ensure_ascii=False, indent=1),
        )
        zipped.writestr(
            "README.txt",
            "MechanicPro data export\n\n"
            "Each .csv file is one kind of record; data.json has all of them.\n"
            f"files.csv lists every photo, video and signature. Their download links work for {LINK_DAYS} days.\n"
            "Times are in UTC.\n",
        )
    stamp = utcnow().strftime("%Y-%m-%d")
    safe = "".join(char if char.isalnum() else "-" for char in company.name).strip("-")[:40] or "company"
    return archive.getvalue(), f"mechanicpro-{safe}-{stamp}.zip"
