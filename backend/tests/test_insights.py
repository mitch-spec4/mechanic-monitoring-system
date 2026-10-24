"""Insights: hours per technician, time to complete, repeat faults, the exports, and long lists a
page at a time."""
import io
from datetime import date, datetime

import pytest
from openpyxl import load_workbook

from app import db
from app.models import AuditEvent, Company, Job, JobEvent, Notification, Review, ServiceRecord, Shift, User, WorkEntry
from app.services.insights import insights

# Nairobi is UTC+3: the range 1-7 October runs from 30 Sep 21:00 to 7 Oct 21:00 UTC.
START, END = date(2026, 10, 1), date(2026, 10, 7)
NOW = datetime(2026, 10, 10, 12, 0)


def at(day, hour):
    return datetime(2026, 10, day, hour, 0) if day > 0 else datetime(2026, 9, 30 + day, hour, 0)


def add_job(data, title, created, mechanic_id=None, job_type="Repair", company="acme", customer="acme_customer", machine="machine"):
    job = Job(
        title=title, description="d", company_id=data[company], customer_id=data[customer], machine_id=data[machine],
        mechanic_id=mechanic_id, status="Assigned", job_type=job_type, created_at=created,
    )
    db.session.add(job)
    db.session.flush()
    return job


def finish(job, status, when):
    job.status = status
    db.session.add(JobEvent(job_id=job.id, action="status", from_status="In Progress", to_status=status, created_at=when))


@pytest.fixture
def october(data):
    """A week of work at Acme, a job just before it, and Other Co's work in the same week."""
    mech, mech2 = data["mechanic"], data["mechanic2"]
    first = add_job(data, "Overheating", at(1, 8), mech)
    finish(first, "Completed", at(2, 8))
    second = add_job(data, "Belt check", at(3, 6), mech2, job_type="Inspection")
    finish(second, "Completed", at(3, 18))
    third = add_job(data, "Called off", at(4, 6), mech)
    finish(third, "Cancelled", at(4, 9))
    earlier = add_job(data, "Last month", datetime(2026, 9, 18, 8), mech)
    finish(earlier, "Completed", datetime(2026, 9, 20, 8))
    theirs = add_job(data, "Their job", at(2, 8), data["other_mechanic"], company="other", customer="other_customer", machine="other_machine")
    finish(theirs, "Completed", at(2, 10))

    db.session.add_all(
        [
            Shift(company_id=data["acme"], user_id=mech, clocked_in_at=at(1, 5), clocked_out_at=at(1, 13)),
            # Across the range's first midnight: only 21:00 to 04:00 UTC is inside.
            Shift(company_id=data["acme"], user_id=mech2, clocked_in_at=at(0, 20), clocked_out_at=at(1, 4)),
            Shift(company_id=data["other"], user_id=data["other_mechanic"], clocked_in_at=at(2, 5), clocked_out_at=at(2, 15)),
            WorkEntry(job_id=first.id, mechanic_id=mech, started_at=at(1, 6), ended_at=at(1, 9)),
            Review(customer_id=data["acme_customer"], mechanic_id=mech, machine_id=data["machine"], company_id=data["acme"], service_record_id=data["record"], rating=4, created_at=at(5, 9)),
        ]
    )
    # The generator has needed fixing twice this week: a repeat fault.
    for day in (2, 5):
        db.session.add(ServiceRecord(machine_id=data["machine"], customer_id=data["acme_customer"], mechanic_id=mech, company_id=data["acme"], service_type="Repair", problem="Overheats", service_date=at(day, 9)))
    db.session.commit()
    return {"first": first.id, "second": second.id}


