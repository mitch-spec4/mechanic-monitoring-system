"""Removing a whole company: every row that belongs to it, then its stored files.

Used to clear away expired demo companies. Rows go child-first so foreign keys never point at
something already deleted; a test checks that no table is left with rows after a company goes.
"""
from flask import current_app
from sqlalchemy import delete, select

from app import db
from app.models import (
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
    User,
    WorkEntry,
)
from app.services.storage import storage


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
