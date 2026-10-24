"""Planning technicians' routes, and what jobs cost and make."""
import io
import json
from datetime import date, datetime, timedelta

import pytest

from app import db
from app.models import Company, Job, JobPart, LocationPoint, Machine, Notification, Shift, Site, User, WorkEntry
from app.services import routing
from app.services.insights import insights

# A line of places east of Nairobi's centre, about 1.1 km apart.
BASE = (-1.2921, 36.8219)
EAST = [(-1.2921, 36.8219 + 0.01 * step) for step in range(1, 6)]
DAY = date(2026, 10, 26)


def boss(auth):
    return auth("boss@acme.test")


def test_distances_and_the_best_order():
    # One hundredth of a degree of longitude at the equator is about 1.1 km.
    assert 1100 < routing.metres_between(BASE, EAST[0]) < 1120
    # Stops given out of order along a line: the plan drives straight along it.
    points = [BASE, EAST[3], EAST[0], EAST[4], EAST[1], EAST[2]]
    seconds, _metres = routing.StraightLine(25).matrix(points)
    assert routing.best_order(seconds, range(1, 6), start=0) == [2, 4, 5, 1, 3]
    # 2-opt untangles what nearest-first gets wrong: a crossing it leaves behind.
    square = [(0, 0), (0, 1), (1, 1), (1, 0), (0, 0.5)]
    cost = [[routing.metres_between(a, b) for b in square] for a in square]
    order = routing.best_order(cost, range(1, 5), start=0)
    assert routing.route_cost(order, cost) <= min(routing.route_cost(o, cost) for o in ([4, 1, 2, 3], [3, 2, 1, 4]))


@pytest.fixture
def day(data):
    """Mech One's jobs for DAY at five sites in a line, given out of order, plus a booked visit, a
    job with no pin and a job for another day."""
    company = db.session.get(Company, data["acme"])
    company.base_latitude, company.base_longitude = BASE
    jobs = {}
    for name, position in zip("DAEBC", [EAST[3], EAST[0], EAST[4], EAST[1], EAST[2]]):
        site = Site(company_id=data["acme"], customer_id=data["acme_customer"], name=f"Site {name}", latitude=position[0], longitude=position[1])
        db.session.add(site)
        db.session.flush()
        machine = Machine(name=f"Pump {name}", serial_no=f"P-{name}", customer_id=data["acme_customer"], company_id=data["acme"], site_id=site.id)
        db.session.add(machine)
        db.session.flush()
        job = Job(title=f"Stop {name}", description="d", company_id=data["acme"], customer_id=data["acme_customer"], machine_id=machine.id, mechanic_id=data["mechanic"], status="Assigned", due_date=DAY)
        db.session.add(job)
        db.session.flush()
        jobs[name] = job.id
    booked = Job(title="Booked visit", description="d", company_id=data["acme"], customer_id=data["acme_customer"], machine_id=machine.id, mechanic_id=data["mechanic"], status="Assigned", scheduled_start=datetime(2026, 10, 26, 7, 0))
    later = Job(title="Next week", description="d", company_id=data["acme"], customer_id=data["acme_customer"], machine_id=machine.id, mechanic_id=data["mechanic"], status="Assigned", due_date=DAY + timedelta(days=7))
    db.session.add_all([booked, later])
    # The fixture's own job (no site pin, no due date) is "not on the map".
    db.session.commit()
    return jobs


