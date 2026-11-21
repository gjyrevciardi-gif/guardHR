from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.database import SessionLocal
from app.enums import EventType
from app.models import InterviewSession
from app.signals import Severity, monitoring_summary, needs_review, record_heartbeat, severity_for, signal_level
from helpers import event_payload

NOW = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


# ---- pure rules -------------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("event_type", "duration", "metadata", "expected"),
    [
        ("phone_detected", None, None, Severity.high),
        ("multiple_people", None, None, Severity.high),
        ("screen_share_stopped", None, None, Severity.high),
        ("face_not_visible", None, None, Severity.medium),
        ("camera_disabled", None, None, Severity.medium),
        ("tab_hidden", None, None, Severity.low),  # still open: duration unknown
        ("tab_hidden", 29.9, None, Severity.low),
        ("tab_hidden", 30, None, Severity.medium),
        ("copy_paste", None, {"operation": "paste"}, Severity.medium),
        ("copy_paste", None, {"operation": "copy"}, Severity.low),
        ("fullscreen_exit", None, None, Severity.low),
        ("multiple_monitors", None, None, Severity.low),
        ("window_resized", None, None, Severity.info),
        ("connection_interruption", None, None, Severity.info),
    ],
)
def test_severity_by_event_type(event_type, duration, metadata, expected):
    assert severity_for(event_type, duration, metadata) == expected


def test_every_event_type_has_a_severity():
    for event_type in EventType:
        assert isinstance(severity_for(event_type), Severity)


def test_review_rule_thresholds():
    assert not needs_review({})
    assert not needs_review({Severity.info: 50})
    assert not needs_review({Severity.medium: 1, Severity.low: 5})
    assert needs_review({Severity.high: 1})
    assert needs_review({Severity.medium: 2})
    assert needs_review({Severity.low: 6})


def test_signal_level_names():
    assert signal_level(None) == "none" and signal_level(0) == "info" and signal_level(3) == "high"


def call(**fields) -> SimpleNamespace:
    base = dict(started_at=NOW - timedelta(minutes=10), ended_at=None, last_seen_at=None, monitored_seconds=0.0, face_seconds=0.0, monitor_gaps=0)
    return SimpleNamespace(**(base | fields))


def test_heartbeats_accumulate_monitored_time_and_face_time_separately():
    session = call(last_seen_at=NOW - timedelta(seconds=10))
    record_heartbeat(session, face_detection_active=True, now=NOW)
    record_heartbeat(session, face_detection_active=False, now=NOW + timedelta(seconds=10))
    assert session.monitored_seconds == 20 and session.face_seconds == 10 and session.monitor_gaps == 0
    assert session.last_seen_at == NOW + timedelta(seconds=10)


def test_a_long_silence_is_a_gap_not_monitored_time():
    session = call(last_seen_at=NOW - timedelta(seconds=46))
    record_heartbeat(session, True, NOW)
    assert session.monitored_seconds == 0 and session.monitor_gaps == 1
    assert session.last_seen_at == NOW  # monitoring resumes from here


def test_first_heartbeat_of_an_untracked_call_starts_tracking_without_a_gap():
    session = call(monitored_seconds=None, face_seconds=None)
    record_heartbeat(session, True, NOW)
    assert session.monitored_seconds == 0 and session.monitor_gaps == 0 and session.last_seen_at == NOW


def test_monitoring_summary_quality():
    assert monitoring_summary(call(started_at=None), NOW)["quality"] == "unknown"  # not started
    assert monitoring_summary(call(monitored_seconds=None), NOW)["quality"] == "unknown"  # began before coverage was tracked
    assert monitoring_summary(call(started_at=NOW - timedelta(seconds=20)), NOW)["quality"] == "unknown"  # too short to judge
    assert monitoring_summary(call(monitored_seconds=0), NOW)["quality"] == "none"
    partial = monitoring_summary(call(monitored_seconds=300, face_seconds=60, monitor_gaps=2), NOW)  # 5 of 10 minutes
    assert (partial["quality"], partial["coverage_percent"], partial["face_percent"], partial["gaps"]) == ("partial", 50, 10, 2)
    assert monitoring_summary(call(monitored_seconds=570), NOW)["quality"] == "good"  # 95%
    assert monitoring_summary(call(monitored_seconds=9999), NOW)["coverage_percent"] == 100  # never above 100


def test_finished_call_is_measured_to_its_end_not_to_now():
    ended = call(ended_at=NOW - timedelta(minutes=5), started_at=NOW - timedelta(minutes=10), monitored_seconds=290)
    assert monitoring_summary(ended, NOW)["coverage_percent"] == 97


