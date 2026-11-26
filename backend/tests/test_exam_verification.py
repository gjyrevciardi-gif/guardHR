"""A public exam that checks email: the questions are handed out only to someone who read the mailbox they gave."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app import verification
from app.database import SessionLocal
from app.models import AuditLog, ExamAttempt, ExamEmailCode, TestSubmission
from helpers import make_test

EMAIL = "Ardi@Example.com"  # mixed case on purpose: the address is stored and matched in lower case


@pytest.fixture
def codes(monkeypatch):
    """Capture the emailed codes as (address, code) instead of talking to SMTP."""
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr("app.email.send_exam_code", lambda email, title, code: sent.append((email, code)))
    return sent


@pytest.fixture
def exam(client, hr):
    return make_test(client, hr, verify_candidate_email=True)


def url(created: dict, path: str = "") -> str:
    return f"/api/public/tests/{created['public_token']}{path}"


def ask(client, created: dict, email: str = EMAIL):
    return client.post(url(created, "/verification"), json={"participant_email": email})


def confirm(client, created: dict, code: str, email: str = EMAIL, name: str = "Ardi"):
    return client.post(url(created, "/verification/confirm"), json={"participant_name": name, "participant_email": email, "code": code})


def wrong(code: str) -> str:
    return "000000" if code != "000000" else "111111"


def edit_code_row(**changes) -> None:
    with SessionLocal() as db:
        row = db.scalar(select(ExamEmailCode))
        for key, value in changes.items():
            setattr(row, key, value)
        db.commit()


def sent_minutes_ago(minutes: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


# --- the gate -----------------------------------------------------------------------------------------------------


def test_the_questions_are_not_handed_out_without_the_code(client, exam, codes):
    started = client.post(url(exam, "/start"), json={"participant_name": "Ardi", "participant_email": EMAIL})
    assert started.status_code == 403 and "questions" not in started.json()
    assert ask(client, exam).status_code == 200
    assert client.post(url(exam, "/start"), json={"participant_name": "Ardi", "participant_email": EMAIL}).status_code == 403  # asking for a code is not enough
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ExamAttempt.id))) == 0  # no attempt, so no clock, until the code is right


def test_the_right_code_starts_the_exam_and_marks_the_attempt_verified(client, hr, exam, codes):
    assert client.get(url(exam)).json()["verify_candidate_email"] is True  # the page needs to know which flow to show
    sent = ask(client, exam)
    assert sent.status_code == 200 and sent.json() == {"expires_in_seconds": verification.CODE_TTL_SECONDS, "resend_after_seconds": verification.RESEND_COOLDOWN_SECONDS}
    (address, code), = codes
    assert address == "ardi@example.com" and len(code) == 6 and code.isdigit()

    started = confirm(client, exam, code)
    assert started.status_code == 200, started.text
    body = started.json()
    assert len(body["questions"]) == 2 and body["participant_name"] == "Ardi" and "correct_option_index" not in body["questions"][0]

    unfinished = client.get(f"/api/tests/{exam['id']}", headers=hr).json()["unfinished_attempts"]
    assert len(unfinished) == 1 and unfinished[0]["email_verified_at"] is not None

    submitted = client.post(url(exam, "/submissions"), json={"attempt": body["attempt"], "answers": {}})
    assert submitted.status_code == 201
    detail = client.get(f"/api/tests/{exam['id']}", headers=hr).json()
    assert detail["standalone_submissions"][0]["email_verified_at"] is not None
    assert detail["unfinished_attempts"] == []


def test_a_wrong_code_is_refused_and_five_of_them_lock_the_code(client, exam, codes):
    ask(client, exam)
    code = codes[0][1]
    for _ in range(verification.MAX_ATTEMPTS - 1):
        assert confirm(client, exam, wrong(code)).status_code == 422
    assert confirm(client, exam, wrong(code)).status_code == 429  # the fifth wrong guess
    assert confirm(client, exam, code).status_code == 429  # even the right code is now useless
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ExamAttempt.id))) == 0
        assert "public_test.code_locked" in set(db.scalars(select(AuditLog.action)))
    # a new code, once the cooldown has passed, starts clean
    edit_code_row(verification_sent_at=sent_minutes_ago(1))
    ask(client, exam)
    assert confirm(client, exam, codes[1][1]).status_code == 200


def test_a_code_works_once(client, exam, codes):
    ask(client, exam)
    code = codes[0][1]
    assert confirm(client, exam, code).status_code == 200
    again = confirm(client, exam, code)
    assert again.status_code == 409  # single use: it cannot be replayed to pick the attempt up later
    with SessionLocal() as db:
        assert db.scalar(select(ExamEmailCode.verification_code_hash)) is None


def test_a_code_expires(client, exam, codes):
    ask(client, exam)
    edit_code_row(verification_sent_at=sent_minutes_ago(verification.CODE_TTL_SECONDS / 60 + 1))
    assert confirm(client, exam, codes[0][1]).status_code == 410


def test_a_code_for_one_address_does_not_start_another(client, exam, codes):
    ask(client, exam)
    code = codes[0][1]
    assert confirm(client, exam, code, email="someone-else@example.com").status_code == 409
    assert confirm(client, exam, code, email="ardi@example.com").status_code == 200


def test_the_code_is_never_stored_or_audited_in_clear(client, exam, codes):
    ask(client, exam)
    code = codes[0][1]
    confirm(client, exam, code)
    with SessionLocal() as db:
        row = db.scalar(select(ExamEmailCode))
        assert row.email == "ardi@example.com" and row.verification_code_hash is None
        details = " ".join(str(d) for d in db.scalars(select(AuditLog.details)))
        assert code not in details and "ardi@example.com" not in details
        assert {"public_test.code_sent", "public_test.code_verified"} <= set(db.scalars(select(AuditLog.action)))
    edit_code_row(verification_sent_at=sent_minutes_ago(1))
    ask(client, exam)
    with SessionLocal() as db:
        stored = db.scalar(select(ExamEmailCode.verification_code_hash))
        assert stored and stored != codes[-1][1] and len(stored) == 64


# --- coming back --------------------------------------------------------------------------------------------------


def test_a_new_code_picks_the_same_attempt_up_again(client, exam, codes):
    ask(client, exam)
    first = confirm(client, exam, codes[0][1]).json()
    edit_code_row(verification_sent_at=sent_minutes_ago(1))
    ask(client, exam)
    second = confirm(client, exam, codes[1][1], name="Somebody else")
    assert second.status_code == 200
    assert second.json()["attempt"] == first["attempt"] and second.json()["started_at"] == first["started_at"]
    assert second.json()["participant_name"] == "Ardi"  # the name given at the first start stands
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ExamAttempt.id))) == 1


def test_an_email_that_already_submitted_gets_no_code(client, exam, codes):
    ask(client, exam)
    started = confirm(client, exam, codes[0][1]).json()
    client.post(url(exam, "/submissions"), json={"attempt": started["attempt"], "answers": {}})
    assert ask(client, exam).status_code == 409
    assert len(codes) == 1  # nothing was emailed


# --- sending ------------------------------------------------------------------------------------------------------


def test_codes_cannot_be_asked_for_again_straight_away(client, exam, codes):
    assert ask(client, exam).status_code == 200
    again = ask(client, exam)
    assert again.status_code == 429 and "Retry-After" in again.headers
    assert len(codes) == 1


def test_a_delivery_failure_is_reported_and_does_not_start_the_cooldown(client, exam, monkeypatch):
    def refuse(email, title, code):
        raise OSError("relay down")

    monkeypatch.setattr("app.email.send_exam_code", refuse)
    assert ask(client, exam).status_code == 502
    sent: list[str] = []
    monkeypatch.setattr("app.email.send_exam_code", lambda email, title, code: sent.append(code))
    assert ask(client, exam).status_code == 200  # no wait: nothing had arrived
    with SessionLocal() as db:
        assert "public_test.code_failed" in set(db.scalars(select(AuditLog.action)))


def test_codes_per_address_are_capped_per_hour_not_for_good(client, exam, codes):
    ask(client, exam)
    edit_code_row(verification_sends=verification.MAX_SENDS, verification_sent_at=sent_minutes_ago(1))
    assert ask(client, exam).status_code == 429  # ten codes this hour
    edit_code_row(verification_sent_at=sent_minutes_ago(verification.EXAM_SENDS_WINDOW_SECONDS / 60 + 1))
    assert ask(client, exam).status_code == 200  # an hour on, the address is not locked out for good


def test_asking_for_a_code_needs_a_well_formed_email(client, exam, codes):
    assert ask(client, exam, email="not-an-email").status_code == 422
    assert confirm(client, exam, "12345").status_code == 422  # six digits
    assert codes == []


# --- which tests it applies to ------------------------------------------------------------------------------------


def test_a_test_that_does_not_check_email_has_no_code_flow(client, hr, codes):
    plain = make_test(client, hr)
    assert plain["verify_candidate_email"] is False
    assert ask(client, plain).status_code == 409
    assert confirm(client, plain, "123456").status_code == 409
    assert client.post(url(plain, "/start"), json={"participant_name": "Ardi", "participant_email": EMAIL}).status_code == 200  # unchanged


def test_a_plain_form_never_checks_email(client, hr, codes):
    form = make_test(client, hr, form_mode=True, verify_candidate_email=True)
    assert form["verify_candidate_email"] is False  # saved off: a form has no exam to protect
    assert ask(client, form).status_code == 400


def test_the_option_can_be_turned_on_and_off_in_the_editor(client, hr):
    created = make_test(client, hr)
    detail = client.get(f"/api/tests/{created['id']}", headers=hr).json()
    questions = [{k: q[k] for k in ("id", "question_type", "prompt", "options", "correct_option_index")} for q in detail["questions"]]
    base = {"title": "Python basics", "description": None, "form_mode": False, "is_public": True, "questions": questions}
    on = client.put(f"/api/tests/{created['id']}", headers=hr, json=base | {"verify_candidate_email": True}).json()
    assert on["verify_candidate_email"] is True
    off = client.put(f"/api/tests/{created['id']}", headers=hr, json=base).json()
    assert off["verify_candidate_email"] is False  # leaving it out means off, like the other exam options


def test_an_unknown_link_gets_nothing(client, codes):
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.post(f"/api/public/tests/{missing}/verification", json={"participant_email": EMAIL}).status_code == 404
    assert codes == []


# --- retention and deletion ---------------------------------------------------------------------------------------


def test_old_code_rows_are_purged_and_recent_ones_stay(client, hr, exam, codes):
    ask(client, exam)
    assert client.post("/api/settings/retention/purge", headers=hr).status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ExamEmailCode.id))) == 1
    edit_code_row(verification_sent_at=datetime.now(timezone.utc) - timedelta(days=90))
    client.post("/api/settings/retention/purge", headers=hr)
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ExamEmailCode.id))) == 0


def test_the_verified_time_outlives_the_purge_on_the_submission(client, hr, exam, codes):
    ask(client, exam)
    started = confirm(client, exam, codes[0][1]).json()
    client.post(url(exam, "/submissions"), json={"attempt": started["attempt"], "answers": {}})
    edit_code_row(verification_sent_at=datetime.now(timezone.utc) - timedelta(days=90))
    with SessionLocal() as db:
        for attempt in db.scalars(select(ExamAttempt)):
            attempt.started_at = datetime.now(timezone.utc) - timedelta(days=90)
        db.commit()
    client.post("/api/settings/retention/purge", headers=hr)
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ExamAttempt.id))) == 0 and db.scalar(select(func.count(ExamEmailCode.id))) == 0
        assert db.scalar(select(TestSubmission.email_verified_at)) is not None


def test_deleting_the_test_deletes_its_code_rows(client, hr, exam, codes):
    ask(client, exam)
    assert client.delete(f"/api/tests/{exam['id']}", headers=hr).status_code in (200, 204)
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ExamEmailCode.id))) == 0
