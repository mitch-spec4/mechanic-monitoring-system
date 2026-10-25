"""The service catalog: managing services, a job from one in one tap, customers booking them, and
their time in route plans."""
import csv
import io
import zipfile
from datetime import date, datetime

import pytest

from app import db
from app.models import ChecklistTemplate, ChecklistTemplateItem, Job, JobChecklistItem, Machine, Notification, ServiceRequest, ServiceTemplate, Site, User
from app.services import booking
from app.services.data_export import build_export
from conftest import SIGNED

# Monday 2 November 2026, 09:00 in Nairobi.
NOW = datetime(2026, 11, 2, 6, 0)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(booking, "utcnow", lambda: NOW)


@pytest.fixture
def catalog(data):
    """A checklist, a generator, and three services: booked directly, inspection first, managers only."""
    checklist = ChecklistTemplate(company_id=data["acme"], job_type="Generator service")
    db.session.add(checklist)
    db.session.flush()
    for position, label in enumerate(("Change oil and filters", "Load test")):
        db.session.add(ChecklistTemplateItem(template_id=checklist.id, label=label, required=True, position=position))
    db.session.get(Machine, data["machine"]).equipment_type = "Generator"
    services = {
        "direct": ServiceTemplate(
            company_id=data["acme"], name="Generator 500-hour service", description="Oil, filters and a load test.", equipment_type="Generator",
            checklist_id=checklist.id, duration_minutes=180, skills=["Generators", "Electrical"], booking="direct",
        ),
        "inspection": ServiceTemplate(company_id=data["acme"], name="Breakdown call-out", duration_minutes=150, booking="inspection"),
        "none": ServiceTemplate(company_id=data["acme"], name="Belt replacement", equipment_type="Conveyor", duration_minutes=240, booking="none"),
    }
    db.session.add_all(services.values())
    db.session.commit()
    return {"checklist": checklist.id, **{key: service.id for key, service in services.items()}}


def boss(auth):
    return auth("boss@acme.test")


def customer(auth):
    return auth("cust@acme.test")


def mech(auth):
    return auth("mech@acme.test")


