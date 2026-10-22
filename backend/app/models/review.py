from app.utils.time import utcnow

from app import db


class Review(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.Integer, db.ForeignKey("customer.id"), nullable=False, index=True)
    mechanic_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    machine_id = db.Column(db.Integer, db.ForeignKey("machine.id"), nullable=False, index=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    service_record_id = db.Column(db.Integer, db.ForeignKey("service_record.id"), nullable=False, unique=True)
    rating = db.Column(db.Integer, nullable=False)
    comment = db.Column(db.Text)
    advice = db.Column(db.Text)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
