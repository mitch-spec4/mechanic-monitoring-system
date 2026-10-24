"""Customers book visits for their requests: free times, technicians, the steps, the chat, reminders."""
from datetime import datetime, timedelta

import pytest

from app import db
from app.models import Job, JobEvent, Notification, ServiceRequest, Subscription, User
from app.models.request import CustomerMessage
from app.services import booking
from conftest import SIGNED

# Monday 2 November 2026, 09:00 in Nairobi (the company's time zone, UTC+3).
NOW = datetime(2026, 11, 2, 6, 0)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(booking, "utcnow", lambda: NOW)


@pytest.fixture
def outbox(app):
    box = app.extensions["email"].outbox
    box.clear()
    return box


def customer(auth):
    return auth("cust@acme.test")


def boss(auth):
    return auth("boss@acme.test")


def mech(auth):
    return auth("mech@acme.test")


def new_request(client, auth, data, subject="Generator overheats"):
    response = client.post(
        "/api/customers/requests", headers=customer(auth), json={"machine_id": data["machine"], "subject": subject, "description": "It trips after an hour."}
    )
    assert response.status_code == 201
    return response.get_json()["id"]


def slots(client, auth, rid, who=None):
    response = client.get(f"/api/customers/requests/{rid}/slots", headers=who or customer(auth))
    assert response.status_code == 200
    return response.get_json()


def book(client, auth, rid, start, who=None):
    return client.post(f"/api/customers/requests/{rid}/book", headers=who or customer(auth), json={"start": start})


def visit_job(rid, visit="inspection"):
    return Job.query.filter_by(request_id=rid, visit=visit).order_by(Job.id.desc()).first()


def complete(client, auth, job_id):
    """The technician starts, describes the work and completes with the customer's signature."""
    assert client.patch(f"/api/jobs/{job_id}", headers=mech(auth), json={"status": "In Progress"}).status_code == 200
    entry = client.get(f"/api/jobs/{job_id}", headers=mech(auth)).get_json()["job"]["entries"][-1]
    client.patch(f"/api/jobs/{job_id}/entries/{entry['id']}", headers=mech(auth), json={"work_done": "Cleaned the radiator"})
    client.put(f"/api/jobs/{job_id}/record", headers=mech(auth), json={"problem": "Blocked radiator", "advice": "Replace the fan belt"})
    response = client.patch(f"/api/jobs/{job_id}", headers=mech(auth), json={"status": "Completed", **SIGNED})
    assert response.status_code == 200, response.get_json()


def titles(email):
    user = User.query.filter_by(email=email).one()
    return [n.title for n in Notification.query.filter_by(user_id=user.id).order_by(Notification.id).all()]


def test_free_times_follow_the_hours_days_notice_and_window(client, data, auth):
    rid = new_request(client, auth, data)
    offered = slots(client, auth, rid)
    assert offered["visit"] == "inspection" and offered["minutes"] == 120 and offered["moving"] is None
    starts = [datetime.fromisoformat(slot["start"]) for slot in offered["slots"]]
    # 24 hours' notice: Tuesday 09:00 (06:00 UTC) first; two-hour visits from 08:00 to 15:00 local,
    # Monday to Friday, up to 14 days ahead (Monday 16 November, 09:00).
    assert starts[0] == datetime(2026, 11, 3, 6, 0)
    assert starts[-1] == datetime(2026, 11, 16, 6, 0)
    assert len(starts) == 7 + 3 * 8 + 5 * 8 + 2
    for start in starts:
        local = start + timedelta(hours=3)
        assert local.isoweekday() <= 5 and 8 <= local.hour <= 15
    assert all(slot["end"] == (datetime.fromisoformat(slot["start"]) + timedelta(hours=2)).isoformat() for slot in offered["slots"])

    # A company with no technicians has no free times.
    User.query.filter_by(company_id=data["acme"], role="mechanic").update({"role": "boss"})
    db.session.commit()
    assert slots(client, auth, rid)["slots"] == []


