from app import db
from app.models import Machine


def boss(auth):
    return auth("boss@acme.test")


def test_customer_request_validation_and_boss_notifications(client, data, auth):
    customer = auth("cust@acme.test")
    assert client.post("/api/customers/requests", headers=customer, json={"machine_id": data["machine"]}).status_code == 400
    bad_priority = {"machine_id": data["machine"], "subject": "s", "description": "d", "priority": "Normal"}
    assert client.post("/api/customers/requests", headers=customer, json=bad_priority).status_code == 400
    other_machine = {"machine_id": data["other_machine"], "subject": "s", "description": "d"}
    assert client.post("/api/customers/requests", headers=customer, json=other_machine).status_code == 404
    ok = {"machine_id": str(data["machine"]), "subject": "Noise", "description": "Loud", "priority": "High"}
    response = client.post("/api/customers/requests", headers=customer, json=ok)
    assert response.status_code == 201
    requests = client.get("/api/customers/requests", headers=customer).get_json()["requests"]
    assert requests[0]["status"] == "Submitted" and requests[0]["priority"] == "High"


def test_boss_updates_request_status(client, data, auth):
    customer = auth("cust@acme.test")
    rid = client.post(
        "/api/customers/requests", headers=customer, json={"machine_id": data["machine"], "subject": "s", "description": "d"}
    ).get_json()["id"]
    assert client.patch(f"/api/customers/requests/{rid}", headers=boss(auth), json={"status": "Bogus"}).status_code == 400
    assert client.patch(f"/api/customers/requests/{rid}", headers=boss(auth), json={"status": "Reviewing"}).status_code == 200
    assert client.patch(f"/api/customers/requests/{rid}", headers=auth("boss@other.test"), json={"status": "Approved"}).status_code == 404


def test_review_validation(client, data, auth):
    customer = auth("cust@acme.test")
    for rating in ("abc", 0, 6, None):
        response = client.post("/api/reviews", headers=customer, json={"service_record_id": data["record"], "rating": rating})
        assert response.status_code == 400
    response = client.post("/api/reviews", headers=customer, json={"service_record_id": str(data["record"]), "rating": "5"})
    assert response.status_code == 201
    again = client.post("/api/reviews", headers=customer, json={"service_record_id": data["record"], "rating": 4})
    assert again.status_code == 409


def test_reviews_are_permanent(client, data, auth):
    customer = auth("cust@acme.test")
    rid = client.post("/api/reviews", headers=customer, json={"service_record_id": data["record"], "rating": 4}).get_json()["id"]
    assert client.delete(f"/api/reviews/{rid}", headers=customer).status_code == 405


def test_only_the_assigned_mechanic_writes_the_service_summary(client, data, auth):
    payload = {"problem": "Overheats", "solution": "New fan"}
    assert client.put(f"/api/jobs/{data['job']}/record", headers=auth("mech2@acme.test"), json=payload).status_code == 404
    response = client.put(f"/api/jobs/{data['job']}/record", headers=auth("mech@acme.test"), json=payload)
    assert response.status_code == 200
    assert response.get_json()["job"]["record"]["solution"] == "New fan"


def test_boss_edits_customer(client, data, auth):
    url = f"/api/customers/{data['acme_customer']}"
    response = client.patch(url, headers=boss(auth), json={"name": "Acme Renamed", "phone": "+254 700 000 000"})
    assert response.status_code == 200
    assert response.get_json()["customer"]["name"] == "Acme Renamed"
    assert client.patch(url, headers=boss(auth), json={"name": ""}).status_code == 400
    assert client.patch(url, headers=boss(auth), json={"email": "bad"}).status_code == 400
    assert client.patch(url, headers=auth("boss@other.test"), json={"name": "x"}).status_code == 404


def test_boss_edits_machine(client, data, auth):
    url = f"/api/machines/{data['machine']}"
    response = client.patch(url, headers=boss(auth), json={"name": "Gen 2", "serial_no": "SN-1B", "status": "Retired"})
    assert response.get_json()["machine"] == {**response.get_json()["machine"], "name": "Gen 2", "serial_no": "SN-1B", "status": "Retired"}
    assert client.patch(url, headers=boss(auth), json={"status": "Broken"}).status_code == 400


def test_service_history_has_no_write_endpoints(client, data, auth):
    for method in ("delete", "patch"):
        response = getattr(client, method)(f"/api/services/{data['record']}", headers=boss(auth), json={})
        assert response.status_code in (404, 405)
    assert client.post("/api/services", headers=auth("mech@acme.test"), json={}).status_code == 405


