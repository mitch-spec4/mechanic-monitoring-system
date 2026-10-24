"""Changes a technician's phone queued while offline, sent later: each saved once, dated when it
was made, and checked against what happened on the server meanwhile."""
import json
import uuid
from datetime import datetime, timedelta, timezone

from app import db
from app.models import ClientRequest, Job, JobEvent, JobFile, JobPart, LocationPoint, ServiceRecord, Shift, WorkEntry
from app.routes.maintenance import run_daily
from app.services.company_data import delete_company
from app.utils.time import utcnow
from conftest import SIGNED
from test_location import HERE
from test_media import jpeg
from test_worksheet import inspection  # noqa: F401 (fixture)

MECH = "mech@acme.test"
BOSS = "boss@acme.test"


def ago(minutes):
    return utcnow() - timedelta(minutes=minutes)


def stamp(moment):
    return moment.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def queued(auth, minutes_ago=0, key=None, who=MECH):
    """Headers the phone's queue sends: the change's own ID and when it was made."""
    return {**auth(who), "Idempotency-Key": key or uuid.uuid4().hex, "X-Client-Time": stamp(ago(minutes_ago))}


def close_to(value, expected, seconds=5):
    moment = datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None) if isinstance(value, str) else value
    return abs((moment - expected).total_seconds()) <= seconds


def on_shift_since(data, minutes):
    """Mech One clocked in `minutes` ago (the fixture clocks them in just now)."""
    Shift.query.filter_by(user_id=data["mechanic"]).update({"clocked_in_at": ago(minutes)})
    db.session.commit()


def detail(client, auth, job_id, who=MECH):
    response = client.get(f"/api/jobs/{job_id}", headers=auth(who))
    assert response.status_code == 200, response.get_json()
    return response.get_json()["job"]


def history(job_id, action):
    return JobEvent.query.filter_by(job_id=job_id, action=action).order_by(JobEvent.id).all()


def test_a_change_sent_twice_is_saved_once(client, data, auth):
    headers = queued(auth)
    first = client.post(f"/api/jobs/{data['job']}/parts", headers=headers, json={"name": "Fan belt", "quantity": 1})
    assert first.status_code == 201
    # The reply was lost, so the phone sends the same change again: same answer, nothing added.
    again = client.post(f"/api/jobs/{data['job']}/parts", headers=headers, json={"name": "Fan belt", "quantity": 1})
    assert again.status_code == 201 and again.headers["Idempotent-Replay"] == "true"
    assert again.get_json() == first.get_json()
    assert JobPart.query.filter_by(job_id=data["job"]).count() == 1
    assert len(history(data["job"], "part_added")) == 1

    # The same ID can't stand for a different change.
    other = client.post(f"/api/jobs/{data['job']}/notes", headers=headers, json={"note": "Hello"})
    assert other.status_code == 422
    bad = client.post(f"/api/jobs/{data['job']}/parts", headers={**auth(MECH), "Idempotency-Key": "short"}, json={"name": "Belt"})
    assert bad.status_code == 400


def test_a_refused_change_is_not_remembered(client, data, auth):
    headers = queued(auth)
    refused = client.post(f"/api/jobs/{data['job']}/parts", headers=headers, json={"name": "Fan belt", "quantity": 0})
    assert refused.status_code == 400
    assert ClientRequest.query.count() == 0
    fixed = client.post(f"/api/jobs/{data['job']}/parts", headers=headers, json={"name": "Fan belt", "quantity": 2})
    assert fixed.status_code == 201 and "Idempotent-Replay" not in fixed.headers


def test_ids_belong_to_one_person_and_need_a_session(client, data, auth):
    key = uuid.uuid4().hex
    assert client.post(f"/api/jobs/{data['job']}/notes", headers=queued(auth, key=key), json={"note": "Mine"}).status_code == 201
    # The same ID from someone else is their own change.
    response = client.post(f"/api/jobs/{data['job']}/notes", headers=queued(auth, key=key, who=BOSS), json={"note": "Boss note"})
    assert response.status_code == 201 and "Idempotent-Replay" not in response.headers
    # Signed out (the session ran out while offline): refused as usual, and not remembered.
    response = client.post(f"/api/jobs/{data['job']}/notes", headers={"Idempotency-Key": uuid.uuid4().hex}, json={"note": "Who?"})
    assert response.status_code == 401
    assert ClientRequest.query.count() == 2