def test_booking_picks_a_free_technician_and_keeps_travel_time(client, data, auth, outbox):
    tuesday_nine = "2026-11-03T06:00:00Z"
    first = new_request(client, auth, data, "Generator overheats")
    response = book(client, auth, first, tuesday_nine)
    assert response.status_code == 200, response.get_json()
    detail = response.get_json()["request"]
    assert detail["status"] == "Inspection booked" and detail["can_book"] is None and detail["can_move"] is True
    [visit] = detail["visits"]
    assert visit["visit"] == "inspection" and visit["status"] == "Assigned" and visit["scheduled_start"] == "2026-11-03T06:00:00"
    assert visit["technician"]["name"] == "Mech One"
    job = visit_job(first)
    assert job.job_type == "Inspection" and job.machine_id == data["machine"] and job.customer_id == data["acme_customer"]
    assert job.due_date.isoformat() == "2026-11-03" and job.scheduled_end == datetime(2026, 11, 3, 8, 0)
    assert "Visit booked" in titles("cust@acme.test") and "Visit booked" in titles("boss@acme.test")
    assert "New job assigned" in titles("mech@acme.test")
    [email] = [message for message in outbox if message["To"] == "cust@acme.test"]
    assert email["Subject"] == "Visit booked" and "03 Nov 2026 09:00" in email.get_body(("plain",)).get_content()

    # The same time again goes to the other technician; a third visit has nobody left.
    second = new_request(client, auth, data, "Second generator")
    assert tuesday_nine in [slot["start"] + "Z" for slot in slots(client, auth, second)["slots"]]
    assert book(client, auth, second, tuesday_nine).status_code == 200
    assert visit_job(second).mechanic_id == data["mechanic2"]
    third = new_request(client, auth, data, "Third generator")
    free = {slot["start"] for slot in slots(client, auth, third)["slots"]}
    # Both are busy 09:00 to 11:00, and need 30 minutes to travel: 11:00 is taken, 12:00 is free.
    assert "2026-11-03T06:00:00" not in free and "2026-11-03T07:00:00" not in free and "2026-11-03T08:00:00" not in free
    assert "2026-11-03T09:00:00" in free
    taken = book(client, auth, third, tuesday_nine)
    assert taken.status_code == 409 and "isn't free" in taken.get_json()["error"]
    # A time that isn't on the grid isn't offered either.
    assert book(client, auth, third, "2026-11-03T09:30:00Z").status_code == 409
    assert book(client, auth, third, "not a time").status_code == 400


def test_moving_and_cancelling_a_visit(client, data, auth):
    rid = new_request(client, auth, data)
    assert book(client, auth, rid, "2026-11-03T06:00:00Z").status_code == 200
    job = visit_job(rid)
    offered = slots(client, auth, rid)
    assert offered["moving"] == job.id and "2026-11-03T06:00:00" in {slot["start"] for slot in offered["slots"]}

    moved = book(client, auth, rid, "2026-11-04T10:00:00Z")
    assert moved.status_code == 200
    job = db.session.get(Job, job.id)
    assert Job.query.filter_by(request_id=rid).count() == 1
    assert job.scheduled_start == datetime(2026, 11, 4, 10, 0) and job.due_date.isoformat() == "2026-11-04"
    assert moved.get_json()["request"]["status"] == "Inspection booked"
    assert JobEvent.query.filter_by(job_id=job.id, action="rescheduled").one().note == "2026-11-04T10:00:00"
    assert "Visit moved" in titles("boss@acme.test") and "Visit moved" in titles("mech@acme.test")

    cancelled = client.post(f"/api/customers/requests/{rid}/cancel", headers=customer(auth))
    assert cancelled.status_code == 200
    assert cancelled.get_json()["request"]["status"] == "Cancelled"
    assert db.session.get(Job, job.id).status == "Cancelled"
    assert "Request cancelled" in titles("boss@acme.test")
    assert book(client, auth, rid, "2026-11-05T06:00:00Z").status_code == 409
    assert client.post(f"/api/customers/requests/{rid}/cancel", headers=customer(auth)).status_code == 409


