import io

import pytest
from PIL import Image

from app import db
from app.models import Job, JobFile, JobEvent
from app.services.storage import LocalStorage, StorageError
from conftest import SIGNATURE_PNG, SIGNED


def mech(auth):
    return auth("mech@acme.test")


def boss(auth):
    return auth("boss@acme.test")


def jpeg(width=64, height=48):
    out = io.BytesIO()
    Image.new("RGB", (width, height), (200, 80, 40)).save(out, "JPEG")
    return out.getvalue()


def start(client, auth, data):
    assert client.patch(f"/api/jobs/{data['job']}", headers=mech(auth), json={"status": "In Progress"}).status_code == 200


def request_upload(client, auth, job_id, kind="before", content_type="image/jpeg", size=1000, who=None):
    return client.post(
        f"/api/jobs/{job_id}/files",
        headers=who or mech(auth),
        json={"kind": kind, "content_type": content_type, "size": size, "name": "photo.jpg"},
    )


def upload(client, auth, job_id, payload=None, kind="before"):
    """The three steps the phone takes: reserve, upload, confirm. Returns the job detail."""
    payload = payload or jpeg()
    reserved = request_upload(client, auth, job_id, kind=kind, size=len(payload))
    assert reserved.status_code == 201, reserved.get_json()
    target = reserved.get_json()["upload"]
    assert target["method"] == "PUT" and target["url"].startswith("/api/files/upload/")
    sent = client.put(target["url"], data=payload, headers=target["headers"])
    assert sent.status_code == 204
    confirmed = client.post(f"/api/files/{reserved.get_json()['file_id']}/confirm", headers=mech(auth))
    assert confirmed.status_code == 200, confirmed.get_json()
    return confirmed.get_json()["job"]


def finish(client, auth, data, sign_off=SIGNED):
    entry = client.get(f"/api/jobs/{data['job']}", headers=mech(auth)).get_json()["job"]["entries"][-1]
    client.patch(f"/api/jobs/{data['job']}/entries/{entry['id']}", headers=mech(auth), json={"work_done": "Replaced the belt"})
    return client.patch(f"/api/jobs/{data['job']}", headers=mech(auth), json={"status": "Completed", **sign_off})


def test_photo_upload_and_who_can_see_it(client, data, auth):
    start(client, auth, data)
    payload = jpeg()
    job = upload(client, auth, data["job"], payload)
    [photo] = job["files"]
    assert photo["kind"] == "before" and photo["size_bytes"] == len(payload) and photo["uploaded_by"] == "Mech One"

    for who in ("mech@acme.test", "boss@acme.test", "cust@acme.test"):
        response = client.get(photo["url"], headers=auth(who))
        assert response.status_code == 200 and response.data == payload and response.mimetype == "image/jpeg"
    for who in ("boss@other.test", "mech2@acme.test"):
        assert client.get(photo["url"], headers=auth(who)).status_code == 404

    customer_view = client.get(f"/api/jobs/{data['job']}", headers=auth("cust@acme.test")).get_json()["job"]
    assert customer_view["files"][0]["kind"] == "before" and "uploaded_by" not in customer_view["files"][0]
    assert JobEvent.query.filter_by(job_id=data["job"], action="file_added").count() == 1


def test_upload_rules(client, app, data, auth):
    # Only while work is under way.
    assert request_upload(client, auth, data["job"]).status_code == 409
    start(client, auth, data)
    assert request_upload(client, auth, data["job"], content_type="application/pdf").status_code == 415
    assert request_upload(client, auth, data["job"], kind="video", content_type="image/jpeg").status_code == 415
    assert request_upload(client, auth, data["job"], size=11 * 1024 * 1024).status_code == 413
    assert request_upload(client, auth, data["job"], kind="video", content_type="video/mp4", size=40 * 1024 * 1024).status_code == 201
    assert request_upload(client, auth, data["job"], kind="video", content_type="video/mp4", size=51 * 1024 * 1024).status_code == 413
    # Only the assigned mechanic.
    assert request_upload(client, auth, data["job"], who=auth("mech2@acme.test")).status_code == 404
    assert request_upload(client, auth, data["job"], who=boss(auth)).status_code == 403


