from app.utils.time import utcnow

from app import db


class FormTemplate(db.Model):
    """A form the company built (a safety check, a handover sheet, an inspection certificate),
    attached to job types and services. Its questions live in versions, so a form filled in
    keeps the questions it was filled in with when the form changes later."""

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text)
    # Which jobs get it: jobs of these job types, and jobs made from these services.
    job_types = db.Column(db.JSON, nullable=False, default=list)
    service_ids = db.Column(db.JSON, nullable=False, default=list)
    # Must be completed before its job can be.
    required = db.Column(db.Boolean, nullable=False, default=False, server_default="0")
    # A certificate: the customer sees it, and can download its PDF, once it's completed.
    customer_visible = db.Column(db.Boolean, nullable=False, default=False, server_default="0")
    active = db.Column(db.Boolean, nullable=False, default=True, server_default="1")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class FormVersion(db.Model):
    """One version of a form's questions (app/services/forms.py describes a question)."""

    __table_args__ = (db.UniqueConstraint("form_id", "number", name="uq_form_version_number"),)

    id = db.Column(db.Integer, primary_key=True)
    form_id = db.Column(db.Integer, db.ForeignKey("form_template.id"), nullable=False, index=True)
    number = db.Column(db.Integer, nullable=False)
    fields = db.Column(db.JSON, nullable=False, default=list)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)


class FormSubmission(db.Model):
    """A form filled in on a job: the answers to one version's questions. Photos and signatures
    are job files with `form_field` set; the answers hold everything else."""

    __table_args__ = (db.UniqueConstraint("job_id", "form_id", name="uq_form_submission_job_form"),)

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    job_id = db.Column(db.Integer, db.ForeignKey("job.id"), nullable=False, index=True)
    form_id = db.Column(db.Integer, db.ForeignKey("form_template.id"), nullable=False, index=True)
    version_id = db.Column(db.Integer, db.ForeignKey("form_version.id"), nullable=False)
    # The job's equipment when it was filled in, for the equipment's history.
    machine_id = db.Column(db.Integer, db.ForeignKey("machine.id"), nullable=True, index=True)
    answers = db.Column(db.JSON, nullable=False, default=dict)
    status = db.Column(db.String(20), nullable=False, default="draft")  # draft, completed
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    completed_at = db.Column(db.DateTime)
    completed_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
