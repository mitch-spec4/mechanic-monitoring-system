"""Equipment: details and sites, the history page, documents, maintenance plans, repeat faults."""
from datetime import date, datetime, timedelta

import pytest

from app import db
from app.models import Job, JobFile, MaintenancePlan, Notification, ServiceRecord, ServiceRequest, Site, User
from app.services import equipment
from app.utils.time import utcnow
from conftest import SIGNED


@pytest.fixture
def outbox(app):
    box = app.extensions["email"].outbox
    box.clear()
    return box


def boss(auth):
    return auth("boss@acme.test")


def mech(auth):
    return auth("mech@acme.test")


def customer(auth):
    return auth("cust@acme.test")


def new_site(client, auth, data, name="Main plant", **extra):
    response = client.post("/api/sites", headers=boss(auth), json={"customer_id": data["acme_customer"], "name": name, **extra})
    assert response.status_code == 201, response.get_json()
    return response.get_json()["site"]["id"]


def detail(client, headers, machine_id):
    response = client.get(f"/api/machines/{machine_id}", headers=headers)
    assert response.status_code == 200, response.get_json()
    return response.get_json()["machine"]


def complete(client, auth, job_id, problem="Belt slipping"):
    assert client.patch(f"/api/jobs/{job_id}", headers=mech(auth), json={"status": "In Progress"}).status_code == 200
    entry = client.get(f"/api/jobs/{job_id}", headers=mech(auth)).get_json()["job"]["entries"][-1]
    client.patch(f"/api/jobs/{job_id}/entries/{entry['id']}", headers=mech(auth), json={"work_done": "Fixed it"})
    client.put(f"/api/jobs/{job_id}/record", headers=mech(auth), json={"problem": problem})
    response = client.patch(f"/api/jobs/{job_id}", headers=mech(auth), json={"status": "Completed", **SIGNED})
    assert response.status_code == 200, response.get_json()


def test_equipment_details_and_sites(client, data, auth):
    site = new_site(client, auth, data, address="Plot 7, Enterprise Road")
    assert client.post("/api/sites", headers=boss(auth), json={"customer_id": data["acme_customer"], "name": "main PLANT"}).status_code == 409
    assert client.post("/api/sites", headers=boss(auth), json={"customer_id": data["other_customer"], "name": "Theirs"}).status_code == 404
    response = client.patch(
        f"/api/machines/{data['machine']}",
        headers=boss(auth),
        json={"equipment_type": "Generator", "manufacturer": "Caterpillar", "site_id": site, "installed_on": "2024-03-01", "notes": "Fuel tank 500 L"},
    )
    assert response.status_code == 200, response.get_json()
    machine = response.get_json()["machine"]
    assert machine["equipment_type"] == "Generator" and machine["site_id"] == site and machine["installed_on"] == "2024-03-01"

    # A site from another customer (or company) isn't allowed.
    other = Site(company_id=data["other"], customer_id=data["other_customer"], name="Elsewhere")
    db.session.add(other)
    db.session.commit()
    assert client.patch(f"/api/machines/{data['machine']}", headers=boss(auth), json={"site_id": other.id}).status_code == 404

    # Sites list their equipment; customers see their own.
    sites = client.get("/api/sites", headers=customer(auth)).get_json()["sites"]
    assert [(row["name"], row["machine_count"]) for row in sites] == [("Main plant", 1)]
    assert client.get("/api/sites", headers=auth("boss@other.test")).get_json()["sites"] == [{"id": other.id, "customer_id": data["other_customer"], "name": "Elsewhere", "address": None, "notes": None, "machine_count": 0}]
    assert client.get("/api/sites", headers=mech(auth)).status_code == 403
    page = client.get(f"/api/customers/{data['acme_customer']}", headers=boss(auth)).get_json()["customer"]
    assert page["sites"][0]["name"] == "Main plant" and page["sites"][0]["machine_count"] == 1

    # New jobs on the equipment go to its site.
    job = client.post("/api/jobs", headers=boss(auth), json={"title": "Service", "description": "d", "machine_id": data["machine"]}).get_json()["job"]
    assert job["location"] == "Main plant, Plot 7, Enterprise Road"
    named = client.post("/api/jobs", headers=boss(auth), json={"title": "Elsewhere", "description": "d", "machine_id": data["machine"], "location": "Gate B"})
    assert named.get_json()["job"]["location"] == "Gate B"

    # Deleting the site keeps the equipment.
    assert client.delete(f"/api/sites/{site}", headers=boss(auth)).status_code == 200
    assert client.get(f"/api/machines/{data['machine']}", headers=boss(auth)).get_json()["machine"]["site_id"] is None