def test_work_done_offline_keeps_the_times_it_happened(client, data, auth):
    on_shift_since(data, 180)
    job = data["job"]
    assert client.patch(f"/api/jobs/{job}", headers=queued(auth, 120), json={"status": "In Progress"}).status_code == 200
    assert client.post(f"/api/jobs/{job}/parts", headers=queued(auth, 100), json={"name": "Fan belt"}).status_code == 201
    assert client.patch(f"/api/jobs/{job}", headers=queued(auth, 60), json={"status": "Paused"}).status_code == 200

    [entry] = WorkEntry.query.filter_by(job_id=job).all()
    assert close_to(entry.started_at, ago(120)) and close_to(entry.ended_at, ago(60))
    sheet = detail(client, auth, job)
    assert sheet["total_hours"] == 1.0
    started = next(event for event in sheet["history"] if event["to_status"] == "In Progress")
    # The history says when it was done and when it reached the server.
    assert close_to(started["created_at"], ago(120)) and close_to(started["synced_at"], utcnow())
    part = JobPart.query.filter_by(job_id=job).one()
    assert close_to(part.created_at, ago(100))
    # Made just now: no "synced at".
    assert client.post(f"/api/jobs/{job}/notes", headers=queued(auth), json={"note": "Back online"}).status_code == 201
    assert detail(client, auth, job)["history"][-1]["synced_at"] is None


def test_times_in_the_future_or_too_old_are_refused(client, data, auth):
    url = f"/api/jobs/{data['job']}/notes"
    future = {**auth(MECH), "Idempotency-Key": uuid.uuid4().hex, "X-Client-Time": stamp(utcnow() + timedelta(minutes=10))}
    response = client.post(url, headers=future, json={"note": "From the future"})
    assert response.status_code == 422 and "future" in response.get_json()["error"]
    old = {**auth(MECH), "Idempotency-Key": uuid.uuid4().hex, "X-Client-Time": stamp(utcnow() - timedelta(days=31))}
    assert client.post(url, headers=old, json={"note": "Ancient"}).status_code == 422
    garbled = {**auth(MECH), "Idempotency-Key": uuid.uuid4().hex, "X-Client-Time": "yesterday"}
    assert client.post(url, headers=garbled, json={"note": "When?"}).status_code == 422
    # A phone a few minutes fast is allowed, and recorded as now.
    fast = {**auth(MECH), "Idempotency-Key": uuid.uuid4().hex, "X-Client-Time": stamp(utcnow() + timedelta(minutes=3))}
    assert client.post(url, headers=fast, json={"note": "Slightly fast"}).status_code == 201
    assert history(data["job"], "note")[-1].created_at <= utcnow()


def test_a_status_change_older_than_the_last_one_is_refused(client, data, auth):
    on_shift_since(data, 180)
    job = data["job"]
    assert client.patch(f"/api/jobs/{job}", headers=queued(auth, 30), json={"status": "In Progress"}).status_code == 200
    response = client.patch(f"/api/jobs/{job}", headers=queued(auth, 60), json={"status": "Paused"})
    assert response.status_code == 409
    assert "before the job's last update" in response.get_json()["error"]
    assert db.session.get(Job, job).status == "In Progress"


