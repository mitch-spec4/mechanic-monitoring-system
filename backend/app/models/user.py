from app import db
from werkzeug.security import generate_password_hash,check_password_hash
class User(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    name=db.Column(db.String(120),nullable=False)
    email=db.Column(db.String(160),unique=True,nullable=False,index=True)
    password_hash=db.Column(db.String(255),nullable=False)
    role=db.Column(db.String(30),nullable=False) # boss, mechanic, customer
    company_id=db.Column(db.Integer,db.ForeignKey("company.id"),nullable=False)
    customer_id=db.Column(db.Integer,db.ForeignKey("customer.id"),nullable=True)
    def set_password(self,p): self.password_hash=generate_password_hash(p)
    def check_password(self,p): return check_password_hash(self.password_hash,p)