def test_managers_keep_the_catalog(client, data, auth, catalog):
    created = client.post(
        "/api/catalog",
        headers=boss(auth),
        json={
            "name": "  Pump overhaul ",
            "description": "Seals, bearings and impeller.",
            "equipment_type": "Pump",
            "checklist_id": catalog["checklist"],
            "duration_minutes": 240,
            "skills": ["Hydraulics", " hydraulics", "Welding"],
            "booking": "inspection",
        },
    )
    assert created.status_code == 201, created.get_json()
    service = created.get_json()["service"]
    assert service["name"] == "Pump overhaul" and service["skills"] == ["Hydraulics", "Welding"]
    assert service["checklist"] == {"id": catalog["checklist"], "job_type": "Generator service", "items": 2}
    assert service["active"] and service["jobs"] == 0

    # Defaults: an hour, managers only, no checklist.
    plain = client.post("/api/catalog", headers=boss(auth), json={"name": "Site survey"}).get_json()["service"]
    assert (plain["duration_minutes"], plain["booking"], plain["checklist"], plain["skills"]) == (60, "none", None, [])

    for body, message in (
        ({"name": "pump OVERHAUL"}, "already a service"),
        ({"name": "Long", "duration_minutes": 10}, "between"),
        ({"name": "Long", "duration_minutes": 600}, "one working day"),
        ({"name": "Long", "booking": "sometimes"}, "must be one of"),
        ({"name": "Long", "skills": "Welding"}, "list"),
        ({"name": "Long", "skills": ["x" * 41]}, "40 characters"),
        ({"name": "Long", "skills": [f"Skill {n}" for n in range(11)]}, "at most 10"),
    ):
        response = client.post("/api/catalog", headers=boss(auth), json=body)
        assert response.status_code in (400, 409) and message in response.get_json()["error"], (body, response.get_json())
    # Another company's checklist can't be used.
    other = ChecklistTemplate(company_id=data["other"], job_type="Theirs")
    db.session.add(other)
    db.session.commit()
    assert client.post("/api/catalog", headers=boss(auth), json={"name": "Theirs", "checklist_id": other.id}).status_code == 404

    names = [s["name"] for s in client.get("/api/catalog", headers=boss(auth)).get_json()["services"]]
    assert names == ["Belt replacement", "Breakdown call-out", "Generator 500-hour service", "Pump overhaul", "Site survey"]

    edited = client.patch(f"/api/catalog/{service['id']}", headers=boss(auth), json={"duration_minutes": 300, "checklist_id": None, "active": False}).get_json()["service"]
    assert (edited["duration_minutes"], edited["checklist"], edited["active"]) == (300, None, False)
    # Unused: deleted. Used: turned off instead, so its jobs keep it.
    assert client.delete(f"/api/catalog/{plain['id']}", headers=boss(auth)).status_code == 200
    client.post("/api/jobs", headers=boss(auth), json={"service_id": catalog["direct"], "machine_id": data["machine"]})
    used = client.delete(f"/api/catalog/{catalog['direct']}", headers=boss(auth))
    assert used.status_code == 409 and "Turn it off" in used.get_json()["error"]

    # Deleting a checklist leaves its services without one.
    client.delete(f"/api/checklists/{catalog['checklist']}", headers=boss(auth))
    assert db.session.get(ServiceTemplate, catalog["direct"]).checklist_id is None

    # Technicians don't manage it; other companies don't see it.
    assert client.get("/api/catalog", headers=mech(auth)).status_code == 403
    assert client.post("/api/catalog", headers=mech(auth), json={"name": "Mine"}).status_code == 403
    assert client.get("/api/catalog", headers=auth("boss@other.test")).get_json()["services"] == []


def test_a_job_from_a_service_in_one_tap(client, data, auth, catalog):
    response = client.post(
        "/api/jobs", headers=boss(auth), json={"service_id": catalog["direct"], "machine_id": data["machine"], "mechanic_id": data["mechanic"]}
    )
    assert response.status_code == 201, response.get_json()
    job = response.get_json()["job"]
    assert job["title"] == "Generator 500-hour service" and job["description"] == "Oil, filters and a load test."
    assert job["job_type"] == "Generator service" and job["estimated_minutes"] == 180
    assert job["service"] == {"id": catalog["direct"], "name": "Generator 500-hour service", "skills": ["Generators", "Electrical"]}
    assert job["customer_id"] == data["acme_customer"]
    # Assigned, so the technician has the service's checklist.
    assert [i.label for i in JobChecklistItem.query.filter_by(job_id=job["id"]).order_by(JobChecklistItem.position)] == ["Change oil and filters", "Load test"]
    assert client.get(f"/api/jobs/{job['id']}", headers=mech(auth)).get_json()["job"]["service"]["skills"] == ["Generators", "Electrical"]

    # What the form says wins over the service.
    own = client.post(
        "/api/jobs", headers=boss(auth), json={"service_id": catalog["inspection"], "title": "Call-out at the yard", "estimated_minutes": 45}
    ).get_json()["job"]
    assert (own["title"], own["description"], own["estimated_minutes"], own["job_type"]) == ("Call-out at the yard", "Breakdown call-out", 45, None)

    # The estimate can be changed later.
    changed = client.patch(f"/api/jobs/{own['id']}", headers=boss(auth), json={"estimated_minutes": 90})
    assert changed.get_json()["job"]["estimated_minutes"] == 90
    assert client.patch(f"/api/jobs/{own['id']}", headers=boss(auth), json={"estimated_minutes": 2}).status_code == 400

    # A service for other equipment, a turned-off one and another company's are refused.
    wrong = client.post("/api/jobs", headers=boss(auth), json={"service_id": catalog["none"], "machine_id": data["machine"]})
    assert wrong.status_code == 400 and "Conveyor equipment" in wrong.get_json()["error"]
    db.session.get(ServiceTemplate, catalog["inspection"]).active = False
    db.session.commit()
    assert client.post("/api/jobs", headers=boss(auth), json={"service_id": catalog["inspection"]}).status_code == 404
    assert client.post("/api/jobs", headers=auth("boss@other.test"), json={"service_id": catalog["direct"]}).status_code == 404
    # Without a service, the title and description are still needed.
    assert client.post("/api/jobs", headers=boss(auth), json={"title": "Only a title"}).status_code == 400


