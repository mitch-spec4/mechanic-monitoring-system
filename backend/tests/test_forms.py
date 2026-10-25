"""Custom forms: building them (with versions), filling them in on jobs (show/hide rules, photos,
signatures, offline order), the completion rule, certificates, the logo, and who sees what."""
import base64
import io
from datetime import timedelta

import pytest
from PIL import Image

from app import db
from app.models import Company, FormSubmission, FormTemplate, FormVersion, Job, JobEvent, JobFile, Subscription
from app.models.service import ServiceTemplate
from app.services.storage import storage
from app.utils.time import utcnow
from conftest import SIGNATURE_PNG, SIGNED

QUESTIONS = [
    {"id": "intro", "type": "heading", "label": "Before the test"},
    {"id": "levels", "type": "yesno", "label": "Levels correct", "required": True},
    {"id": "load_test", "type": "yesno", "label": "Load test done", "required": True},
    {"id": "load_kw", "type": "number", "label": "Load applied (kW)", "required": True, "show_if": {"field": "load_test", "equals": "yes"}},
    {"id": "why_not", "type": "text", "label": "Why not?", "required": True, "show_if": {"field": "load_test", "equals": "no"}},
    {"id": "result", "type": "choice", "label": "Result", "required": True, "options": ["Pass", "Fail"]},
    {"id": "next_due", "type": "date", "label": "Next service due"},
    {"id": "panel", "type": "photo", "label": "Control panel", "required": True},
    {"id": "signature", "type": "signature", "label": "Technician's signature", "required": True},
]


def boss(auth):
    return auth("boss@acme.test")


def mech(auth):
    return auth("mech@acme.test")


@pytest.fixture
def business(data):
    """Forms are on Professional and up: Acme is on Business."""
    db.session.add(Subscription(company_id=data["acme"], plan="business", interval="month", status="active", current_period_end=utcnow() + timedelta(days=20)))
    job = db.session.get(Job, data["job"])
    job.job_type = "Service"
    db.session.commit()


def make_form(client, auth, **extra):
    body = {"name": "Load test certificate", "fields": QUESTIONS, "job_types": ["Service"], "required": True, "customer_visible": True, **extra}
    response = client.post("/api/forms", headers=boss(auth), json=body)
    assert response.status_code == 201, response.get_json()
    return response.get_json()["form"]


def photo_for(client, auth, job_id, form_id, field="panel"):
    """A form photo through the usual upload: reserve, upload, confirm."""
    image = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 80, 30)).save(image, "JPEG")
    data = image.getvalue()
    reserved = client.post(
        f"/api/jobs/{job_id}/files", headers=mech(auth), json={"kind": "form_photo", "form_field": f"{form_id}:{field}", "content_type": "image/jpeg", "size": len(data)}
    )
    assert reserved.status_code == 201, reserved.get_json()
    upload = reserved.get_json()["upload"]
    assert client.put(upload["url"], data=data, headers=upload["headers"]).status_code == 204
    return client.post(f"/api/files/{reserved.get_json()['file_id']}/confirm", headers=mech(auth))


