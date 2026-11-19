import asyncio
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app import retention
from app.database import SessionLocal
from app.main import app
from app.models import AuditLog, IntegrityEvent, InterviewSession, TestSubmission
from helpers import event_payload, make_test

OLD = datetime.now(timezone.utc) - timedelta(days=40)  # default retention is 30 days


def finished_session(client, headers, new_session, email: str) -> dict:
    data = new_session(headers, candidate_email=email)
    token = data["public_token"]
    client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True})
    client.post(f"/api/public/sessions/{token}/start")
    client.post(f"/api/public/sessions/{token}/events", json=event_payload())
    client.post(f"/api/public/sessions/{token}/finish")
    return data


def age_session(session_id: str) -> None:
    with SessionLocal() as db:
        db.get(InterviewSession, session_id).ended_at = OLD
        for entry in db.query(AuditLog).filter(AuditLog.session_id == session_id):
            entry.created_at = OLD
        db.commit()


def test_retention_validation(client, hr):
    assert client.put("/api/settings/retention", headers=hr, json={"retention_days": 0}).status_code == 422
    assert client.put("/api/settings/retention", headers=hr, json={"retention_days": 366}).status_code == 422
    assert client.put("/api/settings/retention", headers=hr, json={"retention_days": 7}).json()["retention_days"] == 7


def test_purge_removes_expired_monitoring_data_and_personal_identifiers(client, hr, new_session):
    old = finished_session(client, hr, new_session, "old@example.com")
    recent = finished_session(client, hr, new_session, "recent@example.com")
    age_session(old["id"])
    with SessionLocal() as db:
        assert db.get(InterviewSession, old["id"]).consent_ip is not None

    result = client.post("/api/settings/retention/purge", headers=hr).json()
    assert result["deleted_events"] == 1 and result["scrubbed_audit_ips"] >= 1

    with SessionLocal() as db:
        assert db.query(IntegrityEvent).filter(IntegrityEvent.session_id == old["id"]).count() == 0
        assert db.query(IntegrityEvent).filter(IntegrityEvent.session_id == recent["id"]).count() == 1
        assert db.get(InterviewSession, old["id"]).consent_ip is None
        assert db.get(InterviewSession, recent["id"]).consent_ip is not None
        assert all(entry.ip_address is None for entry in db.query(AuditLog).filter(AuditLog.session_id == old["id"]))
        assert any(entry.ip_address for entry in db.query(AuditLog).filter(AuditLog.session_id == recent["id"]))
    assert client.get(f"/api/sessions/{old['id']}", headers=hr).status_code == 200  # the session record itself stays


def test_purge_removes_old_submissions_but_only_for_the_caller(client, hr, other_hr, new_session):
    test = make_test(client, hr)
    other_test = make_test(client, other_hr)
    for created in (test, other_test):
        client.post(f"/api/public/tests/{created['public_token']}/submissions", json={"participant_email": "p@example.com", "answers": {}})
    with SessionLocal() as db:
        for submission in db.query(TestSubmission):
            submission.submitted_at = OLD
        db.commit()
    assert client.post("/api/settings/retention/purge", headers=hr).json()["deleted_submissions"] == 1
    with SessionLocal() as db:
        assert db.query(TestSubmission).count() == 1  # the other HR user's data is untouched


def test_scheduled_purge_covers_every_active_user(client, hr, other_hr, new_session):
    sessions = [finished_session(client, headers, new_session, f"c{index}@example.com") for index, headers in enumerate((hr, other_hr))]
    for data in sessions:
        age_session(data["id"])
    assert retention.purge_all() == 2
    with SessionLocal() as db:
        assert db.query(IntegrityEvent).count() == 0
        assert db.query(AuditLog).filter(AuditLog.action == "retention.purge.scheduled").count() == 2


def test_background_purge_task_starts_and_stops_cleanly(settings, monkeypatch):
    monkeypatch.setattr(settings, "retention_purge_interval_hours", 1)
    with TestClient(app) as client:
        assert client.get("/api/health").json()["status"] == "ok"


def test_retention_loop_runs_purge_after_each_interval(settings, monkeypatch):
    calls = []
    monkeypatch.setattr(settings, "retention_purge_interval_hours", 1)
    monkeypatch.setattr(retention, "purge_all", lambda: calls.append(1) or 0)
    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) > 2:
            raise asyncio.CancelledError

    monkeypatch.setattr(retention.asyncio, "sleep", fake_sleep)
    try:
        asyncio.run(retention.retention_loop())
    except asyncio.CancelledError:
        pass
    assert sleeps[0] == 3600 and len(calls) == 2