def test_a_reassigned_job_keeps_work_from_before_and_refuses_the_rest(client, data, auth):
    on_shift_since(data, 180)
    job = data["job"]
    # The manager hands the job to Mech Two while Mech One's phone is offline.
    assert client.patch(f"/api/jobs/{job}", headers=auth(BOSS), json={"mechanic_id": data["mechanic2"]}).status_code == 200
    handover = JobEvent.query.filter_by(job_id=job, previous_mechanic_id=data["mechanic"]).one()
    handover.created_at = ago(30)
    db.session.commit()

    kept = [
        client.post(f"/api/jobs/{job}/parts", headers=queued(auth, 50), json={"name": "Fan belt"}),
        client.post(f"/api/jobs/{job}/notes", headers=queued(auth, 45), json={"note": "Belt was cracked"}),
        client.post(f"/api/jobs/{job}/entries", headers=queued(auth, 40), json={"started_at": stamp(ago(100)), "ended_at": stamp(ago(55)), "work_done": "Took the cover off"}),
    ]
    assert [response.status_code for response in kept] == [201, 201, 201]

    later = client.post(f"/api/jobs/{job}/parts", headers=queued(auth, 20), json={"name": "Bolt"})
    assert later.status_code == 409 and later.get_json()["error"].startswith("Reassigned to Mech Two at")
    # Starting, pausing or completing is refused, even from before the handover.
    start = client.patch(f"/api/jobs/{job}", headers=queued(auth, 50), json={"status": "In Progress"})
    assert start.status_code == 409 and start.get_json()["error"].startswith("Reassigned to Mech Two at")
    assert [part.name for part in JobPart.query.filter_by(job_id=job)] == ["Fan belt"]
    # Someone who never had the job still can't see it.
    assert client.post(f"/api/jobs/{job}/parts", headers=queued(auth, 50, who="mech@other.test"), json={"name": "X"}).status_code == 404


def test_a_cancelled_job_keeps_work_from_before_and_refuses_the_rest(client, data, auth):
    on_shift_since(data, 180)
    job = data["job"]
    assert client.patch(f"/api/jobs/{job}", headers=auth(BOSS), json={"status": "Cancelled"}).status_code == 200
    cancelled = JobEvent.query.filter_by(job_id=job, to_status="Cancelled").one()
    cancelled.created_at = ago(30)
    db.session.commit()

    assert client.post(f"/api/jobs/{job}/parts", headers=queued(auth, 40), json={"name": "Fan belt"}).status_code == 201
    response = client.post(f"/api/jobs/{job}/parts", headers=queued(auth, 10), json={"name": "Bolt"})
    assert response.status_code == 409 and "cancelled at" in response.get_json()["error"]
    response = client.patch(f"/api/jobs/{job}", headers=queued(auth, 40), json={"status": "In Progress"})
    assert response.status_code == 409 and response.get_json()["error"].startswith("This job was cancelled at")


def test_the_newest_change_wins_and_the_other_goes_into_the_history(client, data, auth):
    job = data["job"]
    url = f"/api/jobs/{job}/record"
    # Saved online just now.
    assert client.put(url, headers=auth(MECH), json={"problem": "Fan noise", "solution": "New belt"}).status_code == 200
    # Written offline an hour ago, synced now: older, so not applied, but kept in the history.
    response = client.put(url, headers=queued(auth, 60), json={"problem": "Overheating"})
    assert response.status_code == 200
    record = ServiceRecord.query.filter_by(job_id=job).one()
    assert record.problem == "Fan noise"
    [skipped] = history(job, "change_not_applied")
    assert json.loads(skipped.note) == {"item": "summary", "label": None, "values": {"problem": "Overheating"}}
    assert close_to(skipped.created_at, ago(60)) and skipped.synced_at is not None

    # A newer offline change wins; the version it replaced goes into the history.
    record.updated_at = ago(90)
    db.session.commit()
    assert client.put(url, headers=queued(auth, 30), json={"problem": "Belt slipping"}).status_code == 200
    db.session.refresh(record)
    assert record.problem == "Belt slipping"
    [replaced] = history(job, "replaced")
    assert json.loads(replaced.note)["values"]["problem"] == "Fan noise"


