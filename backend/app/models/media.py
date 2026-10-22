from app import db
from app.utils.time import utcnow


class JobFile(db.Model):
    """A photo, video or signature attached to a job. The bytes live in the storage layer
    (local disk or an S3-compatible bucket) under storage_key."""

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    job_id = db.Column(db.Integer, db.ForeignKey("job.id"), nullable=False, index=True)
    uploaded_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    kind = db.Column(db.String(20), nullable=False)  # before, after, other, video, signature
    content_type = db.Column(db.String(80), nullable=False)
    size_bytes = db.Column(db.Integer, nullable=False, default=0)
    storage_key = db.Column(db.String(255), nullable=False, unique=True)
    original_name = db.Column(db.String(200))
    # Pending until the upload is confirmed; only ready files are shown or counted.
    status = db.Column(db.String(20), nullable=False, default="pending")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
