"""The security review's safety net: every route that takes an ID refuses people from another
company, whatever their role.

For each route, a boss, a technician and a customer from "Other Co" try it on a record that belongs
to Acme. None of them may succeed or learn anything (a 403 or 404, never a 2xx). A new route with an
ID in its URL fails test_every_id_route_is_covered until it's added here.
"""
from datetime import timedelta

import pytest

from app import create_app, db
from app.models import (
    MaintenancePlan,
    Site,
    ChecklistTemplate,
    ChecklistTemplateItem,
    Customer,
    JobChecklistItem,
    JobFile,
    JobPart,
    Notification,
    Payment,
    Review,
    ServiceRequest,
    ServiceTemplate,
    FormSubmission,
    FormTemplate,
    FormVersion,
    Shift,
    User,
    WorkEntry,
)
from app.utils.time import utcnow
from conftest import make_user

# Routes that take a signed token rather than an ID, or are public, and are tested elsewhere.
NOT_ID_SCOPED = {
    "/api/files/export/<token>",  # test_security: export links
    "/api/files/upload/<token>",  # test_media: upload tokens
    "/api/insights/export.<kind>",  # test_insights: a file format, no record
    "/api/legal/<name>",  # public pages
    "/api/billing/webhooks/<name>",  # test_billing: a provider's signed webhooks, no record
    "/static/<path:filename>",
}


@pytest.fixture
def acme_records(data):
    """One of every kind of record with an ID, all belonging to Acme."""
    acme, job, mechanic = data["acme"], data["job"], data["mechanic"]
    template = ChecklistTemplate(company_id=acme, job_type="Inspection")
    db.session.add(template)
    db.session.flush()
    db.session.add(ChecklistTemplateItem(template_id=template.id, label="Look"))
    item = JobChecklistItem(job_id=job, label="Isolate power")
    entry = WorkEntry(job_id=job, mechanic_id=mechanic, started_at=utcnow() - timedelta(hours=1), ended_at=utcnow())
    part = JobPart(job_id=job, name="Filter", quantity=1, added_by=mechanic)
    request = ServiceRequest(
        customer_id=data["acme_customer"], company_id=acme, machine_id=data["machine"], subject="Noise", description="Loud"
    )
    notification = Notification(user_id=data["boss"], title="Hello", message="Hi")
    review = Review(
        customer_id=data["acme_customer"], mechanic_id=mechanic, machine_id=data["machine"], company_id=acme, service_record_id=data["record"], rating=5
    )
    shift = Shift.query.filter_by(user_id=mechanic).first()
    file = JobFile(
        company_id=acme, job_id=job, uploaded_by=mechanic, kind="before", content_type="image/jpeg", storage_key="acme/x.jpg", status="ready"
    )
    payment = Payment(
        company_id=acme, user_id=data["boss"], plan="starter", interval="month", amount_cents=150000, currency="KES", provider="test", reference="pay_acme_1"
    )
    site = Site(company_id=acme, customer_id=data["acme_customer"], name="Main plant")
    plan = MaintenancePlan(company_id=acme, machine_id=data["machine"], title="Oil change", every=3, unit="months", next_due=utcnow().date())
    document = JobFile(
        company_id=acme, machine_id=data["machine"], uploaded_by=data["boss"], kind="document", content_type="application/pdf", storage_key="acme/manual.pdf", status="ready"
    )
    service = ServiceTemplate(company_id=acme, name="Annual service", checklist_id=template.id, duration_minutes=90, skills=["Electrical"], booking="direct")
    form = FormTemplate(company_id=acme, name="Safety check", job_types=["Repair"], customer_visible=True)
    db.session.add_all([item, entry, part, request, notification, review, file, payment, site, plan, document, service, form])
    db.session.flush()
    version = FormVersion(form_id=form.id, number=1, fields=[{"id": "safe", "type": "yesno", "label": "Safe", "required": True}])
    db.session.add(version)
    db.session.flush()
    db.session.add(FormSubmission(company_id=acme, job_id=job, form_id=form.id, version_id=version.id, answers={"safe": "yes"}, status="completed", completed_at=utcnow()))
    db.session.commit()
    return {
        "tid": template.id,
        "cid": data["acme_customer"],
        "rid_request": request.id,
        "fid": file.id,
        "jid": job,
        "item_id": item.id,
        "eid": entry.id,
        "pid": part.id,
        "mid": data["machine"],
        "nid": notification.id,
        "rid_review": review.id,
        "sid": shift.id,
        "uid": data["mechanic"],
        "reference": payment.reference,
        "site": site.id,
        "plan": plan.id,
        "document": document.id,
        "service": service.id,
        "form": form.id,
    }


