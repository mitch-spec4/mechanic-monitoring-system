from app import db
from app.utils.time import utcnow


class ClientRequest(db.Model):
    """A change the app sent with an Idempotency-Key: the phone's queue may send the same change
    again (its first reply was lost), and the server answers it once. Kept for 30 days."""

    __table_args__ = (db.UniqueConstraint("user_id", "key", name="uq_client_request_user_key"),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    key = db.Column(db.String(80), nullable=False)
    method = db.Column(db.String(10), nullable=False)
    path = db.Column(db.String(300), nullable=False)
    # The first answer, given again to a repeat. Empty while the request is being saved.
    status_code = db.Column(db.Integer)
    body = db.Column(db.Text)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)