def test_the_history_page_and_who_sees_it(client, data, auth):
    complete(client, auth, data["job"], problem="Overheats after an hour")
    for who in ("boss@acme.test", "cust@acme.test", "mech@acme.test"):
        page = detail(client, auth(who), data["machine"])
        assert page["name"] == "Generator" and page["customer"]["name"] == "Acme Customer"
        assert [job["title"] for job in page["jobs"]] == ["Fix generator"]
        assert any(fault["problem"] == "Overheats after an hour" for fault in page["faults"])
        assert page["can_edit"] is (who == "boss@acme.test")
        assert page["jobs"][0]["can_open"] is True
    # Another technician with no job on it, and other companies, don't.
    for who in ("mech2@acme.test", "boss@other.test", "mech@other.test"):
        assert client.get(f"/api/machines/{data['machine']}", headers=auth(who)).status_code == 404
    # Given a job on it, the other technician sees its history, but opens only their own job.
    mech2 = User.query.filter_by(email="mech2@acme.test").one()
    response = client.post("/api/jobs", headers=boss(auth), json={"title": "Second look", "description": "d", "machine_id": data["machine"], "mechanic_id": mech2.id})
    assert response.status_code == 201, response.get_json()
    page = detail(client, auth("mech2@acme.test"), data["machine"])
    assert {job["title"]: job["can_open"] for job in page["jobs"]} == {"Second look": True, "Fix generator": False}


def test_documents(client, data, auth, app):
    for who in (boss(auth), customer(auth)):
        reserved = client.post(
            f"/api/machines/{data['machine']}/documents", headers=who, json={"content_type": "application/pdf", "size": 12, "name": "Manual.pdf"}
        )
        assert reserved.status_code == 201, reserved.get_json()
        target = reserved.get_json()["upload"]
        assert client.put(target["url"], data=b"%PDF-1.4 abc", headers=target["headers"]).status_code == 204
        confirmed = client.post(f"/api/machines/{data['machine']}/documents/{reserved.get_json()['file_id']}/confirm", headers=who)
        assert confirmed.status_code == 200
    documents = confirmed.get_json()["machine"]["documents"]
    assert [d["name"] for d in documents] == ["Manual.pdf", "Manual.pdf"]

    # The technician who works on it can read them; downloads, never shown as a page.
    complete_free = documents[0]
    response = client.get(complete_free["url"], headers=mech(auth))
    assert response.status_code == 200 and response.data == b"%PDF-1.4 abc"
    assert "attachment" in response.headers["Content-Disposition"]
    # Done with the file: Windows can't delete it (below) while a response holds it open.
    response.close()
    assert client.get(complete_free["url"], headers=auth("mech2@acme.test")).status_code == 404
    assert client.get(complete_free["url"], headers=auth("boss@other.test")).status_code == 404

    bad = client.post(f"/api/machines/{data['machine']}/documents", headers=boss(auth), json={"content_type": "text/html", "size": 10, "name": "x.html"})
    assert bad.status_code == 415
    big = client.post(
        f"/api/machines/{data['machine']}/documents", headers=boss(auth), json={"content_type": "application/pdf", "size": 26 * 1024 * 1024, "name": "x.pdf"}
    )
    assert big.status_code == 413
    other_customer = client.post(
        f"/api/machines/{data['other_machine']}/documents", headers=customer(auth), json={"content_type": "application/pdf", "size": 1, "name": "x.pdf"}
    )
    assert other_customer.status_code == 404

    # A customer removes only what they added; a manager, anything.
    by_customer = next(d for d in documents if d["uploaded_by"] == "Acme Customer")
    by_boss = next(d for d in documents if d["uploaded_by"] == "Boss One")
    assert client.delete(f"/api/machines/{data['machine']}/documents/{by_boss['id']}", headers=customer(auth)).status_code == 403
    assert client.delete(f"/api/machines/{data['machine']}/documents/{by_customer['id']}", headers=customer(auth)).status_code == 200
    assert client.delete(f"/api/machines/{data['machine']}/documents/{by_boss['id']}", headers=boss(auth)).status_code == 200
    assert JobFile.query.filter_by(kind="document").count() == 0
    # Job photo routes don't touch documents.
    assert client.post(f"/api/files/{by_boss['id']}/confirm", headers=mech(auth)).status_code == 404


