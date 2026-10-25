from app import db


class Company(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False)
    location = db.Column(db.String(200))
    # Where technicians start the day (the yard or office): the first point of a planned route.
    base_latitude = db.Column(db.Float)
    base_longitude = db.Column(db.Float)
    # Set on a visitor's private copy of the demo company: when it is deleted.
    demo_expires_at = db.Column(db.DateTime, index=True)
    # When a manager closed the "Get set up" guide on the dashboard.
    setup_dismissed_at = db.Column(db.DateTime)
    # Company settings. Times are shown in this time zone everywhere; currency and units are kept
    # for features that show money and distances.
    timezone = db.Column(db.String(64), nullable=False, default="Africa/Nairobi", server_default="Africa/Nairobi")
    currency = db.Column(db.String(3), nullable=False, default="KES", server_default="KES")
    units = db.Column(db.String(10), nullable=False, default="metric", server_default="metric")
    # The language new members start in, and invitations are written in. Everyone can pick their own.
    language = db.Column(db.String(5), nullable=False, default="en", server_default="en")
    # Online booking (see app/services/booking.py): the days and hours visits can start in, how long
    # an inspection and (by default) a repair take, the travel time kept free between two visits of
    # one technician, how far ahead customers can book, and the notice needed.
    booking_days = db.Column(db.String(20), nullable=False, default="1,2,3,4,5", server_default="1,2,3,4,5")
    booking_start = db.Column(db.String(5), nullable=False, default="08:00", server_default="08:00")
    booking_end = db.Column(db.String(5), nullable=False, default="17:00", server_default="17:00")
    inspection_minutes = db.Column(db.Integer, nullable=False, default=120, server_default="120")
    repair_minutes = db.Column(db.Integer, nullable=False, default=240, server_default="240")
    travel_minutes = db.Column(db.Integer, nullable=False, default=30, server_default="30")
    booking_notice_hours = db.Column(db.Integer, nullable=False, default=24, server_default="24")
    booking_window_days = db.Column(db.Integer, nullable=False, default=14, server_default="14")
    # "Delete my company": when it was asked for, by whom, and when it happens unless cancelled.
    deletion_requested_at = db.Column(db.DateTime)
    deletion_requested_by = db.Column(db.Integer)
    deletion_due_at = db.Column(db.DateTime, index=True)
    # The company's logo (PNG or JPEG), shown on certificates and service reports.
    logo_key = db.Column(db.String(255))
    logo_content_type = db.Column(db.String(40))

    @property
    def is_demo(self):
        return self.demo_expires_at is not None