# ---- API ---------------------------------------------------------------------------------------

def post_event(client, token, **overrides):
    response = client.post(f"/api/public/sessions/{token}/events", json=event_payload(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


def review_status(client, hr, session_id):
    return client.get(f"/api/sessions/{session_id}", headers=hr).json()["review_status"]


def test_minor_signals_do_not_flag_a_call_for_review(client, hr, started_session):
    token, session_id = started_session["public_token"], started_session["id"]
    post_event(client, token, event_type="window_resized", duration_seconds=None, metadata={})
    post_event(client, token, event_type="tab_hidden", duration_seconds=2)
    post_event(client, token, event_type="copy_paste", metadata={"operation": "paste"})  # one medium signal
    detail = client.get(f"/api/sessions/{session_id}", headers=hr).json()
    assert detail["review_status"] == "No events detected"
    assert detail["signal_level"] == "medium" and len(detail["events"]) == 3
    assert {event["event_type"]: event["severity"] for event in detail["events"]} == {"window_resized": "info", "tab_hidden": "low", "copy_paste": "medium"}


def test_two_medium_signals_or_one_high_signal_flag_a_call(client, hr, new_session):
    for first_type, second_type, expected in (("face_not_visible", "camera_disabled", "Requires review"), ("phone_detected", None, "Requires review"), ("face_not_visible", None, "No events detected")):
        data = new_session(hr, candidate_email=f"{first_type}-{second_type}@example.com")
        token = data["public_token"]
        client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True})
        client.post(f"/api/public/sessions/{token}/start")
        post_event(client, token, event_type=first_type)
        if second_type:
            post_event(client, token, event_type=second_type)
        assert review_status(client, hr, data["id"]) == expected


def test_six_low_signals_flag_a_call(client, hr, started_session):
    token = started_session["public_token"]
    for _ in range(5):
        post_event(client, token, event_type="fullscreen_exit")
    assert review_status(client, hr, started_session["id"]) == "No events detected"
    post_event(client, token, event_type="fullscreen_exit")
    assert review_status(client, hr, started_session["id"]) == "Requires review"


def test_a_completed_review_is_never_reset_by_new_signals(client, hr, started_session):
    token, session_id = started_session["public_token"], started_session["id"]
    post_event(client, token, event_type="phone_detected")
    client.post(f"/api/sessions/{session_id}/reviews", headers=hr, json={"outcome": "Insufficient evidence", "notes": "Looked at it."})
    post_event(client, token, event_type="multiple_people")
    assert review_status(client, hr, session_id) == "Insufficient evidence"


def test_closing_an_event_updates_duration_and_severity_without_a_second_row(client, hr, started_session):
    token, session_id = started_session["public_token"], started_session["id"]
    opened = post_event(client, token, event_type="tab_hidden", duration_seconds=None, ended_at=None)
    assert opened["severity"] == "low" and opened["duration_seconds"] is None
    closed = client.patch(f"/api/public/sessions/{token}/events/{opened['id']}", json={"ended_at": datetime.now(timezone.utc).isoformat(), "duration_seconds": 75})
    assert closed.status_code == 200 and closed.json()["duration_seconds"] == 75 and closed.json()["severity"] == "medium"
    events = client.get(f"/api/sessions/{session_id}", headers=hr).json()["events"]
    assert len(events) == 1 and events[0]["severity"] == "medium"
    again = client.patch(f"/api/public/sessions/{token}/events/{opened['id']}", json={"ended_at": datetime.now(timezone.utc).isoformat(), "duration_seconds": 1})
    assert again.status_code == 409  # closed once, never rewritten


def test_a_closed_episode_can_tip_the_review_status(client, hr, started_session):
    token, session_id = started_session["public_token"], started_session["id"]
    post_event(client, token, event_type="face_not_visible")  # one medium
    opened = post_event(client, token, event_type="tab_hidden", duration_seconds=None, ended_at=None)  # low while open
    assert review_status(client, hr, session_id) == "No events detected"
    client.patch(f"/api/public/sessions/{token}/events/{opened['id']}", json={"ended_at": datetime.now(timezone.utc).isoformat(), "duration_seconds": 120})
    assert review_status(client, hr, session_id) == "Requires review"  # now two medium signals