def test_the_size_limit_holds_even_if_the_phone_lies(client, app, data, auth, tmp_path):
    start(client, auth, data)
    app.config["MAX_PHOTO_MB"] = 1
    reserved = request_upload(client, auth, data["job"], size=1000).get_json()
    big = b"\xff" * (1024 * 1024 + 10)
    assert client.put(reserved["upload"]["url"], data=big).status_code == 413
    assert client.post(f"/api/files/{reserved['file_id']}/confirm", headers=mech(auth)).status_code == 409
    # A body sent without a Content-Length is still cut off while it is being saved.
    local = LocalStorage(tmp_path)
    with pytest.raises(StorageError):
        local.save_stream("1/jobs/1/big.jpg", io.BytesIO(big), 1024 * 1024)
    assert local.size("1/jobs/1/big.jpg") is None


def test_upload_tokens_cannot_be_forged_or_reused(client, data, auth):
    start(client, auth, data)
    reserved = request_upload(client, auth, data["job"]).get_json()
    url = reserved["upload"]["url"]
    forged = url[:-3] + ("aaa" if not url.endswith("aaa") else "bbb")
    assert client.put(forged, data=jpeg()).status_code == 403
    assert client.put(url, data=jpeg()).status_code == 204
    client.post(f"/api/files/{reserved['file_id']}/confirm", headers=mech(auth))
    assert client.put(url, data=jpeg()).status_code == 404


def test_files_can_be_removed_until_the_job_is_finished(client, data, auth):
    start(client, auth, data)
    first = upload(client, auth, data["job"])["files"][0]
    job = client.delete(f"/api/files/{first['id']}", headers=mech(auth)).get_json()["job"]
    assert job["files"] == []
    second = upload(client, auth, data["job"], kind="after")["files"][0]
    assert finish(client, auth, data).status_code == 200
    assert client.delete(f"/api/files/{second['id']}", headers=mech(auth)).status_code == 409
    assert client.get(second["url"], headers=boss(auth)).status_code == 200


def test_completion_needs_a_signature_or_a_reason(client, data, auth):
    start(client, auth, data)
    response = client.patch(f"/api/jobs/{data['job']}", headers=mech(auth), json={"status": "Completed"})
    body = response.get_json()
    # Work isn't described yet either, so the app shows the list rather than the signature pad.
    assert response.status_code == 409 and body["needs_signature"] is False
    assert "Get the customer's signature" in body["blockers"][-1]

    unsigned = finish(client, auth, data, sign_off={})
    assert unsigned.status_code == 409 and unsigned.get_json()["needs_signature"] is True
    bad = finish(client, auth, data, sign_off={"signature": {"name": "Jane", "image": "data:image/png;base64,AAAA"}})
    assert bad.status_code == 400
    no_name = finish(client, auth, data, sign_off={"signature": {"name": "", "image": SIGNATURE_PNG}})
    assert no_name.status_code == 400
    assert db.session.get(Job, data["job"]).status == "In Progress"

    done = finish(client, auth, data)
    assert done.status_code == 200
    signature = client.get(f"/api/jobs/{data['job']}", headers=auth("cust@acme.test")).get_json()["job"]["signature"]
    assert signature["name"] == "Jane Customer" and signature["signed_at"]
    image = client.get(signature["url"], headers=auth("cust@acme.test"))
    assert image.status_code == 200 and image.data.startswith(b"\x89PNG")
    assert JobEvent.query.filter_by(job_id=data["job"], action="signed").one().note == "Signed by Jane Customer"


def test_customer_not_present_is_recorded(client, data, auth):
    start(client, auth, data)
    done = finish(client, auth, data, sign_off={"no_signature_reason": "Site manager left before we finished"})
    assert done.status_code == 200
    job = client.get(f"/api/jobs/{data['job']}", headers=boss(auth)).get_json()["job"]
    assert job["signature"] == {"not_signed_reason": "Site manager left before we finished"}
    assert JobFile.query.filter_by(kind="signature").count() == 0


