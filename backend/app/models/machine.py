from app import db
class Machine(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    name=db.Column(db.String(150),nullable=False)
    model=db.Column(db.String(100))
    serial_no=db.Column(db.String(120),unique=True,nullable=False)
    customer_id=db.Column(db.Integer,db.ForeignKey("customer.id"),nullable=False)
    company_id=db.Column(db.Integer,db.ForeignKey("company.id"),nullable=False)
    status=db.Column(db.String(40),default="Operational")
