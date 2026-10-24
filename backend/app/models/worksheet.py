from app import db
from app.utils.time import utcnow


class WorkEntry(db.Model):
    """One stretch of work on a job. Open (no ended_at) while the mechanic is working."""

    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey("job.id"), nullable=False, index=True)
    mechanic_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    started_at = db.Column(db.DateTime, nullable=False)
    ended_at = db.Column(db.DateTime)
    site = db.Column(db.String(200))
    work_done = db.Column(db.Text)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    # When the notes or times were last changed, so a change made offline earlier doesn't win.
    updated_at = db.Column(db.DateTime)


class JobPart(db.Model):
    """A part used on a job: name and quantity, and what one cost (set by a manager; no stock)."""

    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey("job.id"), nullable=False, index=True)
    name = db.Column(db.String(160), nullable=False)
    quantity = db.Column(db.Numeric(10, 2), nullable=False)
    unit_cost_cents = db.Column(db.Integer)
    added_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class JobEvent(db.Model):
    """Status history and other key changes on a job: who, what, when."""

    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey("job.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    action = db.Column(db.String(40), nullable=False)
    from_status = db.Column(db.String(40))
    to_status = db.Column(db.String(40))
    note = db.Column(db.Text)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)
    # A change made offline: created_at is when it was made, synced_at when it reached the server.
    synced_at = db.Column(db.DateTime)
    # On an assignment change: who had the job before, so their offline work from before the
    # change is still accepted.
    previous_mechanic_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)


class ChecklistTemplate(db.Model):
    __table_args__ = (db.UniqueConstraint("company_id", "job_type", name="uq_checklist_template_company_type"),)

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    job_type = db.Column(db.String(80), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class ChecklistTemplateItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    template_id = db.Column(db.Integer, db.ForeignKey("checklist_template.id"), nullable=False, index=True)
    label = db.Column(db.String(200), nullable=False)
    required = db.Column(db.Boolean, nullable=False, default=False)
    position = db.Column(db.Integer, nullable=False, default=0)


class JobChecklistItem(db.Model):
    """A copy of a template item taken when work starts, so template edits never change a job."""

    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey("job.id"), nullable=False, index=True)
    label = db.Column(db.String(200), nullable=False)
    required = db.Column(db.Boolean, nullable=False, default=False)
    position = db.Column(db.Integer, nullable=False, default=0)
    done = db.Column(db.Boolean, nullable=False, default=False)
    note = db.Column(db.Text)
    done_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    done_at = db.Column(db.DateTime)
    # When it was last ticked, unticked or noted, so a change made offline earlier doesn't win.
    changed_at = db.Column(db.DateTime)