def test_inspection_findings_then_the_repair(client, data, auth, outbox):
    rid = new_request(client, auth, data)
    assert book(client, auth, rid, "2026-11-03T06:00:00Z").status_code == 200
    inspection = visit_job(rid)
    complete(client, auth, inspection.id)
    assert "Work started" in titles("cust@acme.test")

    detail = client.get(f"/api/customers/requests/{rid}", headers=customer(auth)).get_json()["request"]
    assert detail["status"] == "Inspected" and detail["can_book"] == "repair"
    assert detail["visits"][0]["findings"]["problem"] == "Blocked radiator"
    assert detail["visits"][0]["findings"]["advice"] == "Replace the fan belt"
    findings = [message for message in outbox if message["Subject"] == "Inspection findings ready"]
    assert len(findings) == 1 and findings[0]["To"] == "cust@acme.test"

    # The manager says how long the repair takes; the times offered fit it.
    assert client.patch(f"/api/customers/requests/{rid}", headers=boss(auth), json={"repair_minutes": 600}).status_code == 400
    assert client.patch(f"/api/customers/requests/{rid}", headers=boss(auth), json={"repair_minutes": 180}).status_code == 200
    offered = slots(client, auth, rid)
    assert offered["visit"] == "repair" and offered["minutes"] == 180
    assert max((datetime.fromisoformat(slot["start"]) + timedelta(hours=3)).hour for slot in offered["slots"]) == 14

    assert book(client, auth, rid, "2026-11-05T06:00:00Z").status_code == 200
    repair = visit_job(rid, "repair")
    assert repair.job_type == "Repair" and repair.scheduled_end == datetime(2026, 11, 5, 9, 0)
    assert db.session.get(ServiceRequest, rid).status == "Repair booked"
    complete(client, auth, repair.id)
    detail = client.get(f"/api/customers/requests/{rid}", headers=customer(auth)).get_json()["request"]
    assert detail["status"] == "Completed" and [visit["visit"] for visit in detail["visits"]] == ["inspection", "repair"]
    assert detail["can_book"] is None and detail["can_cancel"] is False
    assert "Repair completed" in titles("cust@acme.test")


def test_on_my_way(client, data, auth, outbox):
    rid = new_request(client, auth, data)
    book(client, auth, rid, "2026-11-03T06:00:00Z")
    job = visit_job(rid)
    assert client.post(f"/api/jobs/{job.id}/on-the-way", headers=auth("mech2@acme.test")).status_code == 403
    assert client.post(f"/api/jobs/{job.id}/on-the-way", headers=boss(auth)).status_code == 403
    response = client.post(f"/api/jobs/{job.id}/on-the-way", headers=mech(auth))
    assert response.status_code == 200 and response.get_json()["job"]["on_the_way_at"]
    assert "Technician on the way" in titles("cust@acme.test")
    assert any(message["Subject"] == "Technician on the way" for message in outbox)
    # Tapped twice: told once.
    client.post(f"/api/jobs/{job.id}/on-the-way", headers=mech(auth))
    assert titles("cust@acme.test").count("Technician on the way") == 1
    detail = client.get(f"/api/customers/requests/{rid}", headers=customer(auth)).get_json()["request"]
    assert detail["visits"][0]["on_the_way_at"]
    # Once work has started, it's too late.
    client.patch(f"/api/jobs/{data['job']}", headers=mech(auth), json={"status": "In Progress"})
    assert client.post(f"/api/jobs/{data['job']}/on-the-way", headers=mech(auth)).status_code == 409


def test_a_cancelled_visit_sends_the_request_back(client, data, auth):
    rid = new_request(client, auth, data)
    book(client, auth, rid, "2026-11-03T06:00:00Z")
    job = visit_job(rid)
    assert client.patch(f"/api/jobs/{job.id}", headers=boss(auth), json={"status": "Cancelled"}).status_code == 200
    assert db.session.get(ServiceRequest, rid).status == "Submitted"
    assert "Visit cancelled" in titles("cust@acme.test")
    # The customer books again.
    assert slots(client, auth, rid)["visit"] == "inspection"
    assert book(client, auth, rid, "2026-11-03T06:00:00Z").status_code == 200


def test_manager_steps_decline_and_cancel(client, data, auth):
    rid = new_request(client, auth, data)
    assert client.patch(f"/api/customers/requests/{rid}", headers=boss(auth), json={"status": "Inspection booked"}).status_code == 400
    assert client.patch(f"/api/customers/requests/{rid}", headers=auth("boss@other.test"), json={"status": "Declined"}).status_code == 404
    assert client.patch(f"/api/customers/requests/{rid}", headers=customer(auth), json={"status": "Declined"}).status_code == 403
    # Set by hand: an inspection done outside the app.
    assert client.patch(f"/api/customers/requests/{rid}", headers=boss(auth), json={"status": "Inspected"}).status_code == 200
    assert slots(client, auth, rid)["visit"] == "repair"
    book(client, auth, rid, "2026-11-03T06:00:00Z")
    assert client.patch(f"/api/customers/requests/{rid}", headers=boss(auth), json={"status": "Completed"}).status_code == 409

    response = client.patch(f"/api/customers/requests/{rid}", headers=boss(auth), json={"status": "Declined"})
    assert response.status_code == 200 and response.get_json()["status"] == "Declined"
    assert visit_job(rid, "repair").status == "Cancelled"
    assert "Request declined" in titles("cust@acme.test") and "Job cancelled" in titles("mech@acme.test")

    # A visit under way can't be dropped by closing the request.
    other = new_request(client, auth, data, "Another one")
    book(client, auth, other, "2026-11-04T06:00:00Z")
    client.patch(f"/api/jobs/{visit_job(other).id}", headers=mech(auth), json={"status": "In Progress"})
    assert client.patch(f"/api/customers/requests/{other}", headers=boss(auth), json={"status": "Cancelled"}).status_code == 409
    assert client.post(f"/api/customers/requests/{other}/cancel", headers=customer(auth)).status_code == 409