def test_hours_time_to_complete_and_repeat_faults(app, data, october):
    company = db.session.get(Company, data["acme"])
    result = insights(company, START, END, now=NOW)
    assert result["range"] == {"start": "2026-10-01", "end": "2026-10-07", "days": 7, "unit": "day"}
    assert result["jobs"] == {
        "created": 3,
        "completed": 2,
        "cancelled": 1,
        "median_hours_to_complete": 18.0,
        "average_hours_to_complete": 18.0,
        "average_hours_worked": 1.5,
    }
    # Completed on 2 Oct (11:00 Nairobi) and 3 Oct (21:00 Nairobi).
    assert [point["count"] for point in result["completed_over_time"]] == [0, 1, 1, 0, 0, 0, 0]
    assert result["by_type"] == [{"job_type": "Inspection", "count": 1}, {"job_type": "Repair", "count": 1}]
    team = {row["name"]: row for row in result["technicians"]}
    assert team["Mech One"] == {
        "id": data["mechanic"], "name": "Mech One", "clocked_hours": 8.0, "job_hours": 3.0, "share_on_jobs": 38,
        "jobs_completed": 1, "median_hours_to_complete": 24.0, "rating": 4.0, "reviews": 1,
    }
    assert (team["Mech Two"]["clocked_hours"], team["Mech Two"]["job_hours"], team["Mech Two"]["share_on_jobs"]) == (7.0, 0, 0)
    assert team["Mech Two"]["median_hours_to_complete"] == 12.0
    assert result["hours"] == {"clocked": 15.0, "on_jobs": 3.0}
    assert [(row["name"], row["faults"], row["customer"]) for row in result["repeat_faults"]] == [("Generator", 2, "Acme Customer")]
    # Only Acme's people: Other Co's technician isn't listed.
    assert set(team) == {"Mech One", "Mech Two"}


def test_long_ranges_are_shown_a_week_at_a_time(app, data, october):
    company = db.session.get(Company, data["acme"])
    result = insights(company, date(2026, 9, 1), date(2026, 10, 31), now=NOW)
    assert result["range"]["unit"] == "week"
    weeks = {point["start"]: point["count"] for point in result["completed_over_time"]}
    assert next(iter(weeks)) == "2026-08-31"  # the Monday of the week 1 September falls in
    assert weeks["2026-09-14"] == 1 and weeks["2026-09-28"] == 2
    # A range that hasn't happened yet has no repeat faults from the future.
    assert insights(company, date(2026, 9, 1), date(2026, 9, 3), now=NOW)["repeat_faults"] == []


def test_the_insights_page_and_its_exports(client, data, auth, october):
    boss = auth("boss@acme.test")
    response = client.get("/api/insights?start=2026-10-01&end=2026-10-07", headers=boss)
    assert response.status_code == 200, response.get_json()
    body = response.get_json()["insights"]
    assert body["jobs"]["completed"] == 2 and "_completed_jobs" not in body
    # The last 30 days by default.
    assert client.get("/api/insights", headers=boss).get_json()["insights"]["range"]["days"] == 30

    for query, status in (("start=2026-10-08&end=2026-10-01", 400), ("start=2025-01-01&end=2026-10-01", 400), ("start=nope", 400)):
        assert client.get(f"/api/insights?{query}", headers=boss).status_code == status
    for who in ("mech@acme.test", "cust@acme.test"):
        assert client.get("/api/insights", headers=auth(who)).status_code == 403
        assert client.get("/api/insights/export.xlsx", headers=auth(who)).status_code == 403

    excel = client.get("/api/insights/export.xlsx?start=2026-10-01&end=2026-10-07", headers=boss)
    assert excel.status_code == 200 and "attachment" in excel.headers["Content-Disposition"]
    assert "insights-2026-10-01-to-2026-10-07.xlsx" in excel.headers["Content-Disposition"]
    book = load_workbook(io.BytesIO(excel.data))
    assert book.sheetnames == ["Summary", "Technicians", "Completed jobs", "Completed over time", "Job types", "Repeat faults"]
    jobs = list(book["Completed jobs"].iter_rows(min_row=2, values_only=True))
    assert [(row[1], row[4], row[8]) for row in jobs] == [("Overheating", "Mech One", 24.0), ("Belt check", "Mech Two", 12.0)]
    assert list(book["Repeat faults"].iter_rows(min_row=2, values_only=True))[0][:4] == ("Generator", None, "Acme Customer", 2)

    pdf = client.get("/api/insights/export.pdf?start=2026-10-01&end=2026-10-07", headers=boss)
    assert pdf.status_code == 200 and pdf.mimetype == "application/pdf" and pdf.data.startswith(b"%PDF")
    assert client.get("/api/insights/export.csv", headers=boss).status_code == 404
    # Exports are in the activity log.
    assert [event.detail for event in AuditEvent.query.filter_by(action="report_exported").order_by(AuditEvent.id)] == ["XLSX 2026-10-01 - 2026-10-07", "PDF 2026-10-01 - 2026-10-07"]


