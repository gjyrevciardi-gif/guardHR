from datetime import datetime, timedelta, timezone

from app.database import SessionLocal
from app.models import AuditLog, Candidate, IntegrityEvent, InterviewSession, TestSubmission
from helpers import event_payload, make_test


def test_complete_hr_and_candidate_flow(client, hr, new_session, sent_invites):
    data = new_session(hr, require_screen_share=True)
    token, session_id = data["public_token"], data["id"]
    assert data["invite_email_queued"] is True and sent_invites == [token]

    assert client.post(f"/api/public/sessions/{token}/start").status_code == 403
    assert client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True}).status_code == 200
    assert client.post(f"/api/public/sessions/{token}/start").status_code == 204
    assert client.post(f"/api/public/sessions/{token}/events", json=event_payload()).status_code == 201
    assert client.post(f"/api/public/sessions/{token}/finish").status_code == 204

    detail = client.get(f"/api/sessions/{session_id}", headers=hr)
    assert detail.status_code == 200
    assert detail.json()["review_status"] == "Requires review"
    assert detail.json()["status"] == "completed"
    assert len(detail.json()["events"]) == 1
    assert detail.json()["events"][0]["metadata"] == {"source": "browser"}
    assert detail.json()["events"][0]["duration_seconds"] == 1.5

    review = client.post(f"/api/sessions/{session_id}/reviews", headers=hr, json={"outcome": "Insufficient evidence", "notes": "The tab switch was explained by a system notification."})
    assert review.status_code == 200
    assert client.get(f"/api/sessions/{session_id}", headers=hr).json()["review_status"] == "Insufficient evidence"
    actions = {entry["action"] for entry in client.get("/api/audit-logs", headers=hr).json()}
    assert {"session.created", "participant.invite.email_sent", "review.saved", "session.viewed"} <= actions


def test_review_outcome_is_restricted(client, hr, new_session):
    session_id = new_session(hr)["id"]
    assert client.post(f"/api/sessions/{session_id}/reviews", headers=hr, json={"outcome": "Requires review", "notes": "not allowed"}).status_code == 422


def test_failed_invite_is_audited_without_leaking_the_error(client, hr, new_session, monkeypatch):
    def broken(_session):
        raise OSError("smtp.internal.example:25 refused connection")

    monkeypatch.setattr("app.email.send_candidate_invite", broken)
    data = new_session(hr)
    assert "smtp" not in str(data)
    entries = client.get("/api/audit-logs", headers=hr).json()
    failed = [entry for entry in entries if entry["action"] == "participant.invite.email_failed"]
    assert len(failed) == 1 and "smtp" not in str(failed[0]["details"])
    assert "participant_link" not in str(entries)  # the secret join link must not be stored in audit details


def test_session_creation_validation(client, hr, new_session):
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    payload = {"title": "Interview", "candidate_name": "Ada", "candidate_email": "ada@example.com", "expires_at": past}
    assert client.post("/api/sessions", headers=hr, json=payload).status_code == 422
    naive_future = (datetime.now() + timedelta(days=1)).replace(tzinfo=None).isoformat()
    assert client.post("/api/sessions", headers=hr, json=payload | {"expires_at": naive_future}).status_code == 201
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    assert client.post("/api/sessions", headers=hr, json=payload | {"expires_at": future, "test_id": "not-a-uuid"}).status_code == 404
    assert client.post("/api/sessions", json=payload | {"expires_at": future}).status_code == 401


def test_sessions_are_private_to_their_owner(client, hr, other_hr, new_session):
    session_id = new_session(hr)["id"]
    assert client.get(f"/api/sessions/{session_id}", headers=other_hr).status_code == 404
    assert client.delete(f"/api/sessions/{session_id}", headers=other_hr).status_code == 404
    assert client.post(f"/api/sessions/{session_id}/reviews", headers=other_hr, json={"outcome": "Review completed", "notes": "nope"}).status_code == 404
    assert client.get("/api/sessions", headers=other_hr).json() == []
    assert client.get("/api/sessions/not-a-uuid", headers=hr).status_code == 404


def test_tests_are_private_to_their_owner(client, hr, other_hr, new_session):
    test = make_test(client, hr)
    assert client.get(f"/api/tests/{test['id']}", headers=other_hr).status_code == 404
    assert client.delete(f"/api/tests/{test['id']}", headers=other_hr).status_code == 404
    assert client.get("/api/tests", headers=other_hr).json() == []
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    body = {"title": "Interview", "candidate_name": "Ada", "candidate_email": "ada@example.com", "expires_at": future, "test_id": test["id"]}
    assert client.post("/api/sessions", headers=other_hr, json=body).status_code == 404


def test_candidates_are_not_shared_between_hr_users(client, hr, other_hr, new_session):
    first = new_session(hr, candidate_name="Ada Lovelace")
    second = new_session(other_hr, candidate_name="Totally Different Name")
    assert client.get(f"/api/sessions/{first['id']}", headers=hr).json()["candidate"]["full_name"] == "Ada Lovelace"
    assert first["candidate"]["id"] != second["candidate"]["id"]
    again = new_session(hr, candidate_name="Ada L.")  # same HR user reuses their own record
    assert again["candidate"]["id"] == first["candidate"]["id"]
    with SessionLocal() as db:
        assert db.query(Candidate).count() == 2