def test_who_sees_and_books_requests(client, data, auth):
    rid = new_request(client, auth, data)
    assert client.get(f"/api/customers/requests/{rid}", headers=boss(auth)).status_code == 200
    for who in ("boss@other.test", "mech@acme.test"):
        assert client.get(f"/api/customers/requests/{rid}", headers=auth(who)).status_code in (403, 404)
        assert client.get(f"/api/customers/requests/{rid}/slots", headers=auth(who)).status_code in (403, 404)
        assert client.post(f"/api/customers/requests/{rid}/book", headers=auth(who), json={"start": "2026-11-03T06:00:00Z"}).status_code in (403, 404)
    # A manager can book for the customer (on the phone with them, say).
    assert book(client, auth, rid, "2026-11-03T06:00:00Z", who=boss(auth)).status_code == 200


def test_booking_waits_for_a_plan(client, data, auth):
    db.session.add(Subscription(company_id=data["acme"], plan="starter", interval="month", status="trialing", trial_ends_at=datetime(2020, 1, 1)))
    db.session.commit()
    rid = new_request(client, auth, data)
    response = book(client, auth, rid, "2026-11-03T06:00:00Z")
    assert response.status_code == 409 and "Acme Service a message" in response.get_json()["error"]


def test_booking_settings(client, data, auth):
    settings = client.get("/api/company/settings", headers=boss(auth)).get_json()["settings"]["booking"]
    assert settings == {
        "days": [1, 2, 3, 4, 5],
        "start": "08:00",
        "end": "17:00",
        "inspection_minutes": 120,
        "repair_minutes": 240,
        "travel_minutes": 30,
        "notice_hours": 24,
        "window_days": 14,
    }
    for bad in (
        {"days": []},
        {"days": [0]},
        {"days": ["1"]},
        {"start": "8am"},
        {"start": "18:00"},
        {"inspection_minutes": 600},
        {"travel_minutes": -5},
        {"window_days": 0},
    ):
        assert client.patch("/api/company/settings", headers=boss(auth), json={"booking": bad}).status_code == 400, bad
    assert client.patch("/api/company/settings", headers=mech(auth), json={"booking": {"days": [6]}}).status_code == 403

    # Saturdays only, 09:00 to 12:00, one-hour inspections.
    response = client.patch(
        "/api/company/settings", headers=boss(auth), json={"booking": {"days": [6], "start": "09:00", "end": "12:00", "inspection_minutes": 60, "repair_minutes": 120}}
    )
    assert response.status_code == 200 and response.get_json()["settings"]["booking"]["days"] == [6]
    rid = new_request(client, auth, data)
    starts = [datetime.fromisoformat(slot["start"]) + timedelta(hours=3) for slot in slots(client, auth, rid)["slots"]]
    assert {start.isoweekday() for start in starts} == {6} and {start.hour for start in starts} == {9, 10, 11}