def test_a_manager_plans_and_saves_a_technicians_day(client, data, auth, day):
    response = client.get(f"/api/routes?mechanic_id={data['mechanic']}&date={DAY}", headers=boss(auth))
    assert response.status_code == 200, response.get_json()
    plan = response.get_json()["plan"]
    assert plan["start"]["kind"] == "base" and plan["estimate"] == "straight_line" and plan["fell_back"] is False
    assert [stop["title"] for stop in plan["stops"]] == ["Stop A", "Stop B", "Stop C", "Stop D", "Stop E"]
    assert [stop["stop"] for stop in plan["stops"]] == [1, 2, 3, 4, 5]
    # About 1.1 km x 1.3 a leg, at 25 km/h: a little over 3 minutes.
    assert 1400 < plan["stops"][1]["leg_metres"] < 1500 and 200 < plan["stops"][1]["leg_seconds"] < 220
    assert plan["suggested"]["metres"] < plan["current"]["metres"]
    assert [job["title"] for job in plan["booked"]] == ["Booked visit"]
    assert [job["title"] for job in plan["unplaced"]] == ["Fix generator"]
    assert plan["applied"] is False

    saved = client.post("/api/routes", headers=boss(auth), json={"mechanic_id": data["mechanic"], "date": DAY.isoformat(), "job_ids": plan["suggested"]["job_ids"]})
    assert saved.status_code == 200, saved.get_json()
    assert saved.get_json()["plan"]["applied"] is True
    orders = {job["title"]: job["route_order"] for job in client.get("/api/jobs", headers=auth("mech@acme.test")).get_json()["jobs"] if job["route_date"] == DAY.isoformat()}
    assert orders == {"Stop A": 1, "Stop B": 2, "Stop C": 3, "Stop D": 4, "Stop E": 5}
    note = Notification.query.filter_by(user_id=data["mechanic"]).order_by(Notification.id.desc()).first()
    assert note.title == "Your route is planned" and "5 stops on 26 Oct 2026" in note.message
    # The technician sees their own route.
    mine = client.get(f"/api/routes/mine?date={DAY}", headers=auth("mech@acme.test")).get_json()["plan"]
    assert [stop["title"] for stop in mine["stops"]] == ["Stop A", "Stop B", "Stop C", "Stop D", "Stop E"]

    # A shorter plan: the jobs left out lose their place.
    client.post("/api/routes", headers=boss(auth), json={"mechanic_id": data["mechanic"], "date": DAY.isoformat(), "job_ids": [day["E"], day["A"]]})
    assert db.session.get(Job, day["B"]).route_order is None and db.session.get(Job, day["E"]).route_order == 1

    # Only that technician's routable jobs, once each.
    for job_ids in ([day["A"], day["A"]], [data["job"]], ["x"]):
        response = client.post("/api/routes", headers=boss(auth), json={"mechanic_id": data["mechanic"], "date": DAY.isoformat(), "job_ids": job_ids})
        assert response.status_code in (400, 409), job_ids
    # Managers only, and only their own technicians.
    assert client.get(f"/api/routes?mechanic_id={data['mechanic']}", headers=auth("mech@acme.test")).status_code == 403
    assert client.get(f"/api/routes?mechanic_id={data['mechanic']}", headers=auth("boss@other.test")).status_code == 404
    assert client.post("/api/routes", headers=auth("boss@other.test"), json={"mechanic_id": data["mechanic"], "job_ids": []}).status_code == 404
    assert client.get("/api/routes/mine", headers=boss(auth)).status_code == 403


def test_the_day_starts_where_the_technician_is(app, data, day):
    company = db.session.get(Company, data["acme"])
    mechanic = db.session.get(User, data["mechanic"])
    now = datetime(2026, 10, 26, 9, 0)
    shift = Shift.query.filter_by(user_id=mechanic.id, clocked_out_at=None).one()
    shift.clocked_in_at = now - timedelta(hours=2)
    # At the far end of the line: the plan drives back towards the base.
    db.session.add(LocationPoint(company_id=company.id, user_id=mechanic.id, shift_id=shift.id, kind="live", latitude=EAST[4][0], longitude=EAST[4][1], recorded_at=now - timedelta(minutes=10)))
    db.session.commit()
    plan = routing.plan_day(company, mechanic, DAY, now=now)
    assert plan["start"]["kind"] == "position"
    assert [stop["title"] for stop in plan["stops"]] == ["Stop E", "Stop D", "Stop C", "Stop B", "Stop A"]
    assert plan["stops"][0]["leg_metres"] == 0
    # With no base and no position, the usual first stop starts the day.
    company.base_latitude = company.base_longitude = None
    plan = routing.plan_day(company, mechanic, DAY, now=now + timedelta(hours=5))
    assert plan["start"]["kind"] == "first_stop" and plan["stops"][0]["title"] == "Stop D"
    # A job under way is on the day's route whatever its due date, and first in the usual order.
    later = Job.query.filter_by(title="Next week").one()
    later.status = "In Progress"
    db.session.commit()
    plan = routing.plan_day(company, mechanic, DAY, now=now + timedelta(hours=5))
    assert plan["current"]["job_ids"][0] == later.id and later.id in plan["suggested"]["job_ids"]
    # Not on days already over.
    plan = routing.plan_day(company, mechanic, DAY - timedelta(days=1), now=now)
    assert later.id not in plan["current"]["job_ids"]