def test_month_arithmetic():
    assert equipment.add_interval(date(2026, 1, 31), 1, "months") == date(2026, 2, 28)
    assert equipment.add_interval(date(2026, 11, 15), 3, "months") == date(2027, 2, 15)
    assert equipment.add_interval(date(2026, 1, 1), 2, "weeks") == date(2026, 1, 15)
    assert equipment.add_interval(date(2026, 1, 1), 10, "days") == date(2026, 1, 11)


def test_maintenance_plans(client, data, auth, outbox):
    today = utcnow().date()
    bad = client.post(f"/api/machines/{data['machine']}/plans", headers=boss(auth), json={"title": "Oil", "every": 0, "unit": "months", "next_due": "2026-12-01"})
    assert bad.status_code == 400
    assert client.post(f"/api/machines/{data['machine']}/plans", headers=mech(auth), json={}).status_code == 403
    response = client.post(
        f"/api/machines/{data['machine']}/plans",
        headers=boss(auth),
        json={"title": "Oil and filter change", "job_type": "Preventive maintenance", "every": 3, "unit": "months", "next_due": (today + timedelta(days=5)).isoformat(), "lead_days": 7},
    )
    assert response.status_code == 201, response.get_json()
    [plan] = response.get_json()["machine"]["plans"]
    assert plan["state"] == "due" and plan["open_job_id"] is None

    # Due within its lead time: the equipment needs work.
    [row] = [m for m in client.get("/api/machines", headers=boss(auth)).get_json()["machines"] if m["id"] == data["machine"]]
    assert {"type": "maintenance", "id": plan["id"], "title": "Oil and filter change", "status": "Service due", "due": plan["next_due"]} in row["work"]

    # The daily run makes the job and tells the managers and the customer, once.
    sent = equipment.send_due_reminders()
    db.session.commit()
    assert sent == {"maintenance_jobs": 1, "service_due_reminders": 1}
    assert equipment.send_due_reminders() == {"maintenance_jobs": 0, "service_due_reminders": 0}
    job = Job.query.filter_by(plan_id=plan["id"]).one()
    assert job.status == "Pending" and job.due_date.isoformat() == plan["next_due"] and job.title == "Oil and filter change: Generator"
    assert {m["To"] for m in outbox} == {"boss@acme.test", "boss2@acme.test", "cust@acme.test"}
    assert all(m["Subject"] == "Service due" for m in outbox)
    assert Notification.query.filter_by(user_id=data["customer"], title="Service due").count() == 1
    # A job already open: not another one.
    assert client.post(f"/api/plans/{plan['id']}/job", headers=boss(auth)).status_code == 409

    # Completing it moves the next due date three months on from the day it was done.
    client.patch(f"/api/jobs/{job.id}", headers=boss(auth), json={"mechanic_id": data["mechanic"]})
    complete(client, auth, job.id)
    page = detail(client, boss(auth), data["machine"])
    [plan] = page["plans"]
    done = datetime.fromisoformat(plan["last_done"]).date()
    assert plan["next_due"] == equipment.add_interval(done, 3, "months").isoformat()
    assert plan["state"] == "scheduled" and plan["open_job_id"] is None
    # Routine maintenance isn't a fault.
    assert page["faults"] == []

    # Marked done outside the app, paused, created early, deleted.
    assert client.patch(f"/api/plans/{plan['id']}", headers=boss(auth), json={"done_on": "2027-01-10"}).status_code == 200
    assert db.session.get(MaintenancePlan, plan["id"]).next_due == date(2027, 4, 10)
    assert client.patch(f"/api/plans/{plan['id']}", headers=boss(auth), json={"active": False}).get_json()["machine"]["plans"][0]["state"] == "paused"
    early = client.post(f"/api/plans/{plan['id']}/job", headers=boss(auth))
    assert early.status_code == 201
    assert client.delete(f"/api/plans/{plan['id']}", headers=boss(auth)).status_code == 200
    assert db.session.get(Job, early.get_json()["job_id"]).plan_id is None


