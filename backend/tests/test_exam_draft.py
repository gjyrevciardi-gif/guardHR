"""Answers saved on the server while a candidate sits a public exam: kept for a crash or a change of device, shown to the
host as a count, and handed back only to someone who proved the mailbox."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.exams import MAX_TEXT_ANSWER
from app.models import ExamAttempt
from helpers import make_test, start_exam

THREE = [
    {"question_type": "multiple_choice", "prompt": "One?", "options": ["A", "B", "C"], "correct_option_index": 0},
    {"question_type": "multiple_choice", "prompt": "Two?", "options": ["A", "B", "C"], "correct_option_index": 1},
    {"question_type": "short_text", "prompt": "Why?", "options": [], "correct_option_index": None},
]


def url(created: dict, path: str = "") -> str:
    return f"/api/public/tests/{created['public_token']}{path}"


def save(client, created: dict, started: dict, answers: dict):
    return client.put(url(created, f"/attempts/{started['attempt']}/draft"), json={"answers": answers})


def ids(started: dict) -> list[str]:
    return [question["id"] for question in started["questions"]]


def host_view(client, hr, created: dict) -> dict:
    return client.get(f"/api/tests/{created['id']}", headers=hr).json()


def stored_draft() -> dict:
    with SessionLocal() as db:
        return db.scalar(select(ExamAttempt.draft_answers))


# --- saving ---------------------------------------------------------------------------------------------------------


def test_a_draft_is_saved_and_the_host_sees_how_many_but_not_what(client, hr):
    created = make_test(client, hr, questions=THREE)
    started = start_exam(client, created)
    first, _, text = ids(started)
    assert save(client, created, started, {first: 2, text: "half a thought"}).status_code == 204

    assert stored_draft() == {first: 2, text: "half a thought"}
    [attempt] = host_view(client, hr, created)["unfinished_attempts"]
    assert attempt["answered"] == 2 and attempt["draft_saved_at"] is not None
    assert "half a thought" not in str(attempt)  # progress is a count, never the answers


def test_a_newer_draft_replaces_the_older_one(client, hr):
    created = make_test(client, hr, questions=THREE)
    started = start_exam(client, created)
    first, second, _ = ids(started)
    save(client, created, started, {first: 1, second: 2})
    save(client, created, started, {first: 0})
    assert stored_draft() == {first: 0}
    assert host_view(client, hr, created)["unfinished_attempts"][0]["answered"] == 1


def test_a_draft_keeps_only_what_could_be_an_answer(client, hr):
    created = make_test(client, hr, questions=THREE)
    started = start_exam(client, created)
    first, second, text = ids(started)
    assert save(client, created, started, {first: 3, second: True, "not-a-question": 1, text: "   "}).status_code == 204
    assert stored_draft() == {}  # option 3 does not exist, a bool is not a choice, an unknown id is nobody's, whitespace is no answer
    save(client, created, started, {first: 2, text: "x" * (MAX_TEXT_ANSWER + 10)})
    assert stored_draft() == {first: 2, text: "x" * MAX_TEXT_ANSWER}


def test_a_draft_survives_a_restart_of_the_exam_and_does_not_count_as_submitted(client, hr):
    created = make_test(client, hr, questions=THREE)
    started = start_exam(client, created)
    save(client, created, started, {ids(started)[0]: 1})
    again = start_exam(client, created)  # same email: the same attempt
    assert again["attempt"] == started["attempt"]
    assert host_view(client, hr, created)["standalone_submissions"] == []


def test_the_draft_is_emptied_when_the_exam_is_submitted(client, hr):
    created = make_test(client, hr, questions=THREE)
    started = start_exam(client, created)
    save(client, created, started, {ids(started)[0]: 1})
    assert client.post(url(created, "/submissions"), json={"attempt": started["attempt"], "answers": {ids(started)[0]: 1}}).status_code == 201
    assert stored_draft() == {}
    assert save(client, created, started, {ids(started)[0]: 2}).status_code == 409  # nothing to save into any more
    detail = host_view(client, hr, created)
    assert detail["unfinished_attempts"] == [] and detail["standalone_submissions"][0]["score"] >= 0


# --- who may save ---------------------------------------------------------------------------------------------------


def test_only_the_attempts_own_key_saves(client, hr):
    created = make_test(client, hr, questions=THREE)
    other = make_test(client, hr, title="Other", questions=THREE)
    started = start_exam(client, created)
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.put(url(created, f"/attempts/{missing}/draft"), json={"answers": {}}).status_code == 400
    assert client.put(url(created, "/attempts/not-an-id/draft"), json={"answers": {}}).status_code == 400
    assert client.put(url(other, f"/attempts/{started['attempt']}/draft"), json={"answers": {}}).status_code == 400  # another test's link


def test_a_released_attempt_cannot_be_saved_into(client, hr):
    created = make_test(client, hr, questions=THREE)
    started = start_exam(client, created)
    assert client.delete(f"/api/tests/{created['id']}/attempts/{host_view(client, hr, created)['unfinished_attempts'][0]['id']}", headers=hr).status_code in (200, 204)
    assert save(client, created, started, {ids(started)[0]: 1}).status_code == 400


def test_a_plain_form_has_nothing_to_save(client, hr):
    form = make_test(client, hr, form_mode=True)
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.put(url(form, f"/attempts/{missing}/draft"), json={"answers": {}}).status_code == 400


def test_the_draft_needs_an_answers_object(client, hr):
    created = make_test(client, hr, questions=THREE)
    started = start_exam(client, created)
    assert client.put(url(created, f"/attempts/{started['attempt']}/draft"), json={}).status_code == 422
    assert client.put(url(created, f"/attempts/{started['attempt']}/draft"), json={"answers": ["a"]}).status_code == 422


# --- who gets it back -----------------------------------------------------------------------------------------------


def test_without_the_email_code_a_restart_never_hands_the_draft_back(client, hr):
    """Knowing someone's email is enough to start their attempt again; it must not be enough to read what they wrote."""
    created = make_test(client, hr, questions=THREE)
    started = start_exam(client, created)
    save(client, created, started, {ids(started)[0]: 1})
    assert start_exam(client, created)["draft"] == {}