def test_drive_times_from_the_routing_service_and_the_fallback(app, data, day, monkeypatch):
    app.config["ROUTING_API_KEY"] = "test-key"
    sent = []

    def answer(request, timeout):
        body = json.loads(request.data)
        sent.append((request.full_url, request.headers.get("Authorization"), body))
        count = len(body["locations"])
        # A made-up road network: every pair 60 s and 1 km apart, except one pair it can't route.
        durations = [[0 if i == j else 60 for j in range(count)] for i in range(count)]
        distances = [[0 if i == j else 1000 for j in range(count)] for i in range(count)]
        durations[0][1] = None
        return io.BytesIO(json.dumps({"durations": durations, "distances": distances}).encode())

    monkeypatch.setattr(routing.urllib.request, "urlopen", answer)
    company = db.session.get(Company, data["acme"])
    plan = routing.plan_day(company, db.session.get(User, data["mechanic"]), DAY)
    assert plan["estimate"] == "openrouteservice" and plan["fell_back"] is False
    url, key, body = sent[0]
    assert url == routing.OpenRouteService.URL and key == "test-key"
    assert body["locations"][0] == [BASE[1], BASE[0]] and body["metrics"] == ["duration", "distance"]
    assert all(stop["leg_metres"] == 1000 for stop in plan["stops"][1:])

    def broken(request, timeout):
        raise routing.urllib.error.URLError("no route to host")

    monkeypatch.setattr(routing.urllib.request, "urlopen", broken)
    plan = routing.plan_day(company, db.session.get(User, data["mechanic"]), DAY)
    assert plan["estimate"] == "straight_line" and plan["fell_back"] is True
    assert [stop["title"] for stop in plan["stops"]] == ["Stop A", "Stop B", "Stop C", "Stop D", "Stop E"]


def test_pins_for_the_base_and_sites(client, data, auth):
    response = client.patch("/api/company/settings", headers=boss(auth), json={"base": {"latitude": -1.3081, "longitude": 36.8511}})
    assert response.status_code == 200 and response.get_json()["settings"]["base"] == {"latitude": -1.3081, "longitude": 36.8511}
    assert client.patch("/api/company/settings", headers=boss(auth), json={"base": None}).get_json()["settings"]["base"] is None
    for bad in ({"latitude": 91, "longitude": 0}, {"latitude": "x", "longitude": 0}, {"latitude": 1}, "here"):
        assert client.patch("/api/company/settings", headers=boss(auth), json={"base": bad}).status_code == 400, bad

    site = client.post("/api/sites", headers=boss(auth), json={"customer_id": data["acme_customer"], "name": "Plant", "position": {"latitude": -1.2, "longitude": 36.9}}).get_json()["site"]
    assert site["position"] == {"latitude": -1.2, "longitude": 36.9}
    db.session.get(Machine, data["machine"]).site_id = site["id"]
    db.session.commit()
    # A job on its equipment is at the site: for directions.
    assert client.get(f"/api/jobs/{data['job']}", headers=auth("mech@acme.test")).get_json()["job"]["position"] == {"latitude": -1.2, "longitude": 36.9}
    moved = client.patch(f"/api/sites/{site['id']}", headers=boss(auth), json={"position": None}).get_json()["site"]
    assert moved["position"] is None