def test_repeat_faults(client, data, auth):
    """Two separate repairs in 90 days flag the equipment; an inspection and its repair count once."""
    assert detail(client, boss(auth), data["machine"])["repeat_fault"] is None
    complete(client, auth, data["job"])
    assert detail(client, boss(auth), data["machine"])["repeat_fault"] is None
    second = client.post(
        "/api/jobs", headers=boss(auth), json={"title": "Fix again", "description": "d", "machine_id": data["machine"], "mechanic_id": data["mechanic"], "job_type": "Repair"}
    ).get_json()["job"]
    complete(client, auth, second["id"])
    flagged = detail(client, boss(auth), data["machine"])
    assert flagged["repeat_fault"] == {"count": 2, "days": 90}
    [row] = [m for m in client.get("/api/machines", headers=boss(auth)).get_json()["machines"] if m["id"] == data["machine"]]
    assert row["repeat_faults"] == 2
    # Older than 90 days: no longer counted.
    for record in ServiceRecord.query.filter_by(machine_id=data["machine"]).all():
        record.service_date = utcnow() - timedelta(days=91)
    db.session.commit()
    assert detail(client, boss(auth), data["machine"])["repeat_fault"] is None

    # An inspection and the repair for the same request are one fault.
    request = ServiceRequest(customer_id=data["acme_customer"], company_id=data["acme"], machine_id=data["machine"], subject="Leak", description="d", status="Completed")
    db.session.add(request)
    db.session.flush()
    first, repair = (
        Job(company_id=data["acme"], machine_id=data["machine"], customer_id=data["acme_customer"], title=t, description="d", status="Completed", request_id=request.id)
        for t in ("Inspect", "Repair")
    )
    db.session.add_all([first, repair])
    db.session.flush()
    for job in (first, repair):
        db.session.add(ServiceRecord(job_id=job.id, machine_id=data["machine"], customer_id=data["acme_customer"], mechanic_id=data["mechanic"], company_id=data["acme"], service_type="Repair", problem="Leak"))
    db.session.commit()
    assert equipment.fault_counts(data["acme"], [data["machine"]]) == {data["machine"]: 1}


def test_deleting_equipment_takes_its_documents_and_plans(client, data, auth):
    created = client.post(
        "/api/machines", headers=boss(auth), json={"name": "Spare pump", "serial_no": "SP-1", "customer_id": data["acme_customer"], "equipment_type": "Pump"}
    ).get_json()["machine"]
    assert created["equipment_type"] == "Pump"
    reserved = client.post(f"/api/machines/{created['id']}/documents", headers=boss(auth), json={"content_type": "text/plain", "size": 3, "name": "a.txt"}).get_json()
    client.put(reserved["upload"]["url"], data=b"abc", headers=reserved["upload"]["headers"])
    client.post(f"/api/machines/{created['id']}/documents/{reserved['file_id']}/confirm", headers=boss(auth))
    client.post(f"/api/machines/{created['id']}/plans", headers=boss(auth), json={"title": "Check", "every": 1, "unit": "weeks", "next_due": "2026-12-01"})
    assert client.delete(f"/api/machines/{created['id']}", headers=boss(auth)).status_code == 200
    assert JobFile.query.filter_by(machine_id=created["id"]).count() == 0
    assert MaintenancePlan.query.filter_by(machine_id=created["id"]).count() == 0
    assert User.query.count() > 0
