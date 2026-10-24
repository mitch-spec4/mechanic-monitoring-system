from app import db
from app.utils.time import utcnow


class JobFile(db.Model):
    """A stored file: a photo, video or signature on a job, or a document (a manual, a certificate)
    on a piece of equipment. The bytes live in the storage layer (local disk or an S3-compatible
    bucket) under storage_key."""

    __table_args__ = (db.UniqueConstraint("uploaded_by", "client_key", name="uq_job_file_uploaded_by_client_key"),)

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    job_id = db.Column(db.Integer, db.ForeignKey("job.id"), nullable=True, index=True)
    # Set instead of job_id for an equipment document.
    machine_id = db.Column(db.Integer, db.ForeignKey("machine.id"), nullable=True, index=True)
    uploaded_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    kind = db.Column(db.String(20), nullable=False)  # before, after, other, video, signature, document
    content_type = db.Column(db.String(80), nullable=False)
    size_bytes = db.Column(db.Integer, nullable=False, default=0)
    storage_key = db.Column(db.String(255), nullable=False, unique=True)
    original_name = db.Column(db.String(200))
    # Pending until the upload is confirmed; only ready files are shown or counted.
    status = db.Column(db.String(20), nullable=False, default="pending")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    # The phone's own ID for a queued photo or video, so sending it again never adds it twice.
    client_key = db.Column(db.String(80))
