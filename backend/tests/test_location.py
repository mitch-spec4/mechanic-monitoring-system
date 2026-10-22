from datetime import timedelta

from app import db
from app.models import Job, LocationPoint, Shift
from app.utils.time import utcnow

HERE = {"latitude": -1.2921, "longitude": 36.8219, "accuracy": 12}


def mech(auth):
    return auth("mech@acme.test")


def mech2(auth):
    return auth("mech2@acme.test")


def boss(auth):
    return auth("boss@acme.test")


def give_job(data, mechanic_key="mechanic2", status="Assigned"):
    job = Job(
        title="Pump check",
        description="Noisy",
        company_id=data["acme"],
        customer_id=data["acme_customer"],
        machine_id=data["machine"],
        mechanic_id=data[mechanic_key],
        status=status,
    )
    db.session.add(job)
    db.session.commit()
    return job.id


def clock_in_mech2(client, auth):
    assert client.post("/api/shifts/consent", headers=mech2(auth), json={"consent": True}).status_code == 200
    response = client.post("/api/shifts/clock-in", headers=mech2(auth), json=HERE)
    assert response.status_code == 201, response.get_json()
    return response.get_json()


def test_clock_in_needs_consent_and_a_location(client, data, auth):
    response = client.post("/api/shifts/clock-in", headers=mech2(auth), json=HERE)
    assert response.status_code == 409 and "Agree to location sharing" in response.get_json()["error"]

    client.post("/api/shifts/consent", headers=mech2(auth), json={"consent": True})
    for body in ({}, {"location_error": "denied"}, {"location_error": "unavailable"}):
        response = client.post("/api/shifts/clock-in", headers=mech2(auth), json=body)
        assert response.status_code == 422 and "location is needed" in response.get_json()["error"]
    assert Shift.query.filter_by(user_id=data["mechanic2"]).count() == 0

    status = client.post("/api/shifts/clock-in", headers=mech2(auth), json=HERE).get_json()
    assert status["consent"] is True and status["shift"]["open"] is True
    point = LocationPoint.query.filter_by(user_id=data["mechanic2"]).one()
    assert (point.kind, point.latitude, point.longitude, point.accuracy_m) == ("clock_in", -1.2921, 36.8219, 12)

    again = client.post("/api/shifts/clock-in", headers=mech2(auth), json=HERE)
    assert again.status_code == 409


def test_bad_coordinates_are_rejected(client, data, auth):
    client.post("/api/shifts/consent", headers=mech2(auth), json={"consent": True})
    for body in (
        {"latitude": 91, "longitude": 0},
        {"latitude": 0, "longitude": -181},
        {"latitude": "x", "longitude": 0},
        {"latitude": True, "longitude": 0},
        {"latitude": 0, "longitude": 0, "accuracy": -5},
    ):
        assert client.post("/api/shifts/clock-in", headers=mech2(auth), json=body).status_code == 400
    assert Shift.query.filter_by(user_id=data["mechanic2"]).count() == 0


def test_clock_out_works_without_a_location_and_pauses_running_jobs(client, data, auth):
    clock_in_mech2(client, auth)
    job_id = give_job(data)
    assert client.patch(f"/api/jobs/{job_id}", headers=mech2(auth), json={"status": "In Progress", **HERE}).status_code == 200

    response = client.post("/api/shifts/clock-out", headers=mech2(auth), json={"location_error": "denied"})
    assert response.status_code == 200
    assert response.get_json()["shift"] is None and response.get_json()["paused_jobs"] == ["Pump check"]
    assert db.session.get(Job, job_id).status == "Paused"
    detail = client.get(f"/api/jobs/{job_id}", headers=mech2(auth)).get_json()["job"]
    assert detail["timer_running"] is False
    stamp = LocationPoint.query.filter_by(user_id=data["mechanic2"], kind="clock_out").one()
    assert stamp.latitude is None and stamp.missing_reason == "denied"

    assert client.post("/api/shifts/clock-out", headers=mech2(auth), json={}).status_code == 409


