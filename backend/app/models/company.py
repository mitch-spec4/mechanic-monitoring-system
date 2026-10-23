from app import db


class Company(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False)
    location = db.Column(db.String(200))
    # Set on a visitor's private copy of the demo company: when it is deleted.
    demo_expires_at = db.Column(db.DateTime, index=True)
    # When a manager closed the "Get set up" guide on the dashboard.
    setup_dismissed_at = db.Column(db.DateTime)
    # Company settings. Times are shown in this time zone everywhere; currency and units are kept
    # for features that show money and distances.
    timezone = db.Column(db.String(64), nullable=False, default="Africa/Nairobi", server_default="Africa/Nairobi")
    currency = db.Column(db.String(3), nullable=False, default="KES", server_default="KES")
    units = db.Column(db.String(10), nullable=False, default="metric", server_default="metric")

    @property
    def is_demo(self):
        return self.demo_expires_at is not None
