from datetime import timedelta

from app import db
from app.models.media import JobFile
from app.services.storage import storage
from app.utils.time import utcnow

ABANDONED_AFTER = timedelta(days=1)


def purge_abandoned_uploads():
    """Uploads reserved but never confirmed (closed app, lost signal) after a day."""
    removed = 0
    for record in JobFile.query.filter(JobFile.status == "pending", JobFile.created_at < utcnow() - ABANDONED_AFTER).all():
        storage().delete(record.storage_key)
        db.session.delete(record)
        removed += 1
    return removed