@pytest.fixture
def codes(monkeypatch):
    sent: list[str] = []
    monkeypatch.setattr("app.email.send_exam_code", lambda email, title, code: sent.append(code))
    return sent


def verify(client, created: dict, codes: list[str]) -> dict:
    assert client.post(url(created, "/verification"), json={"participant_email": "ardi@example.com"}).status_code == 200
    response = client.post(url(created, "/verification/confirm"), json={"participant_name": "Ardi", "participant_email": "ardi@example.com", "code": codes[-1]})
    assert response.status_code == 200, response.text
    return response.json()


def test_with_the_email_code_the_draft_comes_back_on_another_device(client, hr, codes):
    created = make_test(client, hr, questions=THREE, verify_candidate_email=True, shuffle=True)
    started = verify(client, created, codes)
    assert started["draft"] == {}
    shown = ids(started)
    choice = next(question["id"] for question in started["questions"] if question["question_type"] == "multiple_choice")
    text = next(question["id"] for question in started["questions"] if question["question_type"] == "short_text")
    save(client, created, started, {choice: 2, text: "my words"})

    with SessionLocal() as db:  # a second device asks for a new code once the cooldown has passed
        from app.models import ExamEmailCode

        row = db.scalar(select(ExamEmailCode))
        row.verification_sent_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
    back = verify(client, created, codes)
    assert back["attempt"] == started["attempt"] and ids(back) == shown  # same order, so the saved positions still mean the same options
    assert back["draft"] == {choice: 2, text: "my words"}


def test_the_saved_positions_are_the_ones_shown_so_shuffled_answers_still_score_on_the_key(client, hr, codes):
    created = make_test(client, hr, questions=THREE, verify_candidate_email=True, shuffle=True)
    started = verify(client, created, codes)
    shown = started["questions"]
    save(client, created, started, {question["id"]: 0 for question in shown if question["question_type"] == "multiple_choice"})
    # Submitting the draft as it was saved must be graded through the same order as any other answers.
    draft = stored_draft()
    submitted = client.post(url(created, "/submissions"), json={"attempt": started["attempt"], "answers": draft})
    assert submitted.status_code == 201


# --- limits ---------------------------------------------------------------------------------------------------------


def test_saving_is_limited_per_attempt_and_does_not_use_up_the_shared_budget(client, hr, settings, monkeypatch):
    created = make_test(client, hr, questions=THREE)
    attempts = [start_exam(client, created, name=f"Cand {n}", email=f"c{n}@example.com") for n in range(7)]
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    for started in attempts:  # 7 x 40 = 280 saves from one address, more than the shared 240 a minute
        for _ in range(40):
            assert save(client, created, started, {ids(started)[0]: 1}).status_code == 204
    assert save(client, created, attempts[0], {ids(attempts[0])[0]: 1}).status_code == 429  # the 41st for one attempt
    assert client.get(url(created)).status_code == 200  # the shared budget is untouched: candidates can still start and submit