def test_pdf_report(client, data, auth):
    start(client, auth, data)
    upload(client, auth, data["job"], jpeg(800, 600), kind="before")
    upload(client, auth, data["job"], jpeg(600, 800), kind="after")
    url = f"/api/jobs/{data['job']}/report.pdf"
    assert client.get(url, headers=boss(auth)).status_code == 409  # not completed yet
    finish(client, auth, data)

    for who in ("boss@acme.test", "mech@acme.test", "cust@acme.test"):
        response = client.get(url, headers=auth(who))
        assert response.status_code == 200 and response.mimetype == "application/pdf"
        assert response.data.startswith(b"%PDF") and len(response.data) > 2000
    assert client.get(url, headers=auth("boss@other.test")).status_code == 404
    assert "attachment" in client.get(url + "?download=1", headers=boss(auth)).headers["Content-Disposition"]
    assert client.get(f"/api/jobs/{data['job']}", headers=boss(auth)).get_json()["job"]["report_url"] == url


def test_report_handles_names_outside_latin1(client, data, auth):
    job = db.session.get(Job, data["job"])
    job.title = "Pump — check “seal” 🛠"
    db.session.commit()
    start(client, auth, data)
    finish(client, auth, data)
    assert client.get(f"/api/jobs/{data['job']}/report.pdf", headers=boss(auth)).status_code == 200


def test_storage_used_per_company(client, data, auth):
    start(client, auth, data)
    payload = jpeg()
    upload(client, auth, data["job"], payload)
    request_upload(client, auth, data["job"])  # reserved but never uploaded: not counted
    totals = client.get("/api/reports", headers=boss(auth)).get_json()["totals"]
    assert totals["storage_bytes"] == len(payload)
    assert client.get("/api/reports", headers=auth("boss@other.test")).get_json()["totals"]["storage_bytes"] == 0


@pytest.fixture
def s3(app):
    """Swap in the S3 backend against a fake bucket (moto), as production would use R2/B2/S3."""
    from moto import mock_aws

    from app.services.storage import S3Storage

    with mock_aws():
        config = {
            "S3_BUCKET": "mechanicpro-test",
            "S3_ENDPOINT_URL": "",
            "S3_REGION": "us-east-1",
            "S3_ACCESS_KEY_ID": "test",
            "S3_SECRET_ACCESS_KEY": "test",
        }
        backend = S3Storage(config)
        backend.client.create_bucket(Bucket=config["S3_BUCKET"])
        local = app.extensions["storage"]
        app.extensions["storage"] = backend
        yield backend
        app.extensions["storage"] = local


def test_s3_mode_uploads_straight_to_the_bucket(client, data, auth, s3):
    import requests

    start(client, auth, data)
    payload = jpeg()
    reserved = request_upload(client, auth, data["job"], size=len(payload)).get_json()
    target = reserved["upload"]
    assert target["method"] == "PUT" and target["url"].startswith("https://") and "X-Amz-Signature" in target["url"]
    assert target["headers"] == {"Content-Type": "image/jpeg"}
    sent = requests.put(target["url"], data=payload, headers=target["headers"], timeout=10)
    assert sent.status_code == 200
    job = client.post(f"/api/files/{reserved['file_id']}/confirm", headers=mech(auth)).get_json()["job"]
    photo = job["files"][0]
    response = client.get(photo["url"], headers=auth("cust@acme.test"))
    assert response.status_code == 302 and "X-Amz-Signature" in response.headers["Location"]
    assert client.get(photo["url"], headers=auth("boss@other.test")).status_code == 404

    # The signature and the report work the same way against the bucket.
    assert finish(client, auth, data).status_code == 200
    assert client.get(f"/api/jobs/{data['job']}/report.pdf", headers=boss(auth)).status_code == 200