def test_cannot_close_someone_elses_event_or_a_missing_one(client, hr, started_session, new_session):
    other = new_session(hr, candidate_email="other@example.com")
    client.post(f"/api/public/sessions/{other['public_token']}/consent", json={"accepted": True})
    client.post(f"/api/public/sessions/{other['public_token']}/start")
    foreign = post_event(client, other["public_token"], event_type="tab_hidden", duration_seconds=None, ended_at=None)
    body = {"ended_at": datetime.now(timezone.utc).isoformat(), "duration_seconds": 5}
    assert client.patch(f"/api/public/sessions/{started_session['public_token']}/events/{foreign['id']}", json=body).status_code == 404
    assert client.patch(f"/api/public/sessions/{started_session['public_token']}/events/6f9619ff-8b86-d011-b42d-00c04fc964ff", json=body).status_code == 404
    assert client.patch(f"/api/public/sessions/{started_session['public_token']}/events/not-a-uuid", json=body).status_code == 404
    assert client.patch(f"/api/public/sessions/{started_session['public_token']}/events/{foreign['id']}", json={"duration_seconds": -1, "ended_at": body["ended_at"]}).status_code == 422


def set_last_seen(session_id, seconds_ago):
    with SessionLocal() as db:
        db.get(InterviewSession, session_id).last_seen_at = datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)
        db.commit()


def test_heartbeat_accumulates_coverage_and_reports_gaps(client, hr, started_session):
    token, session_id = started_session["public_token"], started_session["id"]
    url = f"/api/public/sessions/{token}/heartbeat"
    set_last_seen(session_id, 10)
    assert client.post(url, json={"face_detection": True}).status_code == 204
    set_last_seen(session_id, 200)  # the monitor was silent for over three minutes
    assert client.post(url, json={"face_detection": False}).status_code == 204
    with SessionLocal() as db:
        row = db.get(InterviewSession, session_id)
        assert 9.5 < row.monitored_seconds < 11 and 9.5 < row.face_seconds < 11 and row.monitor_gaps == 1
    monitoring = client.get(f"/api/sessions/{session_id}", headers=hr).json()["monitoring"]
    assert monitoring["gaps"] == 1 and monitoring["last_seen_at"] is not None and monitoring["quality"] == "unknown"  # call is seconds old


def test_heartbeat_needs_a_running_call_and_a_valid_link(client, hr, new_session):
    data = new_session(hr)
    token = data["public_token"]
    assert client.post(f"/api/public/sessions/{token}/heartbeat", json={}).status_code == 409  # not started
    assert client.post("/api/public/sessions/6f9619ff-8b86-d011-b42d-00c04fc964ff/heartbeat", json={}).status_code == 404
    client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True})
    client.post(f"/api/public/sessions/{token}/start")
    assert client.post(f"/api/public/sessions/{token}/heartbeat", json={"face_detection": "yes please"}).status_code == 422
    client.post(f"/api/public/sessions/{token}/finish")
    assert client.post(f"/api/public/sessions/{token}/heartbeat", json={}).status_code == 409


def test_list_shows_signal_level_and_monitoring_without_loading_events(client, hr, started_session, new_session):
    post_event(client, started_session["public_token"], event_type="multiple_people")
    quiet = new_session(hr, candidate_email="quiet@example.com")
    rows = {row["id"]: row for row in client.get("/api/sessions", headers=hr).json()}
    assert rows[started_session["id"]]["signal_level"] == "high"
    assert rows[quiet["id"]]["signal_level"] == "none"
    assert rows[quiet["id"]]["monitoring"]["quality"] == "unknown"


def test_abandoned_call_ends_at_its_last_heartbeat(client, hr, started_session):
    from app import retention
    from app.models import User

    session_id = started_session["id"]
    with SessionLocal() as db:
        row = db.get(InterviewSession, session_id)
        row.started_at = NOW - timedelta(days=2)
        row.last_seen_at = NOW - timedelta(days=2) + timedelta(minutes=47)
        db.commit()
        owner = db.get(User, row.created_by)
        assert retention.close_abandoned_sessions(db, owner, datetime.now(timezone.utc)) == 1
        db.commit()
        assert db.get(InterviewSession, session_id).ended_at.replace(tzinfo=timezone.utc) == NOW - timedelta(days=2) + timedelta(minutes=47)


def test_a_call_with_a_recent_heartbeat_is_not_abandoned_however_long_it_runs(client, hr, started_session):
    from app import retention
    from app.models import User

    with SessionLocal() as db:
        row = db.get(InterviewSession, started_session["id"])
        row.started_at = datetime.now(timezone.utc) - timedelta(hours=20)  # long call, but the monitor is still reporting
        row.last_seen_at = datetime.now(timezone.utc) - timedelta(seconds=10)
        db.commit()
        assert retention.close_abandoned_sessions(db, db.get(User, row.created_by), datetime.now(timezone.utc)) == 0