def slots(client, auth, rid):
    return client.get(f"/api/customers/requests/{rid}/slots", headers=customer(auth)).get_json()


def finish(client, auth, job_id):
    """The technician the booking picked does the visit and the customer signs."""
    assert db.session.get(Job, job_id).mechanic_id == User.query.filter_by(email="mech@acme.test").one().id
    assert client.patch(f"/api/jobs/{job_id}", headers=mech(auth), json={"status": "In Progress"}).status_code == 200
    entry = client.get(f"/api/jobs/{job_id}", headers=mech(auth)).get_json()["job"]["entries"][-1]
    client.patch(f"/api/jobs/{job_id}/entries/{entry['id']}", headers=mech(auth), json={"work_done": "Serviced"})
    client.put(f"/api/jobs/{job_id}/record", headers=mech(auth), json={"problem": "Due", "advice": "Next at 1000 hours"})
    for item in JobChecklistItem.query.filter_by(job_id=job_id).all():
        client.patch(f"/api/jobs/{job_id}/checklist/{item.id}", headers=mech(auth), json={"done": True})
    response = client.patch(f"/api/jobs/{job_id}", headers=mech(auth), json={"status": "Completed", **SIGNED})
    assert response.status_code == 200, response.get_json()


def test_customers_book_a_service_directly(client, data, auth, catalog):
    # Customers see the services they can book that fit their equipment.
    offered = client.get(f"/api/catalog?machine_id={data['machine']}", headers=customer(auth)).get_json()["services"]
    assert [s["name"] for s in offered] == ["Breakdown call-out", "Generator 500-hour service"]
    assert "checklist" not in offered[0] and "skills" not in offered[0]
    assert client.get(f"/api/catalog?machine_id={data['other_machine']}", headers=customer(auth)).status_code == 404

    response = client.post("/api/customers/requests", headers=customer(auth), json={"machine_id": data["machine"], "service_id": catalog["direct"]})
    assert response.status_code == 201, response.get_json()
    rid = response.get_json()["id"]
    detail = client.get(f"/api/customers/requests/{rid}", headers=customer(auth)).get_json()["request"]
    assert detail["subject"] == "Generator 500-hour service" and detail["booking"] == "direct"
    assert detail["service"]["name"] == "Generator 500-hour service" and detail["can_book"] == "service"

    # The times offered fit the service's 3 hours.
    free = slots(client, auth, rid)
    assert free["visit"] == "service" and free["minutes"] == 180
    start = free["slots"][0]["start"]
    booked = client.post(f"/api/customers/requests/{rid}/book", headers=customer(auth), json={"start": start})
    assert booked.status_code == 200, booked.get_json()
    assert booked.get_json()["request"]["status"] == "Service booked"
    job = Job.query.filter_by(request_id=rid).one()
    assert (job.visit, job.job_type, job.service_id, job.estimated_minutes) == ("service", "Generator service", catalog["direct"], 180)
    assert (job.scheduled_end - job.scheduled_start).total_seconds() == 3 * 3600
    assert "Visit booked" in [n.title for n in Notification.query.filter_by(user_id=data["customer"]).all()]

    finish(client, auth, job.id)
    assert db.session.get(ServiceRequest, rid).status == "Completed"
    assert "Work completed" in [n.title for n in Notification.query.filter_by(user_id=data["customer"]).all()]