def test_work_can_only_start_while_clocked_in(client, data, auth):
    job_id = give_job(data)
    response = client.patch(f"/api/jobs/{job_id}", headers=mech2(auth), json={"status": "In Progress"})
    assert response.status_code == 409 and response.get_json()["error"] == "Clock in before starting work"
    response = client.patch(f"/api/jobs/{job_id}", headers=boss(auth), json={"status": "In Progress"})
    assert response.status_code == 409 and "Mech Two isn't clocked in" in response.get_json()["error"]

    clock_in_mech2(client, auth)
    assert client.patch(f"/api/jobs/{job_id}", headers=mech2(auth), json={"status": "In Progress"}).status_code == 200


def test_job_start_and_complete_are_stamped_and_hidden_from_customers(client, data, auth):
    clock_in_mech2(client, auth)
    job_id = give_job(data)
    client.patch(f"/api/jobs/{job_id}", headers=mech2(auth), json={"status": "In Progress", **HERE})
    entry = client.get(f"/api/jobs/{job_id}", headers=mech2(auth)).get_json()["job"]["entries"][0]
    client.patch(f"/api/jobs/{job_id}/entries/{entry['id']}", headers=mech2(auth), json={"work_done": "Greased"})
    response = client.patch(f"/api/jobs/{job_id}", headers=mech2(auth), json={"status": "Completed", "location_error": "timeout"})
    assert response.status_code == 200, response.get_json()

    stamps = client.get(f"/api/jobs/{job_id}", headers=boss(auth)).get_json()["job"]["locations"]
    assert [(s["kind"], s["latitude"], s["missing_reason"]) for s in stamps] == [
        ("job_start", -1.2921, None),
        ("job_complete", None, "timeout"),
    ]
    customer_view = client.get(f"/api/jobs/{job_id}", headers=auth("cust@acme.test")).get_json()["job"]
    assert "locations" not in customer_view


def test_mechanics_can_only_send_status_and_location_on_jobs(client, data, auth):
    response = client.patch(f"/api/jobs/{data['job']}", headers=mech(auth), json={"status": "In Progress", "title": "X"})
    assert response.status_code == 403


def test_live_location_only_during_an_active_job(client, data, auth):
    job_id = give_job(data, "mechanic")
    body = {**HERE, "job_id": job_id}
    assert client.post("/api/location/live", headers=mech(auth), json=body).status_code == 409

    client.patch(f"/api/jobs/{job_id}", headers=mech(auth), json={"status": "In Progress", **HERE})
    first = client.post("/api/location/live", headers=mech(auth), json=body)
    assert first.status_code == 201 and first.get_json()["saved"] is True
    # A second position inside a minute is accepted but not stored.
    assert client.post("/api/location/live", headers=mech(auth), json=body).get_json()["saved"] is False
    assert LocationPoint.query.filter_by(kind="live").count() == 1

    # Another mechanic's job, or a job in another company, is not found.
    assert client.post("/api/location/live", headers=mech2(auth), json=body).status_code == 404
    assert client.post("/api/location/live", headers=auth("mech@other.test"), json=body).status_code == 404


def test_consent_cannot_be_withdrawn_while_clocked_in(client, data, auth):
    response = client.post("/api/shifts/consent", headers=mech(auth), json={"consent": False})
    assert response.status_code == 409 and "Clock out first" in response.get_json()["error"]
    client.post("/api/shifts/clock-out", headers=mech(auth), json=HERE)
    status = client.post("/api/shifts/consent", headers=mech(auth), json={"consent": False}).get_json()
    assert status["consent"] is False
    assert client.post("/api/shifts/clock-in", headers=mech(auth), json=HERE).status_code == 409
    assert client.post("/api/shifts/consent", headers=mech(auth), json={"consent": "yes"}).status_code == 400


def test_team_map_shows_only_clocked_in_mechanics_to_their_boss(client, data, auth):
    clock_in_mech2(client, auth)
    team = client.get("/api/location/team", headers=boss(auth)).get_json()["team"]
    by_name = {row["name"]: row for row in team}
    assert set(by_name) == {"Mech One", "Mech Two"}
    assert by_name["Mech Two"]["last"]["latitude"] == -1.2921
    assert by_name["Mech One"]["last"] is None  # clocked in by the fixture, no position yet

    client.post("/api/shifts/clock-out", headers=mech2(auth), json=HERE)
    names = [row["name"] for row in client.get("/api/location/team", headers=boss(auth)).get_json()["team"]]
    assert names == ["Mech One"]

    assert client.get("/api/location/team", headers=auth("boss@other.test")).get_json()["team"] == []
    for who in ("mech@acme.test", "cust@acme.test"):
        assert client.get("/api/location/team", headers=auth(who)).status_code == 403


