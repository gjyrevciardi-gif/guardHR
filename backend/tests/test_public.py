from datetime import datetime, timedelta, timezone

import pytest

from app.api import public
from app.database import SessionLocal
from app.models import InterviewSession
from helpers import event_payload, make_test


def set_session(session_id: str, **fields) -> None:
    with SessionLocal() as db:
        session = db.get(InterviewSession, session_id)
        for name, value in fields.items():
            setattr(session, name, value)
        db.commit()


def get_session(session_id: str) -> InterviewSession:
    with SessionLocal() as db:
        return db.get(InterviewSession, session_id)


def test_unknown_or_malformed_links_are_404(client):
    for token in ("not-a-uuid", "6f9619ff-8b86-d011-b42d-00c04fc964ff"):
        assert client.get(f"/api/public/sessions/{token}").status_code == 404
        assert client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True}).status_code == 404
        assert client.post(f"/api/public/sessions/{token}/events", json=event_payload()).status_code == 404


def test_invalid_event_type_is_rejected(client):
    assert client.post("/api/public/sessions/not-a-token/events", json=event_payload(event_type="emotion_detected")).status_code == 422


def test_consent_is_required_and_explicit(client, hr, new_session):
    token = new_session(hr)["public_token"]
    assert client.post(f"/api/public/sessions/{token}/consent", json={"accepted": False}).status_code == 422
    assert client.post(f"/api/public/sessions/{token}/start").status_code == 403


def test_replaying_consent_cannot_rewind_a_running_session(client, started_session):
    token, session_id = started_session["public_token"], started_session["id"]
    before = get_session(session_id)
    again = client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True})
    assert again.status_code == 200 and again.json()["status"] == "in_progress"
    after = get_session(session_id)
    assert after.status == "in_progress"
    assert (after.consented_at, after.consent_ip) == (before.consented_at, before.consent_ip)  # evidence is never rewritten


def test_completed_sessions_are_final(client, started_session):
    token, session_id = started_session["public_token"], started_session["id"]
    assert client.post(f"/api/public/sessions/{token}/finish").status_code == 204
    ended_at = get_session(session_id).ended_at
    assert client.post(f"/api/public/sessions/{token}/finish").status_code == 204  # idempotent...
    assert get_session(session_id).ended_at == ended_at  # ...and never overwrites the end time
    assert client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True}).status_code == 409
    assert client.post(f"/api/public/sessions/{token}/start").status_code == 409
    assert client.post(f"/api/public/sessions/{token}/events", json=event_payload()).status_code == 409
    assert get_session(session_id).status == "completed"


def test_cannot_finish_a_session_that_never_started(client, hr, new_session):
    token = new_session(hr)["public_token"]
    assert client.post(f"/api/public/sessions/{token}/finish").status_code == 409
    client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True})
    assert client.post(f"/api/public/sessions/{token}/finish").status_code == 409


def test_unstarted_link_expires(client, hr, new_session):
    data = new_session(hr)
    token = data["public_token"]
    set_session(data["id"], expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    assert client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True}).status_code == 410
    assert get_session(data["id"]).status == "expired"
    assert client.post(f"/api/public/sessions/{token}/start").status_code == 410


def test_running_call_keeps_recording_after_the_link_expiry_time(client, started_session):
    token, session_id = started_session["public_token"], started_session["id"]
    set_session(session_id, expires_at=datetime.now(timezone.utc) - timedelta(minutes=5))
    assert client.post(f"/api/public/sessions/{token}/events", json=event_payload()).status_code == 201
    assert get_session(session_id).status == "in_progress"
    assert client.post(f"/api/public/sessions/{token}/finish").status_code == 204
    assert get_session(session_id).status == "completed"


def test_candidate_payload_never_exposes_the_test_link_or_answers(client, hr, new_session):
    test = make_test(client, hr)
    data = new_session(hr, test_id=test["id"])
    payload = client.get(f"/api/public/sessions/{data['public_token']}").json()
    assert payload["test"]["title"] == "Python basics" and len(payload["test"]["questions"]) == 2
    assert "public_token" not in payload["test"] and test["public_token"] not in str(payload)
    assert all("correct_option_index" not in question for question in payload["test"]["questions"])


def test_session_test_submission_is_graded_once(client, hr, new_session):
    test = make_test(client, hr)
    data = new_session(hr, test_id=test["id"])
    token = data["public_token"]
    questions = client.get(f"/api/public/sessions/{token}").json()["test"]["questions"]
    body = {"answers": {questions[0]["id"]: 1, questions[1]["id"]: "because"}}
    assert client.post(f"/api/public/sessions/{token}/test-submission", json=body).status_code == 409  # not started
    client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True})
    client.post(f"/api/public/sessions/{token}/start")
    submitted = client.post(f"/api/public/sessions/{token}/test-submission", json=body)
    assert submitted.status_code == 201 and (submitted.json()["score"], submitted.json()["total"]) == (1, 1)
    assert client.post(f"/api/public/sessions/{token}/test-submission", json=body).status_code == 409
    assert client.get(f"/api/sessions/{data['id']}", headers=hr).json()["test_submission"]["score"] == 1