def test_a_service_booked_with_an_inspection_first(client, data, auth, catalog):
    rid = client.post(
        "/api/customers/requests", headers=customer(auth), json={"machine_id": data["machine"], "service_id": catalog["inspection"], "description": "Won't start."}
    ).get_json()["id"]
    request = db.session.get(ServiceRequest, rid)
    assert (request.booking, request.description) == ("inspection", "Won't start.")
    company_inspection = slots(client, auth, rid)
    assert company_inspection["visit"] == "inspection" and company_inspection["minutes"] == 120
    client.post(f"/api/customers/requests/{rid}/book", headers=customer(auth), json={"start": company_inspection["slots"][0]["start"]})
    inspection = Job.query.filter_by(request_id=rid, visit="inspection").one()
    assert inspection.job_type == "Inspection"
    finish(client, auth, inspection.id)
    # The repair takes the service's time, until a manager sets another.
    repair = slots(client, auth, rid)
    assert repair["visit"] == "repair" and repair["minutes"] == 150
    client.patch(f"/api/customers/requests/{rid}", headers=boss(auth), json={"repair_minutes": 90})
    assert slots(client, auth, rid)["minutes"] == 90


def test_customers_cant_book_what_isnt_offered(client, data, auth, catalog):
    # Managers only: not bookable.
    response = client.post("/api/customers/requests", headers=customer(auth), json={"machine_id": data["machine"], "service_id": catalog["none"]})
    assert response.status_code == 404
    other_type = ServiceTemplate(company_id=data["acme"], name="Pump service", equipment_type="Pump", booking="direct")
    db.session.add(other_type)
    db.session.commit()
    wrong = client.post("/api/customers/requests", headers=customer(auth), json={"machine_id": data["machine"], "service_id": other_type.id})
    assert wrong.status_code == 400 and "Pump equipment" in wrong.get_json()["error"]
    # Without a service, they still describe what they need.
    assert client.post("/api/customers/requests", headers=customer(auth), json={"machine_id": data["machine"]}).status_code == 400
    plain = client.post("/api/customers/requests", headers=customer(auth), json={"machine_id": data["machine"], "subject": "Noise", "description": "Loud"})
    assert plain.status_code == 201 and db.session.get(ServiceRequest, plain.get_json()["id"]).booking == "inspection"


def test_route_plans_add_up_the_work(client, data, auth, catalog):
    site = Site(company_id=data["acme"], customer_id=data["acme_customer"], name="Plant", latitude=-1.30, longitude=36.85)
    db.session.add(site)
    db.session.flush()
    db.session.get(Machine, data["machine"]).site_id = site.id
    db.session.commit()
    day = date(2026, 11, 2)
    for service in ("direct", "inspection"):
        client.post(
            "/api/jobs",
            headers=boss(auth),
            json={"service_id": catalog[service], "machine_id": data["machine"], "mechanic_id": data["mechanic"], "due_date": day.isoformat()},
        )
    plan = client.get(f"/api/routes?mechanic_id={data['mechanic']}&date={day}", headers=boss(auth)).get_json()["plan"]
    # 3 h + 2½ h from the services; the fixture's own job has no estimate.
    assert plan["work"] == {"minutes": 330, "unestimated": 1, "day_minutes": 540}
    assert sorted(stop["estimated_minutes"] or 0 for stop in plan["stops"]) == [0, 150, 180]


def test_services_are_in_the_export(app, data, catalog):
    archive = zipfile.ZipFile(io.BytesIO(build_export(data["acme"])[0]))
    rows = list(csv.DictReader(io.StringIO(archive.read("services.csv").decode("utf-8-sig"))))
    direct = next(row for row in rows if row["name"] == "Generator 500-hour service")
    assert direct["skills"] == "Generators; Electrical" and direct["booking"] == "direct"
