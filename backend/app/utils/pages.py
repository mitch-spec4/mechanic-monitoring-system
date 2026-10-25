"""Long lists a page at a time: ?page=2&per_page=25, and ?q= to search them.

Without ?page the whole list comes back as before, for the screens that need all of it (the
dashboards, and the technician's phone, which keeps its jobs for when there's no signal)."""
from math import ceil

from flask import jsonify, request

from app import db
from app.utils.validation import integer

PER_PAGE = 25
MAX_PER_PAGE = 100
MAX_SEARCH = 100


def matches(columns):
    """The condition "any of `columns` contains ?q=" (any case), or None with no search.
    Wildcards typed in the search are taken literally."""
    words = (request.args.get("q") or "").strip()[:MAX_SEARCH]
    if not words:
        return None
    pattern = "%" + words.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    return db.or_(*[column.ilike(pattern, escape="\\") for column in columns])


def searched(query, columns):
    condition = matches(columns)
    return query if condition is None else query.filter(condition)


def listing(query, key, serialize):
    """The JSON for a list: all of it, or with ?page= one page and where it sits."""
    if "page" not in request.args:
        return jsonify(**{key: [serialize(row) for row in query.all()]})
    page = integer(request.args, "page", "Page", minimum=1) or 1
    per_page = integer(request.args, "per_page", "Per page", minimum=1, maximum=MAX_PER_PAGE) or PER_PAGE
    total = query.order_by(None).count()
    rows = query.limit(per_page).offset((page - 1) * per_page).all()
    return jsonify(**{key: [serialize(row) for row in rows]}, page=page, per_page=per_page, total=total, pages=max(1, ceil(total / per_page)))