def attempts(ids):
    """(method, url, body) for every ID route, aimed at Acme's records."""
    jid = ids["jid"]
    return [
        ("GET", f"/api/billing/payments/{ids['reference']}", None),
        ("POST", f"/api/billing/test/{ids['reference']}/pay", {"outcome": "success"}),
        ("POST", f"/api/billing/payments/{ids['reference']}/confirm", None),
        ("PATCH", f"/api/checklists/{ids['tid']}", {"job_type": "Stolen"}),
        ("DELETE", f"/api/checklists/{ids['tid']}", None),
        ("PATCH", f"/api/catalog/{ids['service']}", {"name": "Stolen"}),
        ("PATCH", f"/api/forms/{ids['form']}", {"name": "Stolen"}),
        ("DELETE", f"/api/forms/{ids['form']}", None),
        ("PUT", f"/api/jobs/{jid}/forms/{ids['form']}", {"answers": {"safe": "no"}}),
        ("GET", f"/api/jobs/{jid}/forms/{ids['form']}/certificate.pdf", None),
        ("DELETE", f"/api/catalog/{ids['service']}", None),
        ("GET", f"/api/customers/{ids['cid']}", None),
        ("PATCH", f"/api/customers/{ids['cid']}", {"name": "Stolen"}),
        ("DELETE", f"/api/customers/{ids['cid']}", None),
        ("PATCH", f"/api/customers/requests/{ids['rid_request']}", {"status": "Cancelled"}),
        ("GET", f"/api/customers/requests/{ids['rid_request']}", None),
        ("GET", f"/api/customers/requests/{ids['rid_request']}/slots", None),
        ("POST", f"/api/customers/requests/{ids['rid_request']}/book", {"start": "2026-11-03T06:00:00Z"}),
        ("POST", f"/api/customers/requests/{ids['rid_request']}/cancel", {}),
        ("GET", f"/api/messages/{ids['cid']}", None),
        ("POST", f"/api/messages/{ids['cid']}", {"body": "Stolen"}),
        ("DELETE", f"/api/files/{ids['fid']}", None),
        ("GET", f"/api/files/{ids['fid']}", None),
        ("POST", f"/api/files/{ids['fid']}/confirm", {}),
        ("PATCH", f"/api/jobs/{jid}", {"title": "Stolen"}),
        ("DELETE", f"/api/jobs/{jid}", None),
        ("GET", f"/api/jobs/{jid}", None),
        ("PATCH", f"/api/jobs/{jid}/checklist/{ids['item_id']}", {"done": True}),
        ("POST", f"/api/jobs/{jid}/entries", {"started_at": "2026-01-01T08:00:00Z", "ended_at": "2026-01-01T09:00:00Z"}),
        ("PATCH", f"/api/jobs/{jid}/entries/{ids['eid']}", {"work_done": "Stolen"}),
        ("POST", f"/api/jobs/{jid}/files", {"kind": "before", "content_type": "image/jpeg", "size": 10}),
        ("POST", f"/api/jobs/{jid}/notes", {"note": "Stolen"}),
        ("POST", f"/api/jobs/{jid}/on-the-way", {}),
        ("POST", f"/api/jobs/{jid}/parts", {"name": "Stolen", "quantity": 1}),
        ("DELETE", f"/api/jobs/{jid}/parts/{ids['pid']}", None),
        ("PATCH", f"/api/jobs/{jid}/costing", {"charged": 1, "parts": [{"id": ids["pid"], "unit_cost": 1}]}),
        ("PUT", f"/api/jobs/{jid}/record", {"problem": "Stolen"}),
        ("GET", f"/api/jobs/{jid}/report.pdf", None),
        ("PATCH", f"/api/machines/{ids['mid']}", {"name": "Stolen"}),
        ("GET", f"/api/machines/{ids['mid']}", None),
        ("POST", f"/api/machines/{ids['mid']}/documents", {"content_type": "application/pdf", "size": 10, "name": "x.pdf"}),
        ("POST", f"/api/machines/{ids['mid']}/documents/{ids['document']}/confirm", {}),
        ("DELETE", f"/api/machines/{ids['mid']}/documents/{ids['document']}", None),
        ("GET", f"/api/files/{ids['document']}", None),
        ("POST", f"/api/machines/{ids['mid']}/plans", {"title": "Stolen", "every": 1, "unit": "days", "next_due": "2026-12-01"}),
        ("PATCH", f"/api/plans/{ids['plan']}", {"title": "Stolen"}),
        ("DELETE", f"/api/plans/{ids['plan']}", None),
        ("POST", f"/api/plans/{ids['plan']}/job", {}),
        ("PATCH", f"/api/sites/{ids['site']}", {"name": "Stolen"}),
        ("DELETE", f"/api/sites/{ids['site']}", None),
        ("DELETE", f"/api/machines/{ids['mid']}", None),
        ("DELETE", f"/api/notifications/{ids['nid']}", None),
        ("PATCH", f"/api/notifications/{ids['nid']}/read", {}),
        ("PATCH", f"/api/reviews/{ids['rid_review']}", {"comment": "Stolen"}),
        ("PATCH", f"/api/shifts/{ids['sid']}", {"clocked_out_at": "2026-01-01T09:00:00Z"}),
        ("PATCH", f"/api/users/{ids['uid']}", {"name": "Stolen"}),
        ("DELETE", f"/api/users/{ids['uid']}", None),
        ("POST", f"/api/users/{ids['uid']}/reset-code", {}),
        ("POST", f"/api/users/{ids['uid']}/reset-two-factor", {}),
    ]


