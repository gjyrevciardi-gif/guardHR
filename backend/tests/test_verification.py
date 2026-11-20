"""Email one-time code: the call cannot start until the invited mailbox has been proven."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from app import verification
from app.api import signaling
from app.database import SessionLocal
from app.models import AuditLog, InterviewSession


@pytest.fixture
def codes(monkeypatch):
    """Capture the emailed codes instead of talking to SMTP."""
    sent: list[str] = []
    monkeypatch.setattr("app.email.send_verification_code", lambda session, code: sent.append(code))
    return sent


@pytest.fixture
def pending(client, hr, new_session):
    """A consented call whose host asked for email verification."""
    data = new_session(hr, verify_candidate_email=True)
    token = data["public_token"]
    assert client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True}).status_code == 200
    return data


def url(data: dict, tail: str = "") -> str:
    return f"/api/public/sessions/{data['public_token']}{tail}"


def edit_session(data: dict, **changes) -> None:
    with SessionLocal() as db:
        session = db.get(InterviewSession, data["id"])
        for key, value in changes.items():
            setattr(session, key, value)
        db.commit()


def read_session(data: dict) -> InterviewSession:
    with SessionLocal() as db:
        session = db.get(InterviewSession, data["id"])
        db.expunge(session)
        return session


def audit_actions(data: dict) -> list[str]:
    with SessionLocal() as db:
        return list(db.scalars(select(AuditLog.action).where(AuditLog.session_id == data["id"]).order_by(AuditLog.created_at)))


def test_call_cannot_start_until_the_code_is_entered(client, pending, codes):
    assert client.post(url(pending, "/start")).status_code == 403
    assert client.post(url(pending, "/verification")).status_code == 200
    assert len(codes) == 1 and len(codes[0]) == 6 and codes[0].isdigit()
    assert client.post(url(pending, "/start")).status_code == 403  # asking for a code is not enough
    confirmed = client.post(url(pending, "/verification/confirm"), json={"code": codes[0]})
    assert confirmed.status_code == 200
    assert client.post(url(pending, "/start")).status_code == 204


def test_unverified_link_holder_cannot_reach_the_call_through_other_doors(client, pending, codes):
    assert client.post(url(pending, "/heartbeat"), json={"face_detection": True}).status_code == 409
    assert client.post(url(pending, "/events"), json={"event_type": "tab_hidden", "started_at": datetime.now(timezone.utc).isoformat()}).status_code == 409
    with pytest.raises(WebSocketDisconnect) as caught:  # the signaling socket also requires an in-progress call
        with client.websocket_connect(f"/api/ws/rooms/{pending['public_token']}?role=candidate") as socket:
            socket.receive_json()
    assert caught.value.code == signaling.CONFLICT


def test_calls_without_the_option_start_as_before(client, hr, new_session, codes):
    data = new_session(hr)
    assert data["verify_candidate_email"] is False
    assert client.post(url(data, "/consent"), json={"accepted": True}).json()["verification_required"] is False
    assert client.post(url(data, "/verification")).status_code == 409
    assert client.post(url(data, "/start")).status_code == 204
    assert codes == []


def test_public_view_masks_the_address_until_verified_then_drops_it(client, pending, codes):
    before = client.get(url(pending)).json()
    assert before["verification_required"] is True
    assert before["candidate_email_hint"] == "a**@example.com"
    assert "ada@example.com" not in str(before)
    client.post(url(pending, "/verification"))
    after = client.post(url(pending, "/verification/confirm"), json={"code": codes[0]}).json()
    assert after["verification_required"] is False and after["candidate_email_hint"] is None


def test_host_sees_whether_the_candidate_was_verified(client, hr, pending, codes):
    shown = client.get(f"/api/sessions/{pending['id']}", headers=hr).json()
    assert shown["verify_candidate_email"] is True and shown["verified_at"] is None
    client.post(url(pending, "/verification"))
    client.post(url(pending, "/verification/confirm"), json={"code": codes[0]})
    assert client.get(f"/api/sessions/{pending['id']}", headers=hr).json()["verified_at"] is not None


def test_consent_comes_first(client, hr, new_session, codes):
    data = new_session(hr, verify_candidate_email=True)
    assert client.post(url(data, "/verification")).status_code == 403
    assert codes == []


def test_code_is_stored_only_as_a_keyed_hash(client, pending, codes):
    client.post(url(pending, "/verification"))
    stored = read_session(pending)
    assert stored.verification_code_hash and stored.verification_code_hash != codes[0]
    assert len(stored.verification_code_hash) == 64
    with SessionLocal() as db:
        assert codes[0] not in str([row.details for row in db.scalars(select(AuditLog))])


def test_wrong_codes_are_counted_and_lock_the_code(client, pending, codes):
    client.post(url(pending, "/verification"))
    wrong = "000000" if codes[0] != "000000" else "111111"
    for _ in range(verification.MAX_ATTEMPTS - 1):
        assert client.post(url(pending, "/verification/confirm"), json={"code": wrong}).status_code == 422
    last = client.post(url(pending, "/verification/confirm"), json={"code": wrong})
    assert last.status_code == 429
    # even the right code is refused once the attempts are used up
    assert client.post(url(pending, "/verification/confirm"), json={"code": codes[0]}).status_code == 429
    assert client.post(url(pending, "/start")).status_code == 403
    assert "candidate.verification.locked" in audit_actions(pending)


def test_a_new_code_replaces_the_old_one_and_resets_the_attempts(client, pending, codes):
    client.post(url(pending, "/verification"))
    first = codes[0]
    wrong = "000000" if first != "000000" else "111111"
    for _ in range(verification.MAX_ATTEMPTS):
        client.post(url(pending, "/verification/confirm"), json={"code": wrong})
    edit_session(pending, verification_sent_at=datetime.now(timezone.utc) - timedelta(seconds=verification.RESEND_COOLDOWN_SECONDS + 1))
    assert client.post(url(pending, "/verification")).status_code == 200
    second = codes[1]
    assert read_session(pending).verification_attempts == 0
    if second != first:  # the old code no longer works
        assert client.post(url(pending, "/verification/confirm"), json={"code": first}).status_code == 422
    assert client.post(url(pending, "/verification/confirm"), json={"code": second}).status_code == 200


def test_codes_expire(client, pending, codes):
    client.post(url(pending, "/verification"))
    edit_session(pending, verification_sent_at=datetime.now(timezone.utc) - timedelta(seconds=verification.CODE_TTL_SECONDS + 5))
    assert client.post(url(pending, "/verification/confirm"), json={"code": codes[0]}).status_code == 410
    assert client.post(url(pending, "/start")).status_code == 403


def test_resend_has_a_cooldown_and_a_lifetime_cap(client, pending, codes):
    assert client.post(url(pending, "/verification")).status_code == 200
    early = client.post(url(pending, "/verification"))
    assert early.status_code == 429 and int(early.headers["Retry-After"]) > 0
    assert len(codes) == 1
    edit_session(pending, verification_sent_at=None, verification_sends=verification.MAX_SENDS)
    assert client.post(url(pending, "/verification")).status_code == 429
    assert len(codes) == 1


def test_confirm_without_a_request_and_with_a_malformed_code(client, pending, codes):
    assert client.post(url(pending, "/verification/confirm"), json={"code": "123456"}).status_code == 409
    for bad in ("12345", "1234567", "12a456", "１２３４５６"):  # the last one is full-width digits
        assert client.post(url(pending, "/verification/confirm"), json={"code": bad}).status_code == 422


def test_email_failure_is_reported_audited_and_does_not_lock_the_candidate_out(client, pending, monkeypatch, codes):
    def broken(session, code):
        raise OSError("smtp.internal.example:25 refused connection")

    monkeypatch.setattr("app.email.send_verification_code", broken)
    failed = client.post(url(pending, "/verification"))
    assert failed.status_code == 502 and "smtp" not in failed.text
    stored = read_session(pending)
    assert stored.verification_code_hash is None and stored.verification_sent_at is None
    assert "candidate.verification.code_failed" in audit_actions(pending)
    monkeypatch.setattr("app.email.send_verification_code", lambda session, code: codes.append(code))
    assert client.post(url(pending, "/verification")).status_code == 200  # no cooldown after a failed delivery


def test_verification_is_idempotent_and_single_use(client, pending, codes):
    client.post(url(pending, "/verification"))
    assert client.post(url(pending, "/verification/confirm"), json={"code": codes[0]}).status_code == 200
    when = read_session(pending).verified_at
    assert client.post(url(pending, "/verification/confirm"), json={"code": "000000"}).status_code == 200  # replay changes nothing
    assert read_session(pending).verified_at == when
    assert read_session(pending).verification_code_hash is None
    assert client.post(url(pending, "/verification")).status_code == 409  # nothing more to send


def test_a_code_only_works_for_the_call_it_was_issued_for(client, hr, pending, new_session, codes):
    other = new_session(hr, verify_candidate_email=True, candidate_email="grace@example.com", candidate_name="Grace Hopper")
    client.post(url(other, "/consent"), json={"accepted": True})
    client.post(url(pending, "/verification"))
    client.post(url(other, "/verification"))
    mine, theirs = codes
    if mine != theirs:
        assert client.post(url(other, "/verification/confirm"), json={"code": mine}).status_code == 422
    assert verification.hash_code(pending["id"], mine) != verification.hash_code(other["id"], mine)


def test_the_flow_is_audited(client, pending, codes):
    client.post(url(pending, "/verification"))
    client.post(url(pending, "/verification/confirm"), json={"code": codes[0]})
    actions = audit_actions(pending)
    assert "candidate.verification.code_sent" in actions and "candidate.verification.succeeded" in actions


def test_masking_hides_most_of_the_address():
    assert verification.mask_email("ada@example.com") == "a**@example.com"
    assert verification.mask_email("a@example.com") == "a**@example.com"  # a one-letter name still shows no more than itself
    assert verification.mask_email("long.address@example.com") == "l***********@example.com"