def test_ticks_and_time_entries_follow_the_newest_change(client, data, auth, inspection):
    on_shift_since(data, 180)
    job = data["job"]
    assert client.patch(f"/api/jobs/{job}", headers=auth(MECH), json={"status": "In Progress"}).status_code == 200
    item = detail(client, auth, job)["checklist"][0]
    assert client.patch(f"/api/jobs/{job}/checklist/{item['id']}", headers=auth(MECH), json={"done": True}).status_code == 200
    # Unticked offline before it was ticked: not applied.
    assert client.patch(f"/api/jobs/{job}/checklist/{item['id']}", headers=queued(auth, 20), json={"done": False}).status_code == 200
    assert detail(client, auth, job)["checklist"][0]["done"] is True
    assert json.loads(history(job, "change_not_applied")[-1].note) == {"item": "checklist", "label": "Check oil", "values": {"done": False}}

    entry = detail(client, auth, job)["entries"][0]
    assert client.patch(f"/api/jobs/{job}/entries/{entry['id']}", headers=auth(MECH), json={"work_done": "Checked the oil"}).status_code == 200
    assert client.patch(f"/api/jobs/{job}/entries/{entry['id']}", headers=queued(auth, 15), json={"work_done": "Old words"}).status_code == 200
    assert db.session.get(WorkEntry, entry["id"]).work_done == "Checked the oil"
    assert json.loads(history(job, "change_not_applied")[-1].note)["item"] == "entry"


def test_removing_a_part_that_is_already_gone_does_nothing(client, data, auth):
    job = data["job"]
    added = client.post(f"/api/jobs/{job}/parts", headers=auth(MECH), json={"name": "Fan belt"}).get_json()["job"]["parts"][0]
    assert client.delete(f"/api/jobs/{job}/parts/{added['id']}", headers=queued(auth)).status_code == 200
    # Removed on another phone too: nothing left to remove, and no second history line.
    assert client.delete(f"/api/jobs/{job}/parts/{added['id']}", headers=queued(auth)).status_code == 200
    assert len(history(job, "part_removed")) == 1


def test_clocking_in_and_out_offline(client, data, auth):
    shift = Shift.query.filter_by(user_id=data["mechanic"]).one()
    shift.clocked_in_at = ago(300)
    db.session.commit()
    # Already clocked in on another phone: already done.
    assert client.post("/api/shifts/clock-in", headers=queued(auth, 5), json=HERE).status_code == 200
    assert client.post("/api/shifts/clock-in", headers=auth(MECH), json=HERE).status_code == 409
    # A clock-out made before the clock-in is out of order.
    response = client.post("/api/shifts/clock-out", headers=queued(auth, 400), json=HERE)
    assert response.status_code == 409 and "before you clocked in" in response.get_json()["error"]
    assert client.post("/api/shifts/clock-out", headers=queued(auth, 120), json=HERE).status_code == 200
    db.session.refresh(shift)
    assert close_to(shift.clocked_out_at, ago(120))
    stamp_point = LocationPoint.query.filter_by(shift_id=shift.id, kind="clock_out").one()
    assert close_to(stamp_point.recorded_at, ago(120))
    # Clocked out on another phone too: already done.
    assert client.post("/api/shifts/clock-out", headers=queued(auth, 110), json=HERE).status_code == 200
    # A clock-in can't be dated before the last clock-out.
    response = client.post("/api/shifts/clock-in", headers=queued(auth, 130), json=HERE)
    assert response.status_code == 409 and "before your last clock-out" in response.get_json()["error"]
    assert client.post("/api/shifts/clock-in", headers=queued(auth, 60), json=HERE).status_code == 201
    latest = Shift.query.filter_by(user_id=data["mechanic"]).order_by(Shift.id.desc()).first()
    assert close_to(latest.clocked_in_at, ago(60))


def request_upload(client, auth, job_id, headers, size):
    return client.post(f"/api/jobs/{job_id}/files", headers=headers, json={"kind": "before", "content_type": "image/jpeg", "size": size})