@pytest.fixture
def outsiders(data, auth):
    """Other Co's boss, technician and customer."""
    other_customer = Customer.query.filter_by(email="cust@other.test").one()
    from app.models import Company

    make_user("Other Customer", "cust-user@other.test", "customer", db.session.get(Company, data["other"]), other_customer)
    db.session.commit()
    return {email: auth(email) for email in ("boss@other.test", "mech@other.test", "cust-user@other.test")}


def test_people_from_another_company_can_reach_none_of_its_records(client, data, auth, acme_records, outsiders):
    failures = []
    for method, url, body in attempts(acme_records):
        for who, headers in outsiders.items():
            response = client.open(url, method=method, json=body, headers=headers)
            if response.status_code not in (403, 404):
                failures.append(f"{who} {method} {url} -> {response.status_code}")
    assert failures == []
    # The same requests from inside the company do work, so the refusals above are about the
    # company, not a broken request.
    insider = auth("boss@acme.test")
    for url in (f"/api/jobs/{acme_records['jid']}", f"/api/customers/{acme_records['cid']}", f"/api/billing/payments/{acme_records['reference']}"):
        assert client.get(url, headers=insider).status_code == 200, url
    # And nothing changed.
    assert db.session.get(ChecklistTemplate, acme_records["tid"]).job_type == "Inspection"
    assert db.session.get(User, acme_records["uid"]).name == "Mech One"
    assert db.session.get(JobPart, acme_records["pid"]) is not None
    assert db.session.get(Notification, acme_records["nid"]).is_read is False
    assert db.session.get(Site, acme_records["site"]).name == "Main plant"
    assert db.session.get(MaintenancePlan, acme_records["plan"]).title == "Oil change"
    assert db.session.get(JobFile, acme_records["document"]) is not None
    assert db.session.get(ServiceTemplate, acme_records["service"]).name == "Annual service"
    assert db.session.get(FormTemplate, acme_records["form"]).name == "Safety check"


def test_every_id_route_is_covered(app, data, acme_records):
    """Fails when a new route with an ID appears without being added to attempts()."""
    covered = set()
    for method, url, _body in attempts(acme_records):
        adapter = app.url_map.bind("localhost")
        endpoint, _args = adapter.match(url, method=method)
        covered.add((method, next(rule.rule for rule in app.url_map.iter_rules(endpoint))))
    routes = {
        (method, rule.rule)
        for rule in app.url_map.iter_rules()
        if "<" in rule.rule and rule.rule not in NOT_ID_SCOPED
        for method in rule.methods - {"HEAD", "OPTIONS"}
    }
    assert routes - covered == set()