def test_building_forms_and_their_versions(client, data, auth, business):
    form = make_form(client, auth)
    assert form["version"]["number"] == 1 and form["required"] and form["customer_visible"]
    assert [field["id"] for field in form["version"]["fields"]] == [q["id"] for q in QUESTIONS]
    assert "required" not in form["version"]["fields"][0]

    for fields, message in (
        ([], "at least one question"),
        ([{"id": "a", "type": "heading", "label": "Only a heading"}], "at least one question"),
        ([{"id": "a", "type": "slider", "label": "x"}], "unknown type"),
        ([{"id": "a", "type": "text", "label": ""}], "needs a label"),
        ([{"id": "a", "type": "text", "label": "x"}, {"id": "a", "type": "text", "label": "y"}], "its own ID"),
        ([{"id": "a", "type": "choice", "label": "Pick", "options": ["Only one"]}], "between 2 and"),
        ([{"id": "a", "type": "text", "label": "Later", "show_if": {"field": "b", "equals": "yes"}}, {"id": "b", "type": "yesno", "label": "B"}], "earlier yes/no"),
        ([{"id": "b", "type": "yesno", "label": "B"}, {"id": "a", "type": "text", "label": "A", "show_if": {"field": "b", "equals": "maybe"}}], "doesn't have"),
    ):
        response = client.post("/api/forms", headers=boss(auth), json={"name": f"Bad {message}", "fields": fields})
        assert response.status_code == 400 and message in response.get_json()["error"], (fields, response.get_json())
    assert client.post("/api/forms", headers=boss(auth), json={"name": "load TEST certificate", "fields": QUESTIONS}).status_code == 409
    other_service = ServiceTemplate(company_id=data["other"], name="Theirs")
    db.session.add(other_service)
    db.session.commit()
    assert client.post("/api/forms", headers=boss(auth), json={"name": "X", "fields": QUESTIONS, "service_ids": [other_service.id]}).status_code == 404

    # Unfilled: new questions replace version 1. Filled in: they become version 2.
    changed = QUESTIONS[:-1] + [{"id": "signature", "type": "signature", "label": "Signed by", "required": True}]
    edited = client.patch(f"/api/forms/{form['id']}", headers=boss(auth), json={"fields": changed}).get_json()["form"]
    assert edited["version"]["number"] == 1 and edited["version"]["fields"][-1]["label"] == "Signed by"
    client.put(f"/api/jobs/{data['job']}/forms/{form['id']}", headers=mech(auth), json={"answers": {"levels": "yes"}})
    newer = client.patch(f"/api/forms/{form['id']}", headers=boss(auth), json={"fields": QUESTIONS}).get_json()["form"]
    assert newer["version"]["number"] == 2 and newer["submissions"] == 1
    # The job keeps the questions it was filled in with.
    job = client.get(f"/api/jobs/{data['job']}", headers=mech(auth)).get_json()["job"]
    assert job["forms"][0]["version"]["number"] == 1 and job["forms"][0]["version"]["fields"][-1]["label"] == "Signed by"

    # Filled in: turned off, not deleted.
    assert client.delete(f"/api/forms/{form['id']}", headers=boss(auth)).status_code == 409
    unused = client.post("/api/forms", headers=boss(auth), json={"name": "Unused", "fields": QUESTIONS}).get_json()["form"]
    assert client.delete(f"/api/forms/{unused['id']}", headers=boss(auth)).status_code == 200
    assert FormVersion.query.filter_by(form_id=unused["id"]).count() == 0

    # Technicians don't build forms; other companies don't see them.
    assert client.get("/api/forms", headers=mech(auth)).status_code == 403
    assert client.patch(f"/api/forms/{form['id']}", headers=auth("boss@other.test"), json={"name": "Stolen"}).status_code in (403, 404)


def test_forms_are_on_professional_and_up(client, data, auth):
    db.session.add(Subscription(company_id=data["acme"], plan="starter", interval="month", status="active", current_period_end=utcnow() + timedelta(days=20)))
    db.session.commit()
    response = client.post("/api/forms", headers=boss(auth), json={"name": "Check", "fields": QUESTIONS})
    assert response.status_code == 403 and "Professional plan" in response.get_json()["error"]


