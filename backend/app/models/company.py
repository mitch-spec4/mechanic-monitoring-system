from app import db
class Company(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    name=db.Column(db.String(150),nullable=False)
    location=db.Column(db.String(200))
