import pytest
import sentry_sdk
from sqlalchemy.exc import OperationalError

from app import main
from app.config import Settings
from app.monitoring import init_sentry, scrub_event


def test_health_reports_database_up(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["database"] is True


def test_health_is_503_when_database_is_down(client, monkeypatch):
    class DownEngine:
        def connect(self):
            raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    monkeypatch.setattr(main, "engine", DownEngine())
    response = client.get("/api/health")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded" and body["database"] is False
    assert "connection refused" not in response.text  # the driver's message may carry the host or user name


def test_scrub_removes_request_user_and_breadcrumbs():
    event = {
        "request": {"url": "https://hr.example.com/api/public/join/SECRET-TOKEN", "data": {"answer": "x"}},
        "user": {"ip_address": "203.0.113.9"},
        "breadcrumbs": {"values": [{"message": "Jane Doe answered"}]},
        "exception": {"values": [{"type": "ValueError", "value": "boom"}]},
    }
    scrubbed = scrub_event(event, {})
    assert set(scrubbed) == {"exception"}
    assert scrubbed["exception"]["values"][0]["value"] == "boom"


def test_scrub_masks_email_addresses_in_messages():
    event = {
        "exception": {"values": [{"type": "SMTPRecipientsRefused", "value": "{'jane.doe+cv@example.co.uk': (550, b'no')}"}, {"type": "X"}]},
        "logentry": {"message": "Invite for jane@example.com failed", "params": ["jane@example.com"]},
    }
    scrubbed = scrub_event(event, {})
    assert scrubbed["exception"]["values"][0]["value"] == "{'[email]': (550, b'no')}"
    assert scrubbed["logentry"] == {"message": "Invite for [email] failed"}


@pytest.fixture
def reset_sentry():
    yield
    sentry_sdk.init()  # no DSN: leaves a disabled client for the other tests


def test_sentry_stays_off_without_a_dsn(reset_sentry):
    init_sentry(Settings(sentry_dsn=""))
    assert not sentry_sdk.get_client().is_active()


def test_sentry_is_configured_not_to_send_personal_data(reset_sentry):
    init_sentry(Settings(sentry_dsn="https://key@o0.ingest.sentry.io/0", app_env="staging"))
    options = sentry_sdk.get_client().options
    assert options["before_send"] is scrub_event
    assert options["send_default_pii"] is False and options["include_local_variables"] is False
    assert options["max_request_body_size"] == "never" and options["max_breadcrumbs"] == 0
    assert options["environment"] == "staging"