def test_filling_in_a_form_on_a_job(client, data, auth, business):
    form = make_form(client, auth)
    url = f"/api/jobs/{data['job']}/forms/{form['id']}"
    job = client.get(f"/api/jobs/{data['job']}", headers=mech(auth)).get_json()["job"]
    assert [f["name"] for f in job["forms"]] == ["Load test certificate"] and job["forms"][0]["submission"] is None

    # A draft: answers checked by type; hidden questions' answers dropped.
    saved = client.put(url, headers=mech(auth), json={"answers": {"levels": "yes", "load_test": "no", "why_not": "No load bank on site", "load_kw": 50}})
    assert saved.status_code == 200 and "load_kw" not in saved.get_json()["job"]["forms"][0]["submission"]["answers"]
    saved = client.put(url, headers=mech(auth), json={"answers": {"levels": "yes", "load_test": "yes", "load_kw": "62.5", "result": "Pass", "next_due": "2027-03-01"}})
    assert saved.status_code == 200, saved.get_json()
    submission = saved.get_json()["job"]["forms"][0]["submission"]
    assert submission["status"] == "draft" and submission["answers"] == {"levels": "yes", "load_test": "yes", "load_kw": 62.5, "result": "Pass", "next_due": "2027-03-01"}
    switched = client.put(url, headers=mech(auth), json={"answers": {"load_test": "no", "why_not": "Customer declined"}}).get_json()["job"]["forms"][0]["submission"]
    assert "load_kw" not in switched["answers"] and switched["answers"]["why_not"] == "Customer declined"
    for answers, message in (
        ({"levels": "maybe"}, "yes or no"),
        ({"result": "Excellent"}, "one of its choices"),
        ({"next_due": "soon"}, "a date"),
        ({"load_kw": "lots"}, "a number"),
        ({"nope": "x"}, "no question"),
        ({"panel": "photo.jpg"}, "no question"),
        ({"signature": {"name": "Mech One"}}, "must be a PNG"),
    ):
        response = client.put(url, headers=mech(auth), json={"answers": answers})
        assert response.status_code == 400 and message in response.get_json()["error"], (answers, response.get_json())

    # Completing needs every required question that's shown: here the photo and the signature.
    # (Photos are taken while the job is under way, as for the job's own photos.)
    assert client.patch(f"/api/jobs/{data['job']}", headers=mech(auth), json={"status": "In Progress"}).status_code == 200
    refused = client.put(url, headers=mech(auth), json={"complete": True})
    assert refused.status_code == 409 and refused.get_json()["missing"] == ["Control panel", "Technician's signature"]
    assert JobFile.query.filter_by(kind="form_signature").count() == 0
    assert photo_for(client, auth, data["job"], form["id"]).status_code == 200
    done = client.put(url, headers=mech(auth), json={"complete": True, "answers": {"signature": {"name": "Mech One", "image": SIGNATURE_PNG}}})
    assert done.status_code == 200, done.get_json()
    filled = done.get_json()["job"]["forms"][0]
    assert filled["submission"]["status"] == "completed" and filled["submission"]["completed_by"] == "Mech One"
    assert filled["submission"]["signatures"]["signature"]["name"] == "Mech One" and len(filled["submission"]["photos"]["panel"]) == 1
    assert filled["pdf_url"] == f"/api/jobs/{data['job']}/forms/{form['id']}/certificate.pdf"
    # Form photos and signatures aren't the job's own photos or sign-off.
    assert done.get_json()["job"]["files"] == []
    assert JobEvent.query.filter_by(job_id=data["job"], action="form_completed").count() == 1
    # A photo for a question that isn't a photo, or a form not on the job, is refused.
    bad = client.post(f"/api/jobs/{data['job']}/files", headers=mech(auth), json={"kind": "form_photo", "form_field": f"{form['id']}:levels", "content_type": "image/jpeg", "size": 10})
    assert bad.status_code == 404
    # Signed: the signature can't be deleted.
    signature = JobFile.query.filter_by(kind="form_signature").one()
    assert client.delete(f"/api/files/{signature.id}", headers=mech(auth)).status_code == 409


def test_an_older_offline_change_doesnt_overwrite_a_newer_one(client, data, auth, business):
    form = make_form(client, auth, required=False)
    url = f"/api/jobs/{data['job']}/forms/{form['id']}"
    client.put(url, headers=mech(auth), json={"answers": {"result": "Fail"}})
    earlier = (utcnow() - timedelta(minutes=30)).isoformat() + "Z"
    late = client.put(url, headers={**mech(auth), "Idempotency-Key": "form-change-0001", "X-Client-Time": earlier}, json={"answers": {"result": "Pass"}})
    assert late.status_code == 200
    assert db.session.get(FormSubmission, FormSubmission.query.one().id).answers["result"] == "Fail"
    assert JobEvent.query.filter_by(job_id=data["job"], action="change_not_applied").count() == 1


def test_required_forms_hold_up_completing_the_job(client, data, auth, business):
    form = make_form(client, auth)
    job = data["job"]
    assert client.patch(f"/api/jobs/{job}", headers=mech(auth), json={"status": "In Progress"}).status_code == 200
    entry = client.get(f"/api/jobs/{job}", headers=mech(auth)).get_json()["job"]["entries"][-1]
    client.patch(f"/api/jobs/{job}/entries/{entry['id']}", headers=mech(auth), json={"work_done": "Serviced"})
    blocked = client.patch(f"/api/jobs/{job}", headers=mech(auth), json={"status": "Completed", **SIGNED})
    assert blocked.status_code == 409 and "Complete the form: Load test certificate" in blocked.get_json()["blockers"]
    # Turned off, it no longer applies to jobs that didn't start it.
    client.patch(f"/api/forms/{form['id']}", headers=boss(auth), json={"active": False})
    assert client.patch(f"/api/jobs/{job}", headers=mech(auth), json={"status": "Completed", **SIGNED}).status_code == 200
    # A finished job's forms can't change.
    assert client.put(f"/api/jobs/{job}/forms/{form['id']}", headers=boss(auth), json={"answers": {"levels": "no"}}).status_code in (404, 409)


