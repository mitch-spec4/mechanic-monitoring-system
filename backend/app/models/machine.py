from app import db


class Machine(db.Model):
    __table_args__ = (db.UniqueConstraint("company_id", "serial_no", name="uq_machine_company_serial"),)

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False)
    model = db.Column(db.String(100))
    serial_no = db.Column(db.String(120), nullable=False)
    customer_id = db.Column(db.Integer, db.ForeignKey("customer.id"), nullable=False, index=True)
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    status = db.Column(db.String(40), nullable=False, default="Operational")
