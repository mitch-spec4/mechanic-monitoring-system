from app import db


class Company(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False)
    location = db.Column(db.String(200))
    # Set on a visitor's private copy of the demo company: when it is deleted.
    demo_expires_at = db.Column(db.DateTime, index=True)
    # When a manager closed the "Get set up" guide on the dashboard.
    setup_dismissed_at = db.Column(db.DateTime)

    @property
    def is_demo(self):
        return self.demo_expires_at is not None