def test_certificates_and_who_sees_them(client, data, auth, business):
    form = make_form(client, auth, fields=[q for q in QUESTIONS if q["type"] not in ("photo",)])
    internal = make_form(client, auth, name="Safety check", customer_visible=False, required=False, fields=[{"id": "safe", "type": "yesno", "label": "Area safe"}])
    signature = {"name": "Mech One", "image": SIGNATURE_PNG}
    answers = {"levels": "yes", "load_test": "yes", "load_kw": 60, "result": "Pass", "next_due": "2027-03-01", "signature": signature}
    assert client.put(f"/api/jobs/{data['job']}/forms/{form['id']}", headers=mech(auth), json={"answers": answers, "complete": True}).status_code == 200
    assert client.put(f"/api/jobs/{data['job']}/forms/{internal['id']}", headers=mech(auth), json={"answers": {"safe": "yes"}, "complete": True}).status_code == 200

    pdf = client.get(f"/api/jobs/{data['job']}/forms/{form['id']}/certificate.pdf", headers=boss(auth))
    assert pdf.status_code == 200 and pdf.mimetype == "application/pdf" and pdf.data.startswith(b"%PDF")
    # The customer gets the certificate, not the internal check.
    customer = auth("cust@acme.test")
    assert client.get(f"/api/jobs/{data['job']}/forms/{form['id']}/certificate.pdf", headers=customer).status_code == 200
    assert client.get(f"/api/jobs/{data['job']}/forms/{internal['id']}/certificate.pdf", headers=customer).status_code == 404
    seen = client.get(f"/api/jobs/{data['job']}", headers=customer).get_json()["job"]["forms"]
    assert [f["name"] for f in seen] == ["Load test certificate"] and "submission" not in seen[0]
    equipment = client.get(f"/api/machines/{data['machine']}", headers=customer).get_json()["machine"]
    assert [c["name"] for c in equipment["certificates"]] == ["Load test certificate"]
    assert {c["name"] for c in client.get(f"/api/machines/{data['machine']}", headers=boss(auth)).get_json()["machine"]["certificates"]} == {"Load test certificate", "Safety check"}
    # Other companies can't get it.
    assert client.get(f"/api/jobs/{data['job']}/forms/{form['id']}/certificate.pdf", headers=auth("boss@other.test")).status_code == 404


def test_the_company_logo(client, data, auth, business):
    picture = io.BytesIO()
    Image.new("RGB", (300, 100), (11, 107, 220)).save(picture, "PNG")
    image = "data:image/png;base64," + base64.b64encode(picture.getvalue()).decode()
    saved = client.put("/api/company/logo", headers=boss(auth), json={"image": image})
    assert saved.status_code == 200 and saved.get_json()["settings"]["logo_url"].startswith("/api/company/logo?v=")
    served = client.get("/api/company/logo", headers=mech(auth))
    assert served.status_code == 200 and served.mimetype == "image/png"
    for bad in ("data:image/gif;base64,R0lGODlh", "data:image/png;base64,bm90IGFuIGltYWdl", "hello"):
        assert client.put("/api/company/logo", headers=boss(auth), json={"image": bad}).status_code == 400
    assert client.put("/api/company/logo", headers=mech(auth), json={"image": image}).status_code == 403
    # The logo goes on the service report too.
    job = db.session.get(Job, data["job"])
    job.status = "Completed"
    db.session.commit()
    assert client.get(f"/api/jobs/{data['job']}/report.pdf", headers=boss(auth)).data.startswith(b"%PDF")
    key = db.session.get(Company, data["acme"]).logo_key
    assert client.delete("/api/company/logo", headers=boss(auth)).get_json()["settings"]["logo_url"] is None
    assert client.get("/api/company/logo", headers=mech(auth)).status_code == 404
    assert key and not storage().size(key)


def test_forms_on_a_service_follow_its_jobs(client, data, auth, business):
    service = ServiceTemplate(company_id=data["acme"], name="Generator service")
    db.session.add(service)
    db.session.commit()
    form = make_form(client, auth, job_types=[], service_ids=[service.id])
    plain = client.get(f"/api/jobs/{data['job']}", headers=boss(auth)).get_json()["job"]
    assert plain["forms"] == []
    made = client.post("/api/jobs", headers=boss(auth), json={"service_id": service.id, "machine_id": data["machine"]}).get_json()["job"]
    assert [f["form_id"] for f in client.get(f"/api/jobs/{made['id']}", headers=boss(auth)).get_json()["job"]["forms"]] == [form["id"]]
    assert FormTemplate.query.count() == 1