def test_s3_download_names_are_safe_in_headers(s3):
    from urllib.parse import parse_qs, urlparse

    url = s3.download_url("1/jobs/1/a.jpg", 'pump "front"\r\nX-Evil: 1.jpg', "image/jpeg", True)
    disposition = parse_qs(urlparse(url).query)["response-content-disposition"][0]
    assert disposition == 'attachment; filename="pump _front_X-Evil_ 1.jpg"'


def test_s3_mode_needs_its_settings(tmp_path):
    import os

    from app import create_app

    os.environ["APP_ENV"] = "test"
    with pytest.raises(RuntimeError, match="S3_BUCKET"):
        create_app({"SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'x.db'}", "TESTING": True, "STORAGE_BACKEND": "s3"})


def test_report_puts_transparent_signatures_on_white_paper():
    """The signature pad saves transparent pixels as (0, 0, 0, 0); they must not print black."""
    from app.services.report_pdf import thumbnail

    pad = Image.new("RGBA", (300, 100), (0, 0, 0, 0))
    pad.paste((23, 32, 51, 255), (40, 45, 260, 55))  # the ink
    out = io.BytesIO()
    pad.save(out, "PNG")
    image, _size = thumbnail(out.getvalue(), 300)
    printed = Image.open(image)
    assert printed.getpixel((5, 5)) == (255, 255, 255)
    assert sum(printed.getpixel((150, 50))) < 200


def test_report_skips_images_too_large_to_decode_safely():
    from app.services.report_pdf import thumbnail

    huge = io.BytesIO()
    Image.new("1", (8000, 6000)).save(huge, "PNG")  # 48 million pixels, tiny file
    assert thumbnail(huge.getvalue(), 900) == (None, None)


def test_served_files_are_never_treated_as_pages(client, data, auth):
    start(client, auth, data)
    photo = upload(client, auth, data["job"])["files"][0]
    response = client.get(photo["url"], headers=boss(auth))
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Content-Security-Policy"].startswith("sandbox")


def test_a_reassigned_job_with_recorded_work_cannot_be_deleted(client, data, auth):
    """Pausing then reassigning puts a job back to Assigned; its work history must survive."""
    start(client, auth, data)
    upload(client, auth, data["job"])
    client.patch(f"/api/jobs/{data['job']}", headers=mech(auth), json={"status": "Paused"})
    reassigned = client.patch(f"/api/jobs/{data['job']}", headers=boss(auth), json={"mechanic_id": data["mechanic2"]})
    assert reassigned.get_json()["job"]["status"] == "Assigned"
    response = client.delete(f"/api/jobs/{data['job']}", headers=boss(auth))
    assert response.status_code == 409
    assert db.session.get(Job, data["job"]) is not None


def test_s3_mode_rejects_an_oversized_upload_at_confirm(client, app, data, auth, s3):
    """If a provider doesn't enforce the signed size, the confirm step still does."""
    start(client, auth, data)
    app.config["MAX_PHOTO_MB"] = 1
    reserved = request_upload(client, auth, data["job"], size=1000).get_json()
    record = db.session.get(JobFile, reserved["file_id"])
    s3.put(record.storage_key, b"\xff" * (1024 * 1024 + 10), "image/jpeg")
    assert client.post(f"/api/files/{reserved['file_id']}/confirm", headers=mech(auth)).status_code == 413
    assert s3.size(record.storage_key) is None and db.session.get(JobFile, reserved["file_id"]) is None


def test_abandoned_uploads_are_purged(client, data, auth):
    from datetime import timedelta

    from app.services.media import purge_abandoned_uploads
    from app.utils.time import utcnow

    start(client, auth, data)
    kept = upload(client, auth, data["job"])["files"][0]
    abandoned = request_upload(client, auth, data["job"]).get_json()
    fresh = request_upload(client, auth, data["job"]).get_json()
    db.session.get(JobFile, abandoned["file_id"]).created_at = utcnow() - timedelta(days=2)
    db.session.commit()
    assert purge_abandoned_uploads() == 1
    db.session.commit()
    assert db.session.get(JobFile, abandoned["file_id"]) is None
    assert db.session.get(JobFile, fresh["file_id"]) is not None
    assert db.session.get(JobFile, kept["id"]).status == "ready"
