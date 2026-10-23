from functools import wraps

from flask import g, jsonify
from flask_jwt_extended import get_jwt, get_jwt_identity, verify_jwt_in_request

from app import db
from app.models.user import User
from app.i18n import _


def roles(*allowed):
    """Require a valid access token for a user who still exists with one of the allowed roles.

    The user is re-read from the database on every request, so deleted accounts, role or
    company changes, and password changes take effect immediately instead of when the token expires.
    """

    def deco(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            verify_jwt_in_request()
            user = db.session.get(User, int(get_jwt_identity()))
            claims = get_jwt()
            if (
                not user
                or user.role != claims.get("role")
                or user.company_id != claims.get("company_id")
                or user.customer_id != claims.get("customer_id")
                or user.token_version != claims.get("tv")
            ):
                return jsonify(error=_("Your account has changed. Please sign in again.")), 401
            if user.role not in allowed:
                return jsonify(error=_("Forbidden")), 403
            g.user = user
            return fn(*args, **kwargs)

        return wrapped

    return deco


def current_user() -> User:
    return g.user