def test_serial_numbers_are_unique_per_company_only(client, data, auth):
    payload = {"name": "Twin", "serial_no": "SN-OTHER", "customer_id": data["acme_customer"]}
    assert client.post("/api/machines", headers=boss(auth), json=payload).status_code == 201
    duplicate = client.post("/api/machines", headers=boss(auth), json={**payload, "serial_no": "SN-1"})
    assert duplicate.status_code == 409
    assert "Other" not in duplicate.get_json()["error"]
    foreign_customer = client.post(
        "/api/machines", headers=boss(auth), json={"name": "x", "serial_no": "SN-9", "customer_id": data["other_customer"]}
    )
    assert foreign_customer.status_code == 404


def test_machine_with_history_cannot_be_deleted(client, data, auth):
    assert client.delete(f"/api/machines/{data['machine']}", headers=boss(auth)).status_code == 409
    new_id = client.post(
        "/api/machines", headers=boss(auth), json={"name": "Spare", "serial_no": "SN-2", "customer_id": data["acme_customer"]}
    ).get_json()["id"]
    assert client.delete(f"/api/machines/{new_id}", headers=boss(auth)).status_code == 200
    assert db.session.get(Machine, new_id) is None


def test_customer_with_history_cannot_be_deleted(client, data, auth):
    assert client.delete(f"/api/customers/{data['acme_customer']}", headers=boss(auth)).status_code == 409


def test_customer_without_history_is_deleted_with_login(client, data, auth):
    code = client.post("/api/customers/invite", headers=boss(auth), json={"name": "Brief", "email": "brief@x.test"}).get_json()["code"]
    client.post("/api/auth/accept-invitation", json={"code": code, "name": "Brief", "email": "brief@x.test", "password": "long-enough", "accept_terms": True})
    customer_id = next(c["id"] for c in client.get("/api/customers", headers=boss(auth)).get_json()["customers"] if c["email"] == "brief@x.test")
    assert client.delete(f"/api/customers/{customer_id}", headers=boss(auth)).status_code == 200
    assert client.post("/api/auth/login", json={"email": "brief@x.test", "password": "long-enough", "accept_terms": True}).status_code == 401


def test_mechanic_with_history_cannot_be_deleted(client, data, auth):
    assert client.delete(f"/api/users/{data['mechanic']}", headers=boss(auth)).status_code == 409
    assert client.delete(f"/api/users/{data['boss']}", headers=boss(auth)).status_code == 400
    assert client.delete(f"/api/users/{data['other_mechanic']}", headers=boss(auth)).status_code == 404


def test_update_user_validation(client, data, auth):
    assert client.patch(f"/api/users/{data['mechanic2']}", headers=boss(auth), json={"email": 5}).status_code == 400
    taken = client.patch(f"/api/users/{data['mechanic2']}", headers=boss(auth), json={"email": "boss@other.test"})
    assert taken.status_code == 409
    assert "other" not in taken.get_json()["error"].lower()


def test_role_permissions(client, data, auth):
    customer = auth("cust@acme.test")
    mech = auth("mech@acme.test")
    assert client.get("/api/customers", headers=customer).status_code == 403
    assert client.get("/api/users", headers=mech).status_code == 403
    assert client.post("/api/jobs", headers=mech, json={"title": "x", "description": "y"}).status_code == 403
    assert client.post("/api/customers/invite", headers=mech, json={"name": "x", "email": "x@x.test"}).status_code == 403


def test_scoped_lists(client, data, auth):
    other = auth("boss@other.test")
    assert [m["id"] for m in client.get("/api/machines", headers=other).get_json()["machines"]] == [data["other_machine"]]
    assert client.get("/api/services", headers=other).get_json()["records"] == []
    assert client.get("/api/customers/requests", headers=other).get_json()["requests"] == []
    assert client.get("/api/company", headers=other).get_json()["company"]["name"] == "Other Co"


def test_reports_and_sidebar_totals(client, data, auth):
    boss_report = client.get("/api/reports", headers=boss(auth)).get_json()
    assert boss_report["totals"] == {"customers": 1, "machines": 1, "storage_bytes": 0}
    mech_report = client.get("/api/reports", headers=auth("mech@acme.test")).get_json()
    assert mech_report["totals"] == {"customers": 1, "machines": 1}
    customer_report = client.get("/api/reports", headers=auth("cust@acme.test")).get_json()
    assert customer_report["rating"] is None


def test_unknown_route_and_bad_json_return_json(client, auth):
    assert client.get("/api/nope").get_json()["error"]
    response = client.post("/api/jobs", headers={**auth("boss@acme.test"), "Content-Type": "application/json"}, data="{bad")
    assert response.status_code == 400