def test_oversized_event_metadata_is_rejected(client, started_session):
    token = started_session["public_token"]
    assert client.post(f"/api/public/sessions/{token}/events", json=event_payload(metadata={"blob": "x" * 5000})).status_code == 422
    assert client.post(f"/api/public/sessions/{token}/events", json=event_payload(metadata={f"k{i}": i for i in range(31)})).status_code == 422
    assert client.post(f"/api/public/sessions/{token}/events", json=event_payload(duration_seconds=10**9)).status_code == 422


def test_event_count_per_session_is_capped(client, started_session, monkeypatch):
    monkeypatch.setattr(public, "MAX_EVENTS_PER_SESSION", 3)
    token = started_session["public_token"]
    codes = [client.post(f"/api/public/sessions/{token}/events", json=event_payload()).status_code for _ in range(5)]
    assert codes == [201, 201, 201, 429, 429]


def test_event_flood_is_rate_limited(client, started_session, settings, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    token = started_session["public_token"]
    codes = [client.post(f"/api/public/sessions/{token}/events", json=event_payload(metadata={})).status_code for _ in range(122)]
    assert codes.count(201) == 120 and codes[-1] == 429


def test_analyze_frame_validates_uploads(client, started_session, monkeypatch):
    token = started_session["public_token"]
    monkeypatch.setattr(public, "detect_objects", lambda content: {"person_count": 1, "vision_available": True})
    url = f"/api/public/sessions/{token}/analyze-frame"
    assert client.post(url, files={"frame": ("f.jpg", b"123", "image/jpeg")}).json() == {"person_count": 1, "vision_available": True}
    assert client.post(url, files={"frame": ("f.txt", b"123", "text/plain")}).status_code == 415
    assert client.post(url, files={"frame": ("f.jpg", b"0" * 2_500_001, "image/jpeg")}).status_code == 413
    assert client.post(f"/api/public/sessions/{'6f9619ff-8b86-d011-b42d-00c04fc964ff'}/analyze-frame", files={"frame": ("f.jpg", b"1", "image/jpeg")}).status_code == 404


def test_analyze_frame_is_rate_limited(client, started_session, settings, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(public, "detect_objects", lambda content: {"vision_available": True})
    url = f"/api/public/sessions/{started_session['public_token']}/analyze-frame"
    codes = [client.post(url, files={"frame": ("f.jpg", b"1", "image/jpeg")}).status_code for _ in range(32)]
    assert codes.count(200) == 30 and codes[-1] == 429


def test_public_form_link_collects_standalone_submission(client, hr):
    created = make_test(
        client,
        hr,
        title="Event signup",
        description="Kush merr pjese sot?",
        form_mode=True,
        questions=[
            {"question_type": "short_text", "prompt": "Emri i ekipit", "options": [], "correct_option_index": None},
            {"question_type": "multiple_choice", "prompt": "A merr pjese?", "options": ["Po", "Jo", "Ndoshta"], "correct_option_index": None},
        ],
    )
    public_test = client.get(f"/api/public/tests/{created['public_token']}")
    assert public_test.status_code == 200
    questions = public_test.json()["questions"]
    answers = {questions[0]["id"]: "Frontend team", questions[1]["id"]: 0}

    submitted = client.post(f"/api/public/tests/{created['public_token']}/submissions", json={"participant_name": "Ardi", "participant_email": "Ardi@example.com", "answers": answers})
    assert submitted.status_code == 201 and submitted.json()["total"] == 0 and submitted.json()["participant_email"] == "ardi@example.com"
    duplicate = client.post(f"/api/public/tests/{created['public_token']}/submissions", json={"participant_email": "ardi@example.com", "answers": answers})
    assert duplicate.status_code == 409
    assert client.post(f"/api/public/tests/{created['public_token']}/submissions", json={"participant_email": "someone@else.com", "answers": answers}).status_code == 201

    detail = client.get(f"/api/tests/{created['id']}", headers=hr).json()
    assert len(detail["standalone_submissions"]) == 2
    assert {item["participant_name"] for item in detail["standalone_submissions"]} == {"Ardi", None}


def test_closed_or_malformed_public_tests_are_404(client, hr):
    created = make_test(client, hr, is_public=False)
    assert client.get(f"/api/public/tests/{created['public_token']}").status_code == 404
    assert client.get("/api/public/tests/garbage").status_code == 404
    assert client.post("/api/public/tests/garbage/submissions", json={"answers": {}}).status_code == 404


def test_public_test_submissions_are_limited(client, hr, settings, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    created = make_test(client, hr)
    url = f"/api/public/tests/{created['public_token']}/submissions"
    codes = [client.post(url, json={"answers": {}}).status_code for _ in range(12)]
    assert codes.count(201) == 10 and codes[-1] == 429
    assert client.post(url, json={"answers": {f"q{i}": 1 for i in range(201)}}).status_code in (422, 429)


@pytest.mark.parametrize("answer", [{"a": 1}, [1], "x" * 6000])
def test_invalid_answers_are_rejected(client, hr, answer):
    created = make_test(client, hr)
    questions = client.get(f"/api/public/tests/{created['public_token']}").json()["questions"]
    question_id = questions[0]["id"] if not isinstance(answer, str) else questions[1]["id"]
    assert client.post(f"/api/public/tests/{created['public_token']}/submissions", json={"answers": {question_id: answer}}).status_code == 422
