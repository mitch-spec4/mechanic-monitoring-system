from datetime import timedelta

import pytest

from app import db
from app.models import ChecklistTemplate, ChecklistTemplateItem, Job, ServiceRecord, WorkEntry
from app.utils.time import utcnow


def boss(auth):
    return auth("boss@acme.test")


def mech(auth):
    return auth("mech@acme.test")


def detail(client, headers, job_id):
    response = client.get(f"/api/jobs/{job_id}", headers=headers)
    assert response.status_code == 200, response.get_json()
    return response.get_json()["job"]


def set_status(client, headers, job_id, status):
    return client.patch(f"/api/jobs/{job_id}", headers=headers, json={"status": status})


@pytest.fixture
def inspection(data):
    """An 'Inspection' checklist with one required and one optional item; the job uses it."""
    template = ChecklistTemplate(company_id=data["acme"], job_type="Inspection")
    db.session.add(template)
    db.session.flush()
    db.session.add_all(
        [
            ChecklistTemplateItem(template_id=template.id, label="Check oil", required=True, position=0),
            ChecklistTemplateItem(template_id=template.id, label="Photograph site", required=False, position=1),
        ]
    )
    db.session.get(Job, data["job"]).job_type = "Inspection"
    db.session.commit()
    return template


def write_work(client, auth, job_id, text="Replaced the fan belt"):
    entry = detail(client, mech(auth), job_id)["entries"][-1]
    response = client.patch(f"/api/jobs/{job_id}/entries/{entry['id']}", headers=mech(auth), json={"work_done": text})
    assert response.status_code == 200, response.get_json()


def tick(client, auth, job_id, label):
    item = next(i for i in detail(client, mech(auth), job_id)["checklist"] if i["label"] == label)
    return client.patch(f"/api/jobs/{job_id}/checklist/{item['id']}", headers=mech(auth), json={"done": True})


def test_start_pause_resume_runs_the_timer(client, data, auth):
    job = data["job"]
    set_status(client, mech(auth), job, "In Progress")
    sheet = detail(client, mech(auth), job)
    assert sheet["timer_running"] is True
    assert len(sheet["entries"]) == 1 and sheet["entries"][0]["running"]

    set_status(client, mech(auth), job, "Paused")
    sheet = detail(client, mech(auth), job)
    assert sheet["timer_running"] is False and sheet["entries"][0]["ended_at"]

    set_status(client, mech(auth), job, "In Progress")
    sheet = detail(client, mech(auth), job)
    assert len(sheet["entries"]) == 2 and sheet["entries"][1]["running"]
    assert sheet["total_hours"] >= 0


def test_checklist_is_copied_once_when_work_starts(client, data, auth, inspection):
    job = data["job"]
    assert detail(client, mech(auth), job)["checklist"] == []
    set_status(client, mech(auth), job, "In Progress")
    labels = [i["label"] for i in detail(client, mech(auth), job)["checklist"]]
    assert labels == ["Check oil", "Photograph site"]

    # Template edits after the job started don't touch the job's copy, and resuming doesn't duplicate it.
    client.patch(f"/api/checklists/{inspection.id}", headers=boss(auth), json={"items": [{"label": "Totally new"}]})
    set_status(client, mech(auth), job, "Paused")
    set_status(client, mech(auth), job, "In Progress")
    assert [i["label"] for i in detail(client, mech(auth), job)["checklist"]] == labels


def test_completion_rules(client, data, auth, inspection):
    job = data["job"]
    set_status(client, mech(auth), job, "In Progress")
    blockers = detail(client, mech(auth), job)["completion_blockers"]
    assert blockers == ["Describe the work done on the worksheet", "Tick 1 required checklist item"]

    response = set_status(client, mech(auth), job, "Completed")
    assert response.status_code == 409
    assert "Tick 1 required checklist item" in response.get_json()["error"]

    write_work(client, auth, job)
    assert tick(client, auth, job, "Check oil").status_code == 200
    assert detail(client, mech(auth), job)["completion_blockers"] == []
    assert set_status(client, mech(auth), job, "Completed").status_code == 200

    sheet = detail(client, boss(auth), job)
    assert sheet["timer_running"] is False
    assert sheet["completion_blockers"] == []