def test_what_a_job_cost_and_made(client, data, auth):
    # Pay rates: managers set them, for technicians only.
    assert client.patch(f"/api/users/{data['mechanic']}", headers=boss(auth), json={"pay_rate": "500"}).status_code == 200
    assert client.patch(f"/api/users/{data['boss2']}", headers=boss(auth), json={"pay_rate": 500}).status_code == 400
    assert client.patch(f"/api/users/{data['mechanic']}", headers=auth("mech@acme.test"), json={"pay_rate": 9999}).status_code == 403
    for bad in ("-1", "lots", True, 10**12):
        assert client.patch(f"/api/users/{data['mechanic']}", headers=boss(auth), json={"pay_rate": bad}).status_code == 400, bad
    mechanics = client.get("/api/users/mechanics", headers=boss(auth)).get_json()["mechanics"]
    assert {m["name"]: m["pay_rate_cents"] for m in mechanics} == {"Mech One": 50000, "Mech Two": None}

    # 2.5 h by Mech One at 500 an hour, and 1 h by Mech Two with no rate yet.
    start = datetime(2026, 10, 20, 8, 0)
    db.session.add_all(
        [
            WorkEntry(job_id=data["job"], mechanic_id=data["mechanic"], started_at=start, ended_at=start + timedelta(hours=2.5)),
            WorkEntry(job_id=data["job"], mechanic_id=data["mechanic2"], started_at=start, ended_at=start + timedelta(hours=1)),
        ]
    )
    belt = JobPart(job_id=data["job"], name="Belt", quantity=2, added_by=data["mechanic"])
    oil = JobPart(job_id=data["job"], name="Oil (L)", quantity=1.5, added_by=data["mechanic"])
    db.session.add_all([belt, oil])
    db.session.commit()

    response = client.patch(f"/api/jobs/{data['job']}/costing", headers=boss(auth), json={"charged": "4,500", "parts": [{"id": belt.id, "unit_cost": 750.5}]})
    assert response.status_code == 200, response.get_json()
    costing = response.get_json()["job"]["costing"]
    assert costing["labour"] == [
        {"mechanic_id": data["mechanic"], "name": "Mech One", "hours": 2.5, "rate_cents": 50000, "cost_cents": 125000},
        {"mechanic_id": data["mechanic2"], "name": "Mech Two", "hours": 1.0, "rate_cents": None, "cost_cents": None},
    ]
    assert [(p["name"], p["cost_cents"]) for p in costing["parts"]] == [("Belt", 150100), ("Oil (L)", None)]
    assert (costing["labour_cents"], costing["parts_cents"], costing["cost_cents"]) == (125000, 150100, 275100)
    assert (costing["charged_cents"], costing["margin_cents"], costing["margin_percent"]) == (450000, 174900, 39)
    assert costing["missing_rates"] == ["Mech Two"] and costing["missing_costs"] == ["Oil (L)"]

    # Managers only: technicians and customers never see money.
    assert "costing" not in client.get(f"/api/jobs/{data['job']}", headers=auth("mech@acme.test")).get_json()["job"]
    assert "costing" not in client.get(f"/api/jobs/{data['job']}", headers=auth("cust@acme.test")).get_json()["job"]
    assert client.patch(f"/api/jobs/{data['job']}/costing", headers=auth("mech@acme.test"), json={"charged": 1}).status_code == 403
    for body in ({"charged": "free"}, {"parts": [{"id": 999999, "unit_cost": 1}]}, {"parts": "belt"}):
        assert client.patch(f"/api/jobs/{data['job']}/costing", headers=boss(auth), json=body).status_code in (400, 404), body
    # Clearing the charge clears the margin.
    cleared = client.patch(f"/api/jobs/{data['job']}/costing", headers=boss(auth), json={"charged": None}).get_json()["job"]["costing"]
    assert cleared["margin_cents"] is None and cleared["margin_percent"] is None


def test_insights_add_up_the_money(app, data):
    job = db.session.get(Job, data["job"])
    db.session.get(User, data["mechanic"]).pay_rate_cents = 40000
    job.charged_cents = 300000
    job.status = "Completed"
    from app.models import JobEvent

    db.session.add(JobEvent(job_id=job.id, action="status", to_status="Completed", created_at=datetime(2026, 10, 3, 9, 0)))
    db.session.add(WorkEntry(job_id=job.id, mechanic_id=data["mechanic"], started_at=datetime(2026, 10, 3, 6, 0), ended_at=datetime(2026, 10, 3, 8, 0)))
    db.session.add(JobPart(job_id=job.id, name="Seal", quantity=1, unit_cost_cents=25000, added_by=data["mechanic"]))
    db.session.commit()
    money = insights(db.session.get(Company, data["acme"]), date(2026, 10, 1), date(2026, 10, 7), now=datetime(2026, 10, 10))["money"]
    assert money == {
        "currency": "KES",
        "labour_cents": 80000,
        "parts_cents": 25000,
        "cost_cents": 105000,
        "charged_jobs": 1,
        "charged_cents": 300000,
        "margin_cents": 195000,
        "incomplete_jobs": 0,
    }
