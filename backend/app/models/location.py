from app import db
from app.utils.time import utcnow


class Shift(db.Model):
    """One clock-in to clock-out. Open (no clocked_out_at) while the mechanic is on the clock."""

    __table_args__ = (
        # At most one open shift per person, even if two clock-ins race each other.
        db.Index(
            "uq_shift_one_open_per_user",
            "user_id",
            unique=True,
            sqlite_where=db.text("clocked_out_at IS NULL"),
            postgresql_where=db.text("clocked_out_at IS NULL"),
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    clocked_in_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    clocked_out_at = db.Column(db.DateTime)
    # Set when a manager corrected or closed the shift; the original end time is kept.
    edited_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    edited_at = db.Column(db.DateTime)
    original_clocked_out_at = db.Column(db.DateTime)


class LocationPoint(db.Model):
    """A position taken while clocked in, or a note of why none could be taken."""

    __table_args__ = (db.Index("ix_location_point_user_recorded", "user_id", "recorded_at"),)

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    shift_id = db.Column(db.Integer, db.ForeignKey("shift.id"), nullable=False, index=True)
    job_id = db.Column(db.Integer, db.ForeignKey("job.id"), nullable=True, index=True)
    kind = db.Column(db.String(20), nullable=False)  # clock_in, clock_out, job_start, job_complete, live
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    accuracy_m = db.Column(db.Float)
    missing_reason = db.Column(db.String(20))  # denied, unavailable, timeout, unsupported, not_sent
    recorded_at = db.Column(db.DateTime, nullable=False, default=utcnow)