def test_boss_cannot_complete_without_a_worksheet_either(client, data, auth):
    job = data["job"]
    set_status(client, mech(auth), job, "In Progress")
    assert set_status(client, boss(auth), job, "Completed").status_code == 409


def test_completion_fills_the_service_record(client, data, auth):
    job = data["job"]
    set_status(client, mech(auth), job, "In Progress")
    write_work(client, auth, job, "Cleaned the radiator")
    client.post(f"/api/jobs/{job}/parts", headers=mech(auth), json={"name": "Coolant (L)", "quantity": "2.5"})
    client.put(f"/api/jobs/{job}/record", headers=mech(auth), json={"advice": "Check weekly"})
    set_status(client, mech(auth), job, "Completed")

    record = ServiceRecord.query.filter_by(job_id=job).one()
    assert record.work_done == "Cleaned the radiator"
    assert record.parts_replaced == "Coolant (L) ×2.5"
    assert record.advice == "Check weekly"
    assert record.problem == "Overheats"
    # The customer can now review it.
    review = client.post("/api/reviews", headers=auth("cust@acme.test"), json={"service_record_id": record.id, "rating": 5})
    assert review.status_code == 201


def test_finished_jobs_lock_the_worksheet(client, data, auth):
    job = data["job"]
    set_status(client, mech(auth), job, "In Progress")
    write_work(client, auth, job)
    part = client.post(f"/api/jobs/{job}/parts", headers=mech(auth), json={"name": "Belt", "quantity": 1}).get_json()["job"]["parts"][0]
    set_status(client, mech(auth), job, "Completed")
    entry = detail(client, mech(auth), job)["entries"][0]

    attempts = [
        client.patch(f"/api/jobs/{job}/entries/{entry['id']}", headers=mech(auth), json={"work_done": "changed"}),
        client.post(f"/api/jobs/{job}/parts", headers=mech(auth), json={"name": "Extra", "quantity": 1}),
        client.delete(f"/api/jobs/{job}/parts/{part['id']}", headers=mech(auth)),
        client.put(f"/api/jobs/{job}/record", headers=mech(auth), json={"advice": "late"}),
    ]
    assert [r.status_code for r in attempts] == [409, 409, 409, 409]


def test_history_records_who_did_what(client, data, auth):
    created = client.post(
        "/api/jobs", headers=boss(auth), json={"title": "New", "description": "x", "mechanic_id": data["mechanic"]}
    ).get_json()["job"]
    set_status(client, mech(auth), created["id"], "Accepted")
    client.patch(f"/api/jobs/{created['id']}", headers=boss(auth), json={"priority": "Urgent", "location": "Yard 2"})
    client.post(f"/api/jobs/{created['id']}/notes", headers=boss(auth), json={"note": "Customer gate code 1234"})

    history = detail(client, boss(auth), created["id"])["history"]
    assert [(h["action"], h["user"]) for h in history] == [
        ("created", "Boss One"),
        ("assigned", "Boss One"),
        ("status", "Mech One"),
        ("updated", "Boss One"),
        ("note", "Boss One"),
    ]
    assert (history[2]["from_status"], history[2]["to_status"]) == ("Assigned", "Accepted")
    assert history[3]["note"] == "Changed priority, location"