def test_a_photo_sent_again_is_one_photo(client, data, auth):
    on_shift_since(data, 180)
    job = data["job"]
    assert client.patch(f"/api/jobs/{job}", headers=queued(auth, 90), json={"status": "In Progress"}).status_code == 200
    payload = jpeg()
    headers = queued(auth, 80)
    first = request_upload(client, auth, job, headers, len(payload))
    assert first.status_code == 201
    # The upload failed and the phone asks again: same file, a fresh upload link.
    again = request_upload(client, auth, job, headers, len(payload))
    assert again.status_code == 200 and again.get_json()["file_id"] == first.get_json()["file_id"]
    target = again.get_json()["upload"]
    assert client.put(target["url"], data=payload, headers=target["headers"]).status_code == 204
    confirm = client.post(f"/api/files/{first.get_json()['file_id']}/confirm", headers=headers)
    assert confirm.status_code == 200
    # Asked again after it arrived: it's already there.
    done = request_upload(client, auth, job, headers, len(payload))
    assert done.status_code == 200 and done.get_json() == {"file_id": first.get_json()["file_id"], "ready": True}
    photo = JobFile.query.filter_by(job_id=job).one()
    assert close_to(photo.created_at, ago(80))
    assert close_to(history(job, "file_added")[0].created_at, ago(80))


def test_a_photo_taken_before_completion_still_uploads(client, data, auth):
    on_shift_since(data, 180)
    job = data["job"]
    assert client.patch(f"/api/jobs/{job}", headers=queued(auth, 90), json={"status": "In Progress"}).status_code == 200
    entry = detail(client, auth, job)["entries"][0]
    client.patch(f"/api/jobs/{job}/entries/{entry['id']}", headers=queued(auth, 70), json={"work_done": "Replaced the belt"})
    assert client.patch(f"/api/jobs/{job}", headers=queued(auth, 60), json={"status": "Completed", **SIGNED}).status_code == 200
    assert close_to(db.session.get(Job, job).signed_at, ago(60))
    # The photo waited for Wi-Fi; it was taken while the job was still in progress.
    assert request_upload(client, auth, job, queued(auth, 80), 1000).status_code == 201
    # One taken after completion is refused.
    assert request_upload(client, auth, job, queued(auth, 30), 1000).status_code == 409


def test_remembered_changes_are_cleared(client, data, auth):
    client.post(f"/api/jobs/{data['job']}/notes", headers=queued(auth), json={"note": "Kept a while"})
    old = ClientRequest(user_id=data["mechanic"], key="old-change-1", method="POST", path="/api/x", status_code=201, created_at=utcnow() - timedelta(days=31))
    db.session.add(old)
    db.session.commit()
    assert run_daily()["old_offline_changes"] == 1
    assert ClientRequest.query.count() == 1

    # Deleting the company removes them too.
    response = client.patch(f"/api/customers/{data['other_customer']}", headers=queued(auth, who="boss@other.test"), json={"name": "Renamed"})
    assert response.status_code == 200, response.get_json()
    assert ClientRequest.query.filter_by(user_id=data["other_boss"]).count() == 1
    delete_company(data["other"])
    db.session.commit()
    assert ClientRequest.query.filter_by(user_id=data["other_boss"]).count() == 0


def test_the_checklist_reaches_the_phone_before_work_starts(client, data, auth, inspection):
    def new_job(title):
        response = client.post("/api/jobs", headers=auth(BOSS), json={"title": title, "description": "Leaks", "job_type": "Inspection", "mechanic_id": data["mechanic"]})
        assert response.status_code == 201, response.get_json()
        return response.get_json()["job"]["id"]

    job = new_job("Check the pump")
    checklist = detail(client, auth, job)["checklist"]
    assert [item["label"] for item in checklist] == ["Check oil", "Photograph site"]
    # Ticked on the phone before work starts.
    assert client.patch(f"/api/jobs/{job}/checklist/{checklist[0]['id']}", headers=queued(auth), json={"done": True}).status_code == 200
    # Changing the job type keeps a checklist that has ticks...
    assert client.patch(f"/api/jobs/{job}", headers=auth(BOSS), json={"job_type": "Repair"}).status_code == 200
    assert [item["label"] for item in detail(client, auth, job)["checklist"]] == ["Check oil", "Photograph site"]
    # ...and replaces one that hasn't been touched (no checklist for this type).
    untouched = new_job("Check the fan")
    assert client.patch(f"/api/jobs/{untouched}", headers=auth(BOSS), json={"job_type": "Repair"}).status_code == 200
    assert detail(client, auth, untouched)["checklist"] == []
