"""The server's text in each person's language, and the company settings."""
import re
from datetime import datetime

import pytest

from app import db
from app.i18n import LANGUAGES, local_time, speaking
from app.i18n.check import missing
from app.i18n.sw import SW
from app.models import Company, Notification, User
from tests.conftest import cookie

SWAHILI = {"Accept-Language": "sw"}


def test_every_server_text_has_kiswahili():
    assert missing(SW) == {}


@pytest.mark.parametrize("english, swahili", sorted(SW.items()))
def test_translations_keep_their_placeholders(english, swahili):
    assert set(re.findall(r"{\w+}", english)) == set(re.findall(r"{\w+}", swahili))


def test_errors_come_back_in_the_language_the_app_asks_for(client, data):
    bad = {"email": "boss@acme.test", "password": "wrong-password"}
    assert client.post("/api/auth/login", json=bad).get_json()["error"] == "Invalid email or password"
    assert client.post("/api/auth/login", json=bad, headers=SWAHILI).get_json()["error"] == "Barua pepe au nenosiri si sahihi"
    # Languages the app doesn't have fall back to English.
    assert client.post("/api/auth/login", json=bad, headers={"Accept-Language": "fr"}).get_json()["error"] == "Invalid email or password"
    # The app's own header wins over the browser's Accept-Language, which Firefox won't let it change.
    firefox = {"Accept-Language": "en-US,en;q=0.5", "X-Language": "sw"}
    assert client.post("/api/auth/login", json=bad, headers=firefox).get_json()["error"] == "Barua pepe au nenosiri si sahihi"
    assert client.post("/api/auth/login", json=bad, headers={"X-Language": "fr"}).get_json()["error"] == "Invalid email or password"


def test_field_names_are_translated_inside_messages(client):
    response = client.post("/api/signup", json={"name": "Wanjiku", "email": "w@riftpower.test", "password": "a-long-password"}, headers=SWAHILI)
    assert response.status_code == 400
    assert response.get_json()["error"] == "Jina la kampuni inahitajika"


def test_job_statuses_are_translated_in_messages(client, data, auth):
    headers = {**auth("mech@acme.test"), **SWAHILI}
    response = client.patch(f"/api/jobs/{data['job']}", headers=headers, json={"status": "Completed"})
    assert response.status_code == 409
    assert response.get_json()["error"] == "Kazi yenye hali \u201cImekabidhiwa\u201d haiwezi kuhamishiwa \u201cImekamilika\u201d"


def test_notifications_are_written_in_the_recipients_language(client, data, auth):
    db.session.get(User, data["mechanic2"]).language = "sw"
    db.session.commit()
    job = client.post("/api/jobs", headers=auth("boss@acme.test"), json={"title": "Pump", "description": "Leak"}).get_json()["job"]
    client.patch(f"/api/jobs/{job['id']}", headers=auth("boss@acme.test"), json={"mechanic_id": data["mechanic2"]})
    note = Notification.query.filter_by(user_id=data["mechanic2"]).one()
    assert (note.title, note.message) == ("Umepewa kazi mpya", "Umekabidhiwa kazi: Pump.")


def test_emails_are_written_in_the_recipients_language(app, client, data):
    app.extensions["email"].outbox.clear()
    db.session.get(User, data["boss"]).language = "sw"
    db.session.commit()
    client.post("/api/auth/forgot-password", json={"email": "boss@acme.test"})
    assert app.extensions["email"].outbox[-1]["Subject"] == "Badilisha nenosiri lako la MechanicPro"


def test_people_choose_their_own_language(client, data, auth):
    response = client.patch("/api/users/me", headers=auth("cust@acme.test"), json={"language": "sw"})
    assert response.status_code == 200 and response.get_json()["user"]["language"] == "sw"
    assert db.session.get(User, data["customer"]).language == "sw"
    assert client.patch("/api/users/me", headers=auth("cust@acme.test"), json={"language": "xx"}).status_code == 400
    assert client.get("/api/users/me", headers=auth("cust@acme.test")).get_json()["user"]["timezone"] == "Africa/Nairobi"
    assert client.get("/api/users/me", headers=auth("cust@acme.test")).get_json()["user"]["units"] == "metric"


def test_new_accounts_start_in_the_language_the_app_is_in(client):
    response = client.post(
        "/api/signup",
        json={"company_name": "Pwani Power", "name": "Amani", "email": "amani@pwani.test", "password": "a-long-password"},
        headers=SWAHILI,
    )
    assert response.status_code == 201 and response.get_json()["user"]["language"] == "sw"
    demo = client.post("/api/demo", json={"role": "mechanic"}, headers=SWAHILI).get_json()["user"]
    assert demo["language"] == "sw"


def test_company_settings(client, data, auth):
    boss = auth("boss@acme.test")
    settings = client.get("/api/company/settings", headers=boss).get_json()
    assert settings["settings"] == {"timezone": "Africa/Nairobi", "currency": "KES", "units": "metric"}
    assert "Africa/Dar_es_Salaam" in settings["timezones"] and "TZS" in settings["currencies"]
    changed = client.patch("/api/company/settings", headers=boss, json={"timezone": "Africa/Dar_es_Salaam", "currency": "TZS", "units": "imperial"})
    assert changed.get_json()["settings"] == {"timezone": "Africa/Dar_es_Salaam", "currency": "TZS", "units": "imperial"}
    assert db.session.get(Company, data["acme"]).timezone == "Africa/Dar_es_Salaam"
    assert client.patch("/api/company/settings", headers=boss, json={"timezone": "Mars/Olympus"}).status_code == 400
    assert client.patch("/api/company/settings", headers=boss, json={"currency": "BTC"}).status_code == 400
    assert client.get("/api/company/settings", headers=auth("mech@acme.test")).status_code == 403


def test_times_are_shown_in_the_company_time_zone():
    moment = datetime(2026, 10, 31, 21, 30)  # stored in UTC
    assert local_time(moment, "Africa/Nairobi") == "01 Nov 2026 00:30"
    assert local_time(moment, "Africa/Nairobi", with_time=False) == "01 Nov 2026"
    assert local_time(moment, "Europe/London") == "31 Oct 2026 21:30"
    with speaking("sw"):
        assert local_time(datetime(2026, 8, 5, 6, 0), "UTC") == "05 Ago 2026 06:00"


def test_only_known_languages_are_offered():
    assert set(LANGUAGES) == {"en", "sw"}