def test_exports_are_written_in_the_readers_language(client, data, auth, october):
    User.query.filter_by(email="boss@acme.test").one().language = "sw"
    db.session.commit()
    excel = client.get("/api/insights/export.xlsx?start=2026-10-01&end=2026-10-07", headers=auth("boss@acme.test"))
    book = load_workbook(io.BytesIO(excel.data))
    assert book.sheetnames[0] == "Muhtasari"


def test_long_lists_a_page_at_a_time(client, data, auth):
    boss = auth("boss@acme.test")
    for number in range(30):
        db.session.add(Job(title=f"Visit {number}", description="d", company_id=data["acme"], customer_id=data["acme_customer"], machine_id=data["machine"], status="Pending"))
    db.session.commit()

    # Without ?page, the whole list as before.
    everything = client.get("/api/jobs", headers=boss).get_json()
    assert len(everything["jobs"]) == 31 and "total" not in everything
    first = client.get("/api/jobs?page=1", headers=boss).get_json()
    assert (len(first["jobs"]), first["total"], first["pages"], first["page"], first["per_page"]) == (25, 31, 2, 1, 25)
    assert first["jobs"][0]["title"] == "Visit 29"
    second = client.get("/api/jobs?page=2&per_page=25", headers=boss).get_json()
    assert [job["title"] for job in second["jobs"]][-1] == "Fix generator"
    assert client.get("/api/jobs?page=9", headers=boss).get_json()["jobs"] == []
    for bad in ("page=0", "page=x", "page=1&per_page=500"):
        assert client.get(f"/api/jobs?{bad}", headers=boss).status_code == 400

    # Search: any case, by the customer's or equipment's name too; wildcards are literal.
    assert client.get("/api/jobs?page=1&q=visit 1", headers=boss).get_json()["total"] == 11
    assert client.get("/api/jobs?page=1&q=GENERATOR", headers=boss).get_json()["total"] == 31
    assert client.get("/api/jobs?page=1&q=acme customer", headers=boss).get_json()["total"] == 31
    assert client.get("/api/jobs?page=1&q=%25", headers=boss).get_json()["total"] == 0
    # A technician pages through their own jobs only.
    assert client.get("/api/jobs?page=1", headers=auth("mech@acme.test")).get_json()["total"] == 1

    # The other long lists page the same way.
    for number in range(3):
        db.session.add(Notification(user_id=data["boss"], title="Job update", message=f"Visit {number} moved", type="job"))
    db.session.commit()
    page = client.get("/api/notifications?page=1&per_page=2&q=moved", headers=boss).get_json()
    assert (len(page["notifications"]), page["total"], page["pages"]) == (2, 3, 2)
    records = client.get("/api/services?page=1&q=repair", headers=boss).get_json()
    assert records["total"] == 1 and records["records"][0]["service_type"] == "Repair"
    assert client.get("/api/reviews?page=1", headers=boss).get_json()["total"] == 0
    assert client.get("/api/customers/requests?page=1", headers=boss).get_json()["total"] == 0
    # Other companies' rows are never counted.
    assert client.get("/api/jobs?page=1", headers=auth("boss@other.test")).get_json()["total"] == 0
