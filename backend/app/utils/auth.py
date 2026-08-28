from functools import wraps
from flask import jsonify
from flask_jwt_extended import jwt_required,get_jwt
def roles(*allowed):
    def deco(fn):
        @wraps(fn)
        @jwt_required()
        def wrapped(*a,**kw):
            if get_jwt().get("role") not in allowed:
                return jsonify(error="Forbidden"),403
            return fn(*a,**kw)
        return wrapped
    return deco