def test_manual_time_entries(client, data, auth):
    job = data["job"]
    set_status(client, mech(auth), job, "In Progress")
    now = utcnow()
    url = f"/api/jobs/{job}/entries"
    good = {
        "started_at": (now - timedelta(hours=3)).isoformat(),
        "ended_at": (now - timedelta(hours=1)).isoformat(),
        "work_done": "Yesterday's visit",
    }
    response = client.post(url, headers=mech(auth), json=good)
    assert response.status_code == 201
    entries = response.get_json()["job"]["entries"]
    manual = next(e for e in entries if e["work_done"] == "Yesterday's visit")
    assert manual["hours"] == 2.0

    bad = [
        {**good, "ended_at": good["started_at"]},
        {**good, "ended_at": (now + timedelta(hours=2)).isoformat()},
        {**good, "started_at": (now - timedelta(hours=30)).isoformat()},
        {**good, "started_at": "yesterday"},
        {"ended_at": good["ended_at"]},
    ]
    for payload in bad:
        assert client.post(url, headers=mech(auth), json=payload).status_code == 400, payload

    fix = client.patch(
        f"{url}/{manual['id']}", headers=mech(auth), json={"started_at": (now - timedelta(hours=4)).isoformat()}
    )
    assert next(e for e in fix.get_json()["job"]["entries"] if e["id"] == manual["id"])["hours"] == 3.0
    running = next(e for e in entries if e["running"])
    stop = client.patch(f"{url}/{running['id']}", headers=mech(auth), json={"ended_at": now.isoformat()})
    assert stop.status_code == 400


def test_parts(client, data, auth):
    job = data["job"]
    url = f"/api/jobs/{job}/parts"
    for quantity in (0, -1, "abc", "NaN"):
        assert client.post(url, headers=mech(auth), json={"name": "Bolt", "quantity": quantity}).status_code == 400
    assert client.post(url, headers=mech(auth), json={"quantity": 1}).status_code == 400
    parts = client.post(url, headers=mech(auth), json={"name": "Bolt", "quantity": 4}).get_json()["job"]["parts"]
    assert parts == [{**parts[0], "name": "Bolt", "quantity": 4.0, "label": "4", "added_by": "Mech One"}]
    assert client.delete(f"{url}/{parts[0]['id']}", headers=mech(auth)).get_json()["job"]["parts"] == []


def test_who_can_see_and_change_a_worksheet(client, data, auth):
    job = data["job"]
    customer_view = detail(client, auth("cust@acme.test"), job)
    assert "history" not in customer_view and "entries" not in customer_view and "total_hours" not in customer_view
    assert "history" in detail(client, boss(auth), job)

    assert client.get(f"/api/jobs/{job}", headers=auth("mech2@acme.test")).status_code == 404
    assert client.get(f"/api/jobs/{job}", headers=auth("boss@other.test")).status_code == 404
    assert client.post(f"/api/jobs/{job}/parts", headers=boss(auth), json={"name": "x", "quantity": 1}).status_code == 403
    assert client.post(f"/api/jobs/{job}/parts", headers=auth("mech2@acme.test"), json={"name": "x", "quantity": 1}).status_code == 404
    assert client.post(f"/api/jobs/{job}/notes", headers=auth("cust@acme.test"), json={"note": "hi"}).status_code == 403
    assert detail(client, mech(auth), job)["can_edit"] is True
    assert detail(client, boss(auth), job)["can_edit"] is False


def test_checklist_templates(client, data, auth):
    url = "/api/checklists"
    assert client.post(url, headers=boss(auth), json={"job_type": "Repair", "items": []}).status_code == 400
    assert client.post(url, headers=boss(auth), json={"job_type": "", "items": [{"label": "x"}]}).status_code == 400
    created = client.post(
        url, headers=boss(auth), json={"job_type": "Repair", "items": [{"label": "Isolate power", "required": True}, {"label": "Test run"}]}
    )
    assert created.status_code == 201
    template = created.get_json()["checklist"]
    assert [(i["label"], i["required"]) for i in template["items"]] == [("Isolate power", True), ("Test run", False)]
    assert client.post(url, headers=boss(auth), json={"job_type": "repair", "items": [{"label": "x"}]}).status_code == 409

    assert client.get(url, headers=mech(auth)).status_code == 403
    assert client.get(url, headers=auth("boss@other.test")).get_json()["checklists"] == []
    assert client.patch(f"{url}/{template['id']}", headers=auth("boss@other.test"), json={"job_type": "x"}).status_code == 404
    assert client.delete(f"{url}/{template['id']}", headers=boss(auth)).status_code == 200
    assert client.get(url, headers=boss(auth)).get_json()["checklists"] == []


