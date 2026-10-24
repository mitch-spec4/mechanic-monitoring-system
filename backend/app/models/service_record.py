from app.utils.time import utcnow

from app import db


class ServiceRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    # One service record per job; older records created before worksheets have no job.
    job_id = db.Column(db.Integer, db.ForeignKey("job.id"), nullable=True, unique=True)
    machine_id = db.Column(db.Integer, db.ForeignKey("machine.id"), nullable=False, index=True)
    customer_id = db.Column(db.Integer, db.ForeignKey("customer.id"), nullable=False, index=True)
    mechanic_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    service_type = db.Column(db.String(80), nullable=False)
    problem = db.Column(db.Text)
    work_done = db.Column(db.Text)
    parts_replaced = db.Column(db.Text)
    solution = db.Column(db.Text)
    advice = db.Column(db.Text)
    service_date = db.Column(db.DateTime, nullable=False, default=utcnow)
    # When the technician last saved the summary, so a change made offline earlier doesn't win.
    updated_at = db.Column(db.DateTime)
