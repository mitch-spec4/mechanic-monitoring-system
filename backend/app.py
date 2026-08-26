from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import os

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv("DATABASE_URL", "sqlite:///mechanic_pro.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)
CORS(app)

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(180), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(30), default="mechanic")
    services = db.relationship("Service", backref="mechanic", lazy=True)

class Customer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    phone = db.Column(db.String(50))
    email = db.Column(db.String(180))
    location = db.Column(db.String(180))
    machines = db.relationship("Machine", backref="customer", lazy=True)

class Machine(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    model = db.Column(db.String(160))
    serial_number = db.Column(db.String(160))
    status = db.Column(db.String(50), default="Operational")
    customer_id = db.Column(db.Integer, db.ForeignKey("customer.id"), nullable=False)
    services = db.relationship("Service", backref="machine", lazy=True)

class Service(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    service_type = db.Column(db.String(80), nullable=False)
    problem = db.Column(db.Text)
    diagnosis = db.Column(db.Text)
    work_performed = db.Column(db.Text)
    parts_replaced = db.Column(db.Text)
    mechanic_notes = db.Column(db.Text)
    advice = db.Column(db.Text)
    started_at = db.Column(db.DateTime)
    completed_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    mechanic_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    machine_id = db.Column(db.Integer, db.ForeignKey("machine.id"), nullable=False)
    location = db.Column(db.String(180))

class Review(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    rating = db.Column(db.Integer, nullable=False)
    review = db.Column(db.Text)
    customer_id = db.Column(db.Integer, db.ForeignKey("customer.id"))
    service_id = db.Column(db.Integer, db.ForeignKey("service.id"))

@app.get("/api/health")
def health():
    return jsonify({"status":"ok"})

@app.post("/api/auth/register")
def register():
    data=request.get_json() or {}
    name=data.get("name","").strip()
    email=data.get("email","").strip().lower()
    password=data.get("password","")
    if not name or not email or not password:
        return jsonify({"error":"Name, email and password are required"}),400
    if User.query.filter_by(email=email).first():
        return jsonify({"error":"Email already registered"}),409
    u=User(name=name,email=email,password_hash=generate_password_hash(password))
    db.session.add(u); db.session.commit()
    return jsonify({"user":{"id":u.id,"name":u.name,"email":u.email,"role":u.role}}),201

@app.post("/api/auth/login")
def login():
    data=request.get_json() or {}
    email=data.get("email","").strip().lower()
    password=data.get("password","")
    u=User.query.filter_by(email=email).first()
    if not u or not check_password_hash(u.password_hash,password):
        return jsonify({"error":"Invalid email or password"}),401
    return jsonify({"user":{"id":u.id,"name":u.name,"email":u.email,"role":u.role}})

@app.get("/api/dashboard/<int:mechanic_id>")
def dashboard(mechanic_id):
    services=Service.query.filter_by(mechanic_id=mechanic_id).all()
    return jsonify({
        "jobs_completed":len(services),
        "customers":len({s.machine.customer_id for s in services}),
        "machines":len({s.machine_id for s in services}),
        "services": [service_json(s) for s in services]
    })

@app.get("/api/customers")
def customers():
    return jsonify([{"id":c.id,"name":c.name,"phone":c.phone,"email":c.email,"location":c.location} for c in Customer.query.all()])

@app.post("/api/customers")
def create_customer():
    d=request.get_json() or {}
    c=Customer(name=d["name"],phone=d.get("phone"),email=d.get("email"),location=d.get("location"))
    db.session.add(c); db.session.commit()
    return jsonify({"id":c.id,"name":c.name}),201

@app.get("/api/machines")
def machines():
    return jsonify([machine_json(m) for m in Machine.query.all()])

@app.post("/api/machines")
def create_machine():
    d=request.get_json() or {}
    m=Machine(name=d["name"],model=d.get("model"),serial_number=d.get("serial_number"),
              customer_id=d["customer_id"],status=d.get("status","Operational"))
    db.session.add(m); db.session.commit()
    return jsonify(machine_json(m)),201

@app.get("/api/services")
def services():
    mechanic_id=request.args.get("mechanic_id",type=int)
    q=Service.query
    if mechanic_id: q=q.filter_by(mechanic_id=mechanic_id)
    return jsonify([service_json(s) for s in q.order_by(Service.created_at.desc()).all()])

@app.post("/api/services")
def create_service():
    d=request.get_json() or {}
    required=["mechanic_id","machine_id","service_type"]
    if any(x not in d for x in required):
        return jsonify({"error":"mechanic_id, machine_id and service_type are required"}),400
    s=Service(
        mechanic_id=d["mechanic_id"], machine_id=d["machine_id"], service_type=d["service_type"],
        problem=d.get("problem"), diagnosis=d.get("diagnosis"), work_performed=d.get("work_performed"),
        parts_replaced=d.get("parts_replaced"), mechanic_notes=d.get("mechanic_notes"),
        advice=d.get("advice"), location=d.get("location"),
        started_at=parse_date(d.get("started_at")), completed_at=parse_date(d.get("completed_at"))
    )
    db.session.add(s); db.session.commit()
    return jsonify(service_json(s)),201

@app.post("/api/services/<int:service_id>/review")
def review(service_id):
    d=request.get_json() or {}
    r=Review(rating=int(d["rating"]),review=d.get("review"),customer_id=d.get("customer_id"),service_id=service_id)
    db.session.add(r); db.session.commit()
    return jsonify({"id":r.id}),201

def parse_date(v):
    if not v: return None
    try: return datetime.fromisoformat(v.replace("Z","+00:00"))
    except ValueError: return None

def service_json(s):
    return {"id":s.id,"service_type":s.service_type,"problem":s.problem,"diagnosis":s.diagnosis,
            "work_performed":s.work_performed,"parts_replaced":s.parts_replaced,"mechanic_notes":s.mechanic_notes,
            "advice":s.advice,"location":s.location,"started_at":s.started_at.isoformat() if s.started_at else None,
            "completed_at":s.completed_at.isoformat() if s.completed_at else None,
            "created_at":s.created_at.isoformat(),"machine":machine_json(s.machine)}

def machine_json(m):
    return {"id":m.id,"name":m.name,"model":m.model,"serial_number":m.serial_number,"status":m.status,
            "customer":{"id":m.customer.id,"name":m.customer.name,"location":m.customer.location}}

with app.app_context():
    db.create_all()
    if not User.query.filter_by(email="mitch@mechanicpro.demo").first():
        db.session.add(User(name="Mitch",email="mitch@mechanicpro.demo",
                            password_hash=generate_password_hash("demo123"),role="mechanic"))
        db.session.commit()

if __name__ == "__main__":
    app.run(debug=True, port=int(os.getenv("PORT",5000)))
