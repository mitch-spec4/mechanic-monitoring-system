import pytest

from app import db
from app.models import Job, Notification


def boss(auth):
    return auth("boss@acme.test")


def mech(auth):
    return auth("mech@acme.test")


def set_status(client, headers, job_id, status):
    return client.patch(f"/api/jobs/{job_id}", headers=headers, json={"status": status})


def test_mechanic_can_take_assigned_job_to_completed(client, data, auth):
    job = data["job"]
    assert set_status(client, mech(auth), job, "In Progress").status_code == 200
    assert set_status(client, mech(auth), job, "Paused").status_code == 200
    assert set_status(client, mech(auth), job, "In Progress").status_code == 200
    blocked = set_status(client, mech(auth), job, "Completed")
    assert blocked.status_code == 409 and "work done" in blocked.get_json()["error"]
    entry = client.get(f"/api/jobs/{job}", headers=mech(auth)).get_json()["job"]["entries"][-1]
    client.patch(f"/api/jobs/{job}/entries/{entry['id']}", headers=mech(auth), json={"work_done": "Fixed it"})
    response = set_status(client, mech(auth), job, "Completed")
    assert response.status_code == 200
    assert response.get_json()["job"]["status"] == "Completed"


def test_mechanic_can_accept_then_start(client, data, auth):
    assert set_status(client, mech(auth), data["job"], "Accepted").status_code == 200
    assert set_status(client, mech(auth), data["job"], "In Progress").status_code == 200


@pytest.mark.parametrize("status", ["Completed", "Paused"])
def test_cannot_skip_states(client, data, auth, status):
    response = set_status(client, mech(auth), data["job"], status)
    assert response.status_code == 409


def test_mechanic_cannot_cancel_or_decline(client, data, auth):
    assert set_status(client, mech(auth), data["job"], "Cancelled").status_code == 403
    assert set_status(client, mech(auth), data["job"], "Pending").status_code == 403


def test_finished_jobs_are_final(client, data, auth):
    assert set_status(client, boss(auth), data["job"], "Cancelled").status_code == 200
    assert set_status(client, boss(auth), data["job"], "In Progress").status_code == 409


def test_mechanic_cannot_touch_other_mechanics_job_or_other_fields(client, data, auth):
    assert set_status(client, auth("mech2@acme.test"), data["job"], "In Progress").status_code == 403
    response = client.patch(f"/api/jobs/{data['job']}", headers=mech(auth), json={"title": "Renamed"})
    assert response.status_code == 403


def test_invalid_status_value(client, data, auth):
    assert set_status(client, boss(auth), data["job"], "Done-ish").status_code == 400


def test_mechanic_status_change_notifies_every_boss(client, data, auth):
    set_status(client, mech(auth), data["job"], "In Progress")
    notified = {n.user_id for n in Notification.query.filter_by(title="Job status updated").all()}
    assert notified == {data["boss"], data["boss2"]}


def test_create_job_from_form_strings(client, data, auth):
    response = client.post(
        "/api/jobs",
        headers=boss(auth),
        json={
            "title": "Inspect",
            "description": "Check it",
            "customer_id": str(data["acme_customer"]),
            "machine_id": str(data["machine"]),
            "mechanic_id": "",
            "priority": "Low",
            "due_date": "2026-09-15",
            "location": "",
        },
    )
    assert response.status_code == 201, response.get_json()
    job = response.get_json()["job"]
    assert job["status"] == "Pending"
    assert job["customer_id"] == data["acme_customer"]
    assert job["mechanic_id"] is None
    assert job["due_date"] == "2026-09-15"


@pytest.mark.parametrize(
    "payload, status",
    [
        ({"description": "x"}, 400),
        ({"title": "x", "description": "x", "priority": "Normal"}, 400),
        ({"title": "x", "description": "x", "due_date": "29 Aug 2026"}, 400),
        ({"title": "x", "description": "x", "customer_id": "abc"}, 400),
    ],
)
def test_create_job_validation(client, auth, payload, status):
    assert client.post("/api/jobs", headers=boss(auth), json=payload).status_code == status


def test_create_job_rejects_other_company_records(client, data, auth):
    for field, value in (
        ("mechanic_id", data["other_mechanic"]),
        ("customer_id", data["other_customer"]),
        ("machine_id", data["other_machine"]),
    ):
        response = client.post("/api/jobs", headers=boss(auth), json={"title": "x", "description": "y", field: value})
        assert response.status_code == 404


def test_assigning_mechanic_sets_assigned_and_notifies(client, data, auth):
    job = client.post("/api/jobs", headers=boss(auth), json={"title": "New", "description": "Work"}).get_json()["job"]
    response = client.patch(f"/api/jobs/{job['id']}", headers=boss(auth), json={"mechanic_id": data["mechanic2"]})
    assert response.get_json()["job"]["status"] == "Assigned"
    assert Notification.query.filter_by(user_id=data["mechanic2"], title="New task assigned").count() == 1
    unassigned = client.patch(f"/api/jobs/{job['id']}", headers=boss(auth), json={"mechanic_id": None})
    assert unassigned.get_json()["job"]["status"] == "Pending"


def test_cannot_reassign_job_in_progress(client, data, auth):
    set_status(client, mech(auth), data["job"], "In Progress")
    response = client.patch(f"/api/jobs/{data['job']}", headers=boss(auth), json={"mechanic_id": data["mechanic2"]})
    assert response.status_code == 409


def test_only_unstarted_jobs_can_be_deleted(client, data, auth):
    set_status(client, mech(auth), data["job"], "In Progress")
    assert client.delete(f"/api/jobs/{data['job']}", headers=boss(auth)).status_code == 409
    job = client.post("/api/jobs", headers=boss(auth), json={"title": "Temp", "description": "x"}).get_json()["job"]
    assert client.delete(f"/api/jobs/{job['id']}", headers=boss(auth)).status_code == 200


def test_job_lists_are_scoped(client, data, auth):
    other_job = Job(title="Other", description="x", company_id=data["other"])
    db.session.add(other_job)
    db.session.commit()
    assert [j["id"] for j in client.get("/api/jobs", headers=boss(auth)).get_json()["jobs"]] == [data["job"]]
    assert client.get("/api/jobs", headers=auth("mech2@acme.test")).get_json()["jobs"] == []
    assert len(client.get("/api/jobs", headers=auth("cust@acme.test")).get_json()["jobs"]) == 1
    assert client.patch(f"/api/jobs/{other_job.id}", headers=boss(auth), json={"title": "x"}).status_code == 404
    assert client.delete(f"/api/jobs/{other_job.id}", headers=boss(auth)).status_code == 404


def test_boss_cancel_notifies_assigned_mechanic(client, data, auth):
    set_status(client, mech(auth), data["job"], "In Progress")
    assert set_status(client, boss(auth), data["job"], "Cancelled").status_code == 200
    assert Notification.query.filter_by(user_id=data["mechanic"], title="Job cancelled").count() == 1


def test_boss_edits_job_details(client, data, auth):
    response = client.patch(
        f"/api/jobs/{data['job']}",
        headers=boss(auth),
        json={"title": "Fix generator fully", "priority": "Urgent", "due_date": "2026-12-01", "location": "Site B"},
    )
    job = response.get_json()["job"]
    assert (job["title"], job["priority"], job["due_date"], job["location"]) == ("Fix generator fully", "Urgent", "2026-12-01", "Site B")
    assert client.patch(f"/api/jobs/{data['job']}", headers=boss(auth), json={"title": ""}).status_code == 400