def test_boss_sets_job_type_and_machine(client, data, auth):
    job = client.post("/api/jobs", headers=boss(auth), json={"title": "x", "description": "y", "job_type": "Inspection"}).get_json()["job"]
    assert job["job_type"] == "Inspection"
    response = client.patch(f"/api/jobs/{job['id']}", headers=boss(auth), json={"machine_id": data["machine"]})
    assert response.get_json()["job"]["machine_id"] == data["machine"]
    assert response.get_json()["job"]["customer_id"] == data["acme_customer"]
    assert client.patch(f"/api/jobs/{job['id']}", headers=boss(auth), json={"machine_id": data["other_machine"]}).status_code == 404


def test_cancelling_stops_the_timer_and_deleting_cleans_up(client, data, auth):
    job = data["job"]
    set_status(client, mech(auth), job, "In Progress")
    set_status(client, boss(auth), job, "Cancelled")
    assert WorkEntry.query.filter_by(job_id=job, ended_at=None).count() == 0

    fresh = client.post("/api/jobs", headers=boss(auth), json={"title": "Temp", "description": "x"}).get_json()["job"]
    assert client.delete(f"/api/jobs/{fresh['id']}", headers=boss(auth)).status_code == 200


def test_people_in_history_cannot_be_deleted(client, data, auth):
    client.post(f"/api/jobs/{data['job']}/notes", headers=auth("boss2@acme.test"), json={"note": "Checked in"})
    assert client.delete(f"/api/users/{data['boss2']}", headers=boss(auth)).status_code == 409


def test_time_entries_cannot_overlap(client, data, auth):
    job = data["job"]
    set_status(client, mech(auth), job, "In Progress")
    now = utcnow()
    url = f"/api/jobs/{job}/entries"
    first = {"started_at": (now - timedelta(hours=5)).isoformat(), "ended_at": (now - timedelta(hours=3)).isoformat(), "work_done": "a"}
    assert client.post(url, headers=mech(auth), json=first).status_code == 201
    overlapping = {"started_at": (now - timedelta(hours=4)).isoformat(), "ended_at": (now - timedelta(hours=2)).isoformat()}
    response = client.post(url, headers=mech(auth), json=overlapping)
    assert response.status_code == 409 and "overlaps" in response.get_json()["error"]
    # The running timer counts as running until now.
    into_running = {"started_at": (now - timedelta(minutes=30)).isoformat(), "ended_at": (now - timedelta(minutes=10)).isoformat()}
    running = WorkEntry.query.filter_by(job_id=job, ended_at=None).one()
    running.started_at = now - timedelta(hours=1)
    db.session.commit()
    assert client.post(url, headers=mech(auth), json=into_running).status_code == 409
    back_to_back = {"started_at": (now - timedelta(hours=3)).isoformat(), "ended_at": (now - timedelta(hours=2)).isoformat()}
    assert client.post(url, headers=mech(auth), json=back_to_back).status_code == 201

    entries = detail(client, mech(auth), job)["entries"]
    manual = next(e for e in entries if e["work_done"] == "a")
    moved = client.patch(f"{url}/{manual['id']}", headers=mech(auth), json={"ended_at": (now - timedelta(hours=2, minutes=30)).isoformat()})
    assert moved.status_code == 409


def test_renaming_a_checklist_keeps_jobs_connected(client, data, auth, inspection):
    client.patch(f"/api/checklists/{inspection.id}", headers=boss(auth), json={"job_type": "Site inspection"})
    assert db.session.get(Job, data["job"]).job_type == "Site inspection"
    set_status(client, mech(auth), data["job"], "In Progress")
    assert [i["label"] for i in detail(client, mech(auth), data["job"])["checklist"]] == ["Check oil", "Photograph site"]


def test_customer_view_hides_staff_details(client, data, auth, inspection):
    job = data["job"]
    set_status(client, mech(auth), job, "In Progress")
    tick(client, auth, job, "Check oil")
    client.post(f"/api/jobs/{job}/parts", headers=mech(auth), json={"name": "Belt", "quantity": 1})
    view = detail(client, auth("cust@acme.test"), job)
    assert view["checklist"][0] == {"id": view["checklist"][0]["id"], "label": "Check oil", "required": True, "done": True}
    assert view["parts"][0].keys() == {"id", "name", "quantity", "label"}