def test_list_uses_counts_and_pagination(client, hr, new_session, started_session):
    test = make_test(client, hr)
    with_test = new_session(hr, candidate_email="b@example.com", test_id=test["id"])
    new_session(hr, candidate_email="c@example.com")
    client.post(f"/api/public/sessions/{started_session['public_token']}/events", json=event_payload())
    client.post(f"/api/public/sessions/{started_session['public_token']}/events", json=event_payload(event_type="copy_paste"))

    everything = client.get("/api/sessions", headers=hr).json()
    assert len(everything) == 3
    by_id = {item["id"]: item for item in everything}
    assert by_id[started_session["id"]]["event_count"] == 2 and by_id[started_session["id"]]["events"] == []
    assert by_id[with_test["id"]]["test"]["question_count"] == 2 and by_id[with_test["id"]]["test"]["questions"] == []

    page_one = client.get("/api/sessions?limit=2&offset=0", headers=hr).json()
    page_two = client.get("/api/sessions?limit=2&offset=2", headers=hr).json()
    assert [len(page_one), len(page_two)] == [2, 1]
    assert {item["id"] for item in page_one + page_two} == set(by_id)
    assert client.get("/api/sessions?limit=0", headers=hr).status_code == 422

    tests = client.get("/api/tests", headers=hr).json()
    assert tests[0]["question_count"] == 2 and tests[0]["questions"] == []
    assert len(client.get("/api/audit-logs?limit=1", headers=hr).json()) == 1


def test_deleting_a_session_removes_everything_attached(client, hr, new_session, started_session):
    token, session_id = started_session["public_token"], started_session["id"]
    test = make_test(client, hr)
    other = new_session(hr, candidate_email="ada@example.com", test_id=test["id"])  # same candidate record, second session
    client.post(f"/api/public/sessions/{token}/events", json=event_payload())
    client.post(f"/api/sessions/{session_id}/reviews", headers=hr, json={"outcome": "Review completed", "notes": "looked fine"})

    assert client.delete(f"/api/sessions/{session_id}", headers=hr).status_code == 204
    assert client.get(f"/api/sessions/{session_id}", headers=hr).status_code == 404
    assert client.get(f"/api/public/sessions/{token}").status_code == 404
    with SessionLocal() as db:
        assert db.query(IntegrityEvent).count() == 0
        assert db.query(Candidate).count() == 1  # still used by the other session
        leftovers = db.query(AuditLog).filter(AuditLog.action.in_(["session.created", "candidate.session.started"])).all()
        assert all(entry.session_id != session_id and entry.ip_address is None for entry in leftovers if entry.entity_id == session_id)
        assert db.query(AuditLog).filter(AuditLog.action == "session.deleted").count() == 1

    assert client.delete(f"/api/sessions/{other['id']}", headers=hr).status_code == 204
    with SessionLocal() as db:
        assert db.query(Candidate).count() == 0  # orphaned candidate PII is removed too


def test_deleting_a_test_keeps_sessions_but_drops_submissions(client, hr, new_session):
    test = make_test(client, hr)
    data = new_session(hr, test_id=test["id"])
    token = data["public_token"]
    client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True})
    client.post(f"/api/public/sessions/{token}/start")
    questions = client.get(f"/api/public/sessions/{token}").json()["test"]["questions"]
    assert client.post(f"/api/public/sessions/{token}/test-submission", json={"answers": {questions[0]["id"]: 1}}).status_code == 201

    assert client.delete(f"/api/tests/{test['id']}", headers=hr).status_code == 204
    assert client.get(f"/api/tests/{test['id']}", headers=hr).status_code == 404
    assert client.get(f"/api/sessions/{data['id']}", headers=hr).json()["test"] is None
    with SessionLocal() as db:
        assert db.query(TestSubmission).count() == 0
        assert db.query(InterviewSession).count() == 1


def view_audit_rows(session_id: str) -> list[AuditLog]:
    with SessionLocal() as db:
        return list(db.query(AuditLog).filter(AuditLog.session_id == session_id, AuditLog.action == "session.viewed"))


def test_polling_a_session_writes_one_view_audit_row_per_hour(client, hr, new_session):
    session_id = new_session(hr)["id"]
    for _ in range(5):
        assert client.get(f"/api/sessions/{session_id}", headers=hr).status_code == 200
    assert len(view_audit_rows(session_id)) == 1

    with SessionLocal() as db:  # pretend the first view was more than an hour ago
        row = db.query(AuditLog).filter(AuditLog.session_id == session_id, AuditLog.action == "session.viewed").one()
        row.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
        db.commit()
    client.get(f"/api/sessions/{session_id}", headers=hr)
    assert len(view_audit_rows(session_id)) == 2


def test_a_non_owner_request_is_not_audited_as_a_view(client, hr, other_hr, new_session):
    session_id = new_session(hr)["id"]
    client.get(f"/api/sessions/{session_id}", headers=hr)
    assert client.get(f"/api/sessions/{session_id}", headers=other_hr).status_code == 404  # not theirs: never audited as a view
    assert len(view_audit_rows(session_id)) == 1


def test_session_detail_reports_the_invite_outcome(client, hr, new_session, monkeypatch):
    sent = new_session(hr)
    assert client.get(f"/api/sessions/{sent['id']}", headers=hr).json()["invite_status"] == "sent"

    def broken(_session):
        raise OSError("refused")

    monkeypatch.setattr("app.email.send_candidate_invite", broken)
    failed = new_session(hr)
    assert client.get(f"/api/sessions/{failed['id']}", headers=hr).json()["invite_status"] == "failed"
    assert all(row["invite_status"] is None for row in client.get("/api/sessions", headers=hr).json())  # list view stays cheap