def test_the_chat_between_a_customer_and_the_managers(client, data, auth, outbox):
    assert client.get("/api/messages", headers=mech(auth)).status_code == 403
    assert client.get("/api/messages/mine", headers=mech(auth)).status_code == 403
    assert client.post("/api/messages/mine", headers=customer(auth), json={"body": "  "}).status_code == 400
    sent = client.post("/api/messages/mine", headers=customer(auth), json={"body": "How much would a new radiator cost?"})
    assert sent.status_code == 201 and sent.get_json()["message"]["mine"] is True
    assert "New message" in titles("boss@acme.test") and "New message" in titles("boss2@acme.test")
    boss_note = Notification.query.filter_by(user_id=data["boss"], title="New message").one()
    assert boss_note.message == "Acme Customer: How much would a new radiator cost?"

    listing = client.get("/api/messages", headers=boss(auth)).get_json()
    assert listing["unread"] == 1
    [conversation] = listing["conversations"]
    assert conversation["customer"] == "Acme Customer" and conversation["unread"] == 1 and conversation["last"]["from_customer"] is True

    thread = client.get(f"/api/messages/{data['acme_customer']}", headers=boss(auth)).get_json()
    assert [message["body"] for message in thread["messages"]] == ["How much would a new radiator cost?"]
    assert client.get("/api/messages", headers=boss(auth)).get_json()["unread"] == 0

    # Two replies: the customer is emailed once, until they read them.
    for body in ("About KSh 18,000 fitted.", "We can do it on Thursday."):
        assert client.post(f"/api/messages/{data['acme_customer']}", headers=boss(auth), json={"body": body}).status_code == 201
    emailed = [message for message in outbox if message["To"] == "cust@acme.test"]
    assert len(emailed) == 1 and emailed[0]["Subject"] == "New message from Acme Service"
    assert "About KSh 18,000 fitted." in emailed[0].get_body(("plain",)).get_content()
    assert client.get("/api/messages", headers=customer(auth)).get_json()["unread"] == 2
    mine = client.get("/api/messages/mine", headers=customer(auth)).get_json()
    assert [message["sender"] for message in mine["messages"]] == ["Acme Customer", "Boss One", "Boss One"]
    assert mine["company"] == "Acme Service"
    assert client.get("/api/messages", headers=customer(auth)).get_json()["unread"] == 0

    # Other companies can't see or write into it.
    assert client.get(f"/api/messages/{data['acme_customer']}", headers=auth("boss@other.test")).status_code == 404
    assert client.post(f"/api/messages/{data['acme_customer']}", headers=auth("boss@other.test"), json={"body": "hi"}).status_code == 404
    assert client.get("/api/messages", headers=auth("boss@other.test")).get_json()["conversations"] == []
    assert CustomerMessage.query.count() == 3


def test_reminders_are_sent_once(client, data, auth, outbox):
    rid = new_request(client, auth, data)
    # Booked a week ahead: the confirmation now, the reminder the day before.
    book(client, auth, rid, "2026-11-09T06:00:00Z")
    job = visit_job(rid)
    assert job.reminder_sent_at is None
    assert booking.send_reminders(now=datetime(2026, 11, 7, 6, 0))["visit_reminders"] == 0
    sunday = datetime(2026, 11, 8, 6, 0)
    assert booking.send_reminders(now=sunday)["visit_reminders"] == 1
    db.session.commit()
    assert booking.send_reminders(now=sunday)["visit_reminders"] == 0
    assert "Visit reminder" in titles("cust@acme.test")
    assert any(message["Subject"] == "Visit reminder" and "09 Nov 2026 09:00" in message.get_body(("plain",)).get_content() for message in outbox)

    # Booked for tomorrow: the confirmation is the reminder.
    soon = new_request(client, auth, data, "Soon")
    book(client, auth, soon, "2026-11-03T07:00:00Z")
    assert visit_job(soon).reminder_sent_at is not None

    # Inspected 3 days ago with no repair booked: a nudge. Completed a day ago: the follow-up.
    service_request = db.session.get(ServiceRequest, rid)
    service_request.status, service_request.inspected_at = "Inspected", NOW - timedelta(days=3)
    done = db.session.get(ServiceRequest, soon)
    done.status, done.completed_at = "Completed", NOW - timedelta(days=1, hours=1)
    db.session.commit()
    sent = booking.send_reminders(now=NOW)
    assert sent["repair_reminders"] == 1 and sent["follow_ups"] == 1
    db.session.commit()
    assert booking.send_reminders(now=NOW) == {"visit_reminders": 0, "repair_reminders": 0, "follow_ups": 0}
    assert "Pick a time for the repair" in titles("cust@acme.test") and "How did it go?" in titles("cust@acme.test")


def test_emails_and_notifications_follow_the_customers_language(client, data, auth, outbox):
    User.query.filter_by(email="cust@acme.test").update({"language": "sw"})
    db.session.commit()
    rid = new_request(client, auth, data)
    book(client, auth, rid, "2026-11-03T06:00:00Z")
    [email] = [message for message in outbox if message["To"] == "cust@acme.test"]
    assert email["Subject"] == "Ziara imepangwa"
    assert "Ziara yako ya ukaguzi kwa Generator overheats imepangwa 03 Nov 2026 09:00" in email.get_body(("plain",)).get_content()
    assert "Ziara imepangwa" in titles("cust@acme.test")
