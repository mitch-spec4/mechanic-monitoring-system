from flask import Blueprint, abort, jsonify

from app.services.legal import DOCUMENTS, document

bp = Blueprint("legal", __name__)


@bp.get("/<name>")
def legal_document(name):
    """The privacy policy or the terms, as Markdown, for the public pages and the signup box."""
    if name not in DOCUMENTS:
        abort(404)
    return jsonify(document(name))
