from app import db
from app.models import Job, Machine, ServiceRequest


def boss(auth):
    return auth("boss@acme.test")


def add_machine(data, name, serial, status="Operational"):
    machine = Machine(name=name, serial_no=serial, customer_id=data["acme_customer"], company_id=data["acme"], status=status)
    db.session.add(machine)
    db.session.commit()
    return machine.id


def by_name(machines):
    return {machine["name"]: machine for machine in machines}


def test_needs_work_rule(client, data, auth):
    """An open job, an open request, or Under Maintenance/Repair makes a machine need work."""
    quiet = add_machine(data, "Compressor", "SN-2")
    add_machine(data, "Pump", "SN-3", status="Under Repair")
    add_machine(data, "Old mixer", "SN-4", status="Retired")
    requested = add_machine(data, "Conveyor", "SN-5")
    db.session.add_all(
        [
            ServiceRequest(customer_id=data["acme_customer"], company_id=data["acme"], machine_id=requested, subject="Belt slipping", description="x", status="Reviewing"),
            ServiceRequest(customer_id=data["acme_customer"], company_id=data["acme"], machine_id=quiet, subject="Done already", description="x", status="Completed"),
            Job(title="Old job", description="x", company_id=data["acme"], customer_id=data["acme_customer"], machine_id=quiet, status="Completed"),
        ]
    )
    db.session.commit()

    machines = by_name(client.get("/api/machines", headers=boss(auth)).get_json()["machines"])
    # The fixture's generator has an Assigned job.
    assert machines["Generator"]["needs_work"] is True
    assert machines["Generator"]["work"] == [{"type": "job", "id": data["job"], "title": "Fix generator", "status": "Assigned"}]
    assert machines["Conveyor"]["work"][0]["type"] == "request" and machines["Conveyor"]["work"][0]["title"] == "Belt slipping"
    assert machines["Pump"]["work"] == [{"type": "status", "status": "Under Repair"}]
    for name in ("Compressor", "Old mixer"):
        assert machines[name]["needs_work"] is False and machines[name]["work"] == []


def test_finishing_the_work_clears_the_flag(client, data, auth):
    job = db.session.get(Job, data["job"])
    job.status = "Cancelled"
    db.session.commit()
    machines = by_name(client.get("/api/machines", headers=boss(auth)).get_json()["machines"])
    assert machines["Generator"]["needs_work"] is False


def test_customer_list_counts_machines_needing_work(client, data, auth):
    add_machine(data, "Compressor", "SN-2")
    add_machine(data, "Pump", "SN-3", status="Under Maintenance")
    customers = {c["name"]: c for c in client.get("/api/customers", headers=boss(auth)).get_json()["customers"]}
    assert customers["Acme Customer"]["machine_count"] == 3
    assert customers["Acme Customer"]["needs_work_count"] == 2


def test_customer_page_lists_machines_needing_work_first(client, data, auth):
    add_machine(data, "Air compressor", "SN-2")
    add_machine(data, "Boiler", "SN-3", status="Retired")
    response = client.get(f"/api/customers/{data['acme_customer']}", headers=boss(auth))
    assert response.status_code == 200
    customer = response.get_json()["customer"]
    assert [m["name"] for m in customer["machines"]] == ["Generator", "Air compressor", "Boiler"]
    assert customer["needs_work_count"] == 1
    assert customer["job_count"] == 1 and customer["completed_job_count"] == 0
    assert [r["id"] for r in customer["records"]] == [data["record"]]


def test_customer_page_is_for_the_customers_own_company_boss(client, data, auth):
    url = f"/api/customers/{data['acme_customer']}"
    assert client.get(url, headers=auth("boss@other.test")).status_code == 404
    for who in ("mech@acme.test", "cust@acme.test"):
        assert client.get(url, headers=auth(who)).status_code == 403


def test_only_managers_get_the_work_details(client, data, auth):
    for who in ("mech@acme.test", "cust@acme.test"):
        machine = client.get("/api/machines", headers=auth(who)).get_json()["machines"][0]
        assert "work" not in machine and "needs_work" not in machine
    other = client.get("/api/machines", headers=auth("boss@other.test")).get_json()["machines"]
    assert [m["name"] for m in other] == ["Pump"] and other[0]["needs_work"] is False