def test_shift_list_is_scoped_by_role_and_company(client, data, auth):
    clock_in_mech2(client, auth)
    own = client.get("/api/shifts", headers=mech2(auth)).get_json()["shifts"]
    assert [s["user_id"] for s in own] == [data["mechanic2"]]
    assert own[0]["clock_in_location"]["latitude"] == -1.2921

    everyone = client.get("/api/shifts", headers=boss(auth)).get_json()["shifts"]
    assert {s["user_id"] for s in everyone} == {data["mechanic"], data["mechanic2"]}
    filtered = client.get(f"/api/shifts?mechanic_id={data['mechanic']}", headers=boss(auth)).get_json()["shifts"]
    assert {s["user_id"] for s in filtered} == {data["mechanic"]}

    assert client.get("/api/shifts", headers=auth("boss@other.test")).get_json()["shifts"] == []
    assert client.get("/api/shifts", headers=auth("cust@acme.test")).status_code == 403


def test_boss_corrects_a_forgotten_clock_out(client, data, auth):
    shift = Shift.query.filter_by(user_id=data["mechanic"], clocked_out_at=None).one()
    shift.clocked_in_at = utcnow() - timedelta(hours=14)
    db.session.commit()
    job_id = give_job(data, "mechanic")
    client.patch(f"/api/jobs/{job_id}", headers=mech(auth), json={"status": "In Progress", **HERE})

    listed = client.get("/api/shifts", headers=boss(auth)).get_json()["shifts"][0]
    assert listed["open"] and listed["long"]

    url = f"/api/shifts/{shift.id}"
    assert client.patch(url, headers=mech(auth), json={"clocked_out_at": utcnow().isoformat()}).status_code == 403
    assert client.patch(url, headers=auth("boss@other.test"), json={"clocked_out_at": utcnow().isoformat()}).status_code == 404
    too_early = (shift.clocked_in_at - timedelta(minutes=1)).isoformat()
    assert client.patch(url, headers=boss(auth), json={"clocked_out_at": too_early}).status_code == 400

    end = utcnow() - timedelta(hours=6)
    response = client.patch(url, headers=boss(auth), json={"clocked_out_at": end.isoformat() + "Z"})
    assert response.status_code == 200, response.get_json()
    corrected = response.get_json()["shift"]
    assert corrected["open"] is False and corrected["edited_by"] == "Boss One" and corrected["hours"] == 8.0
    assert db.session.get(Job, job_id).status == "Paused"

    # A second correction keeps the first recorded end time.
    later = end + timedelta(hours=1)
    corrected = client.patch(url, headers=boss(auth), json={"clocked_out_at": later.isoformat()}).get_json()["shift"]
    assert corrected["original_clocked_out_at"].startswith(end.isoformat()[:16])


def test_old_live_points_are_purged_but_stamps_stay(client, data, auth):
    shift = Shift.query.filter_by(user_id=data["mechanic"], clocked_out_at=None).one()
    old = utcnow() - timedelta(days=31)
    db.session.add_all(
        [
            LocationPoint(company_id=data["acme"], user_id=data["mechanic"], shift_id=shift.id, kind="live", latitude=1, longitude=1, recorded_at=old),
            LocationPoint(company_id=data["acme"], user_id=data["mechanic"], shift_id=shift.id, kind="clock_in", latitude=1, longitude=1, recorded_at=old),
        ]
    )
    db.session.commit()
    job_id = give_job(data, "mechanic")
    client.patch(f"/api/jobs/{job_id}", headers=mech(auth), json={"status": "In Progress"})
    client.post("/api/location/live", headers=mech(auth), json={**HERE, "job_id": job_id})
    kinds = sorted(p.kind for p in LocationPoint.query.filter(LocationPoint.recorded_at < utcnow() - timedelta(days=30)))
    assert kinds == ["clock_in"]
    assert LocationPoint.query.filter_by(kind="live").count() == 1


def test_mechanic_with_shifts_cannot_be_deleted(client, data, auth):
    clock_in_mech2(client, auth)
    client.post("/api/shifts/clock-out", headers=mech2(auth), json=HERE)
    response = client.delete(f"/api/users/{data['mechanic2']}", headers=boss(auth))
    assert response.status_code == 409 and "shift records" in response.get_json()["error"]
