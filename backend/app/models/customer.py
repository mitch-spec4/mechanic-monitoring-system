from app import db
class Customer(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    name=db.Column(db.String(150),nullable=False)
    email=db.Column(db.String(160),nullable=False)
    phone=db.Column(db.String(50))
    company_id=db.Column(db.Integer,db.ForeignKey("company.id"),nullable=False)
