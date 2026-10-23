"""Removing a whole company: every row that belongs to it, then its stored files.

Used to clear away expired demo companies. Rows go child-first so foreign keys never point at
something already deleted; a test checks that no table is left with rows after a company goes.
"""
from datetime import timedelta

from flask import current_app
from sqlalchemy import delete, select

from app import db
from app.models import (
    AuditEvent,
    BackupCode,
    ChecklistTemplate,
    ChecklistTemplateItem,
    Company,
    Customer,
    Invitation,
    Job,
    JobChecklistItem,
    JobEvent,
    JobFile,
    JobPart,
    LocationPoint,
    Machine,
    Notification,
    PasswordReset,
    Payment,
    Review,
    ServiceRecord,
    ServiceRequest,
    Shift,
    Subscription,
    TrustedDevice,
    User,
    WorkEntry,
)
from app.services.storage import storage
from app.utils.time import utcnow

DELETION_GRACE_DAYS = 30


def delete_company(company_id):
    """Delete the company's rows (without committing) and return the storage keys of its files,
    to remove with delete_files() once the deletion is committed."""
    jobs = select(Job.id).where(Job.company_id == company_id)
    users = select(User.id).where(User.company_id == company_id)
    templates = select(ChecklistTemplate.id).where(ChecklistTemplate.company_id == company_id)
    keys = list(db.session.scalars(select(JobFile.storage_key).where(JobFile.company_id == company_id)))
    for statement in (
        delete(LocationPoint).where(LocationPoint.company_id == company_id),
        delete(Shift).where(Shift.company_id == company_id),
        delete(JobFile).where(JobFile.company_id == company_id),
        delete(JobChecklistItem).where(JobChecklistItem.job_id.in_(jobs)),
        delete(JobEvent).where(JobEvent.job_id.in_(jobs)),
        delete(JobPart).where(JobPart.job_id.in_(jobs)),
        delete(WorkEntry).where(WorkEntry.job_id.in_(jobs)),
        delete(Review).where(Review.company_id == company_id),
        delete(ServiceRecord).where(ServiceRecord.company_id == company_id),
        delete(Job).where(Job.company_id == company_id),
        delete(ServiceRequest).where(ServiceRequest.company_id == company_id),
        delete(Notification).where(Notification.user_id.in_(users)),
        delete(PasswordReset).where(PasswordReset.user_id.in_(users)),
        delete(BackupCode).where(BackupCode.user_id.in_(users)),
        delete(TrustedDevice).where(TrustedDevice.user_id.in_(users)),
        delete(AuditEvent).where(AuditEvent.company_id == company_id),
        delete(Invitation).where(Invitation.company_id == company_id),
        delete(ChecklistTemplateItem).where(ChecklistTemplateItem.template_id.in_(templates)),
        delete(ChecklistTemplate).where(ChecklistTemplate.company_id == company_id),
        delete(Payment).where(Payment.company_id == company_id),
        delete(Subscription).where(Subscription.company_id == company_id),
        delete(User).where(User.company_id == company_id),
        delete(Machine).where(Machine.company_id == company_id),
        delete(Customer).where(Customer.company_id == company_id),
        delete(Company).where(Company.id == company_id),
    ):
        db.session.execute(statement.execution_options(synchronize_session=False))
    return keys


def delete_files(keys):
    """Best effort: a file that can't be removed is logged and left behind, never brought back."""
    for key in keys:
        try:
            storage().delete(key)
        except Exception:
            current_app.logger.exception("Could not delete stored file %s", key)


def request_deletion(company, user):
    """'Delete my company': everything goes in 30 days unless a manager cancels."""
    company.deletion_requested_at = utcnow()
    company.deletion_requested_by = user.id
    company.deletion_due_at = utcnow() + timedelta(days=DELETION_GRACE_DAYS)


def cancel_deletion(company):
    company.deletion_requested_at = None
    company.deletion_requested_by = None
    company.deletion_due_at = None


def delete_due_companies():
    """Delete every company whose grace period is over, files included. Commits each one."""
    removed = 0
    for company_id in list(db.session.scalars(select(Company.id).where(Company.deletion_due_at <= utcnow()))):
        keys = delete_company(company_id)
        db.session.commit()
        delete_files(keys)
        removed += 1
    return removed
