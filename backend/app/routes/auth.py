from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token

from app import db
from app.models.customer import Customer
from app.models.invitation import Invitation
from app.models.user import User

bp = Blueprint("auth", __name__)


@bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = data.get("password", "")
    user = User.query.filter_by(email=email).first()
    if not user or not user.check_password(password):
        return jsonify(error="Invalid credentials"), 401

    token = create_access_token(
        identity=str(user.id),
        additional_claims={
            "role": user.role,
            "company_id": user.company_id,
            "customer_id": user.customer_id,
        },
    )
    return jsonify(
        token=token,
        user={
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "company_id": user.company_id,
            "customer_id": user.customer_id,
        },
    )


@bp.post("/register")
def register():
    return jsonify(error="Accounts are created through a company invitation"), 403


@bp.post("/accept-invitation")
def accept_invitation():
    data = request.get_json(silent=True) or {}
    code = str(data.get("code", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    name = str(data.get("name", "")).strip()
    password = data.get("password", "")

    if not all((code, email, name, password)):
        return jsonify(error="Invitation code, name, email, and password are required"), 400
    if len(password) < 8:
        return jsonify(error="Password must be at least 8 characters"), 400

    invitation = Invitation.query.filter_by(code=code, used=False).first()
    if not invitation or invitation.expires_at < datetime.utcnow():
        return jsonify(error="Invalid or expired invitation"), 400
    if email != invitation.email.strip().lower():
        return jsonify(error="This invitation was issued to a different email address"), 403
    if User.query.filter_by(email=email).first():
        return jsonify(error="Email already registered"), 409

    customer_id = None
    if invitation.role == "customer":
        customer = Customer(
            name=name,
            email=email,
            company_id=invitation.company_id,
        )
        db.session.add(customer)
        db.session.flush()
        customer_id = customer.id

    user = User(
        name=name,
        email=email,
        role=invitation.role,
        company_id=invitation.company_id,
        customer_id=customer_id,
    )
    user.set_password(password)
    invitation.used = True
    db.session.add(user)
    db.session.commit()
    return jsonify(message="Invitation accepted"), 201
