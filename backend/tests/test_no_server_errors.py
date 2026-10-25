"""Every API route, as a manager, a technician, a customer and a stranger, with odd input: never a
server error. Odd input is no body, a body that isn't JSON, every common field set to the same odd
value (empty, huge, negative, the wrong type, a list, an object, a date that doesn't exist), and IDs
that exist, don't, or are too big for the database."""
import itertools
import traceback

from app import db
from app.models import Company, User
from app.routes.auth import access_token_for
from app.services.demo import populate

FIELDS = """name email title description status priority due_date machine_id customer_id mechanic_id quantity
rating comment answers fields job_types service_ids booking duration_minutes skills latitude longitude
accuracy started_at ended_at note done kind content_type size form_field image signature language timezone units
currency base plan interval extra_mechanics auto_renew code password new_password current_password token start
end every unit next_due address site_id equipment_type checklist_id items label active required customer_visible
version_id complete charged parts unit_cost pay_rate estimated_minutes service_id request_id body message minutes
visit_minutes days hours location job_type serial_no model manufacturer installed_on notes work_done role subject
date setup_token remember""".split()
ODD = [None, "", "x" * 3000, -1, 10**20, 1.5, True, [], {}, ["a"], {"a": 1}, "2026-13-45", 0]


def test_odd_input_never_causes_a_server_error(app):
    for name in ("Probe A", "Probe B"):
        company = Company(name=name)
        db.session.add(company)
        db.session.flush()
        populate(company, tag=name[-1].lower(), password="probe-password-123")
    db.session.commit()
    company = Company.query.filter_by(name="Probe A").one()
    people = {role: User.query.filter_by(company_id=company.id, role=role).order_by(User.id).first() for role in ("boss", "mechanic", "customer")}
    tokens = {role: access_token_for(person) for role, person in people.items()}
    client = app.test_client(use_cookies=False)
    calls = sorted(
        ((rule, method) for rule in app.url_map.iter_rules() if rule.rule.startswith("/api/") for method in rule.methods - {"HEAD", "OPTIONS"}),
        # Deleting goes last, so the rest runs against data that's still there.
        key=lambda call: (call[1] == "DELETE", call[0].rule, call[1]),
    )
    errors = {}
    for rule, method in calls:
        choices = [[1, 3, 999_999, 10**20] if type(rule._converters[arg]).__name__ == "IntegerConverter" else ["x", "1"] for arg in rule.arguments]
        for values in itertools.product(*choices):
            path = rule.rule
            for arg, value in zip(rule.arguments, values):
                path = path.replace(f"<int:{arg}>", str(value)).replace(f"<{arg}>", str(value))
            bodies = [None] if method in ("GET", "DELETE") else ["not json", {}, *({field: value for field in FIELDS} for value in ODD)]
            for role, body in itertools.product([*tokens, None], bodies):
                headers = {"Authorization": f"Bearer {tokens[role]}"} if role else {}
                try:
                    if isinstance(body, str):
                        status = client.open(path, method=method, headers=headers, data=body, content_type="application/json").status_code
                    else:
                        status = client.open(path, method=method, headers=headers, json=body).status_code
                    problem = None if status < 500 else f"HTTP {status}"
                except Exception as error:  # noqa: BLE001
                    db.session.rollback()
                    problem = "".join(traceback.format_exception_only(type(error), error)).strip()[:200]
                if problem:
                    errors.setdefault(f"{method} {rule.rule}: {problem}", (role, path, body if not isinstance(body, dict) else next(iter(body.values()), None)))
    assert not errors, "\n".join(f"{key} (e.g. as {seen[0]}: {seen[1]} with {seen[2]!r})" for key, seen in errors.items())
