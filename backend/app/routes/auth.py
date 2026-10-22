from flask import Blueprint, current_app, jsonify
from flask_jwt_extended import create_access_token, create_refresh_token, get_jwt_identity, jwt_required

from app import db, limiter
from app.models.customer import Customer
from app.models.invitation import Invitation
from app.models.user import User
from app.utils.time import utcnow
from app.utils.validation import email as read_email
from app.utils.validation import json_body, text

bp = Blueprint("auth", __name__)


def login_limit():
    return current_app.config["LOGIN_RATE_LIMIT"]


def user_payload(user):
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "company_id": user.company_id,
        "customer_id": user.customer_id,
    }


def access_token_for(user):
    return create_access_token(
        identity=str(user.id),
        additional_claims={
            "role": user.role,
            "company_id": user.company_id,
            "customer_id": user.customer_id,
        },
    )


@bp.post("/login")
@limiter.limit(login_limit)
def login():
    data = json_body()
    email = str(data.get("email") or "").strip().lower()
    password = data.get("password")
    user = User.query.filter_by(email=email).first() if email else None
    if not user or not isinstance(password, str) or not user.check_password(password):
        return jsonify(error="Invalid email or password"), 401

    return jsonify(
        token=access_token_for(user),
        refresh_token=create_refresh_token(identity=str(user.id)),
        user=user_payload(user),
    )


@bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    user = db.session.get(User, int(get_jwt_identity()))
    if not user:
        return jsonify(error="Your account no longer exists."), 401
    return jsonify(token=access_token_for(user), user=user_payload(user))


@bp.post("/register")
def register():
    return jsonify(error="Accounts are created through a company invitation"), 403


@bp.post("/accept-invitation")
@limiter.limit(login_limit)
def accept_invitation():
    data = json_body()
    code = text(data, "code", "Invitation code", required=True, max_length=80)
    name = text(data, "name", "Name", required=True, max_length=120)
    email = read_email(data)
    password = data.get("password")
    if not isinstance(password, str) or len(password) < 8:
        return jsonify(error="Password must be at least 8 characters"), 400

    invitation = Invitation.query.filter_by(code=code, used=False).first()
    if not invitation or invitation.expires_at < utcnow():
        return jsonify(error="Invalid or expired invitation"), 400
    if email != invitation.email.strip().lower():
        return jsonify(error="This invitation was issued to a different email address"), 403
    if User.query.filter_by(email=email).first():
        return jsonify(error="An account with this email already exists. Sign in instead."), 409

    customer_id = None
    if invitation.role == "customer":
        customer = Customer(name=name, email=email, company_id=invitation.company_id)
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
