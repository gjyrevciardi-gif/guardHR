from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.database import SessionLocal
from app.exams import arrange, make_layout, original_answers, over_limit_seconds, seconds_left
from app.models import ExamAttempt, TestQuestion
from helpers import make_test, start_exam

THREE = [{"question_type": "multiple_choice", "prompt": f"Question {n}", "options": ["A", "B", "C"], "correct_option_index": 0} for n in range(1, 4)]


def url(created: dict, path: str = "") -> str:
    return f"/api/public/tests/{created['public_token']}{path}"


def host_view(client, hr, created: dict) -> dict:
    return client.get(f"/api/tests/{created['id']}", headers=hr).json()


def age_attempts(minutes: float) -> None:
    """Pretend every attempt started `minutes` ago."""
    with SessionLocal() as db:
        for attempt in db.scalars(select(ExamAttempt)):
            attempt.started_at = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        db.commit()


def finish(client, created: dict, started: dict, answers: dict | None = None):
    return client.post(url(created, "/submissions"), json={"attempt": started["attempt"], "answers": answers or {}})


# --- settings -----------------------------------------------------------------------------------------------------


def test_the_time_limit_and_shuffle_are_saved_and_the_link_shows_the_limit(client, hr):
    created = make_test(client, hr, time_limit_minutes=30, shuffle=True)
    assert (created["time_limit_minutes"], created["shuffle"]) == (30, True)
    assert client.get(url(created)).json()["time_limit_minutes"] == 30

    detail = host_view(client, hr, created)
    payload = {"title": "Python basics", "description": None, "form_mode": False, "is_public": True, "time_limit_minutes": None, "shuffle": False, "questions": [{k: q[k] for k in ("id", "question_type", "prompt", "options", "correct_option_index")} for q in detail["questions"]]}
    updated = client.put(f"/api/tests/{created['id']}", headers=hr, json=payload).json()
    assert (updated["time_limit_minutes"], updated["shuffle"]) == (None, False)


@pytest.mark.parametrize("minutes", [0, -5, 481])
def test_the_time_limit_has_bounds(client, hr, minutes):
    response = client.post("/api/tests", headers=hr, json={"title": "Bad limit", "form_mode": False, "is_public": True, "time_limit_minutes": minutes, "questions": [{"question_type": "short_text", "prompt": "Why?"}]})
    assert response.status_code == 422


def test_a_plain_form_saves_neither_setting(client, hr):
    created = make_test(client, hr, form_mode=True, time_limit_minutes=30, shuffle=True, questions=[{"question_type": "short_text", "prompt": "Team name", "options": [], "correct_option_index": None}])
    assert (created["time_limit_minutes"], created["shuffle"]) == (None, False)


# --- the clock ----------------------------------------------------------------------------------------------------


def test_starting_reports_the_time_left(client, hr):
    limited, unlimited = make_test(client, hr, time_limit_minutes=30), make_test(client, hr)
    assert 1795 <= start_exam(client, limited)["seconds_left"] <= 1800
    assert start_exam(client, unlimited)["seconds_left"] is None


def test_starting_again_keeps_the_clock_running(client, hr):
    created = make_test(client, hr, time_limit_minutes=30)
    first = start_exam(client, created)
    age_attempts(10)
    again = start_exam(client, created)
    assert again["attempt"] == first["attempt"] and again["started_at"] != first["started_at"]  # started_at was moved back by the test
    assert 1195 <= again["seconds_left"] <= 1200


def test_nobody_gets_the_questions_after_the_time_is_up(client, hr):
    created = make_test(client, hr, time_limit_minutes=30)
    start_exam(client, created)
    age_attempts(31)
    response = client.post(url(created, "/start"), json={"participant_name": "Ardi", "participant_email": "ardi@example.com"})
    assert response.status_code == 400 and "Time is up" in response.json()["detail"]


def test_a_submission_a_little_past_the_limit_is_not_reported(client, hr):
    created = make_test(client, hr, time_limit_minutes=30)
    started = start_exam(client, created)
    age_attempts(30.2)  # twelve seconds late: lag, not a signal
    assert finish(client, created, started).status_code == 201
    (submission,) = host_view(client, hr, created)["standalone_submissions"]
    assert submission["over_limit_seconds"] is None and submission["duration_seconds"] >= 1812


def test_a_submission_well_past_the_limit_is_accepted_and_reported(client, hr):
    created = make_test(client, hr, time_limit_minutes=30)
    started = start_exam(client, created)
    age_attempts(33)
    assert finish(client, created, started).status_code == 201  # the answers are kept; the host decides what it means
    (submission,) = host_view(client, hr, created)["standalone_submissions"]
    assert 175 <= submission["over_limit_seconds"] <= 185 and submission["duration_seconds"] >= 1980


def test_an_exam_without_a_limit_reports_the_duration_only(client, hr):
    created = make_test(client, hr)
    assert finish(client, created, start_exam(client, created)).status_code == 201
    (submission,) = host_view(client, hr, created)["standalone_submissions"]
    assert submission["over_limit_seconds"] is None and submission["duration_seconds"] is not None


def test_the_clock_arithmetic():
    test = SimpleNamespace(time_limit_minutes=10)
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    attempt = SimpleNamespace(started_at=now - timedelta(minutes=4))
    assert seconds_left(test, attempt, now) == 360 and over_limit_seconds(test, attempt, now) is None
    attempt.started_at = now - timedelta(minutes=10, seconds=31)
    assert seconds_left(test, attempt, now) == 0 and over_limit_seconds(test, attempt, now) == 31
    attempt.started_at = now - timedelta(minutes=10, seconds=30)
    assert over_limit_seconds(test, attempt, now) is None  # the grace is 30 seconds
    assert seconds_left(SimpleNamespace(time_limit_minutes=None), attempt, now) is None


# --- shuffling ----------------------------------------------------------------------------------------------------


def test_without_shuffle_the_exam_shows_the_hosts_order(client, hr):
    started = start_exam(client, make_test(client, hr, questions=THREE))
    assert [(q["position"], q["prompt"], q["options"]) for q in started["questions"]] == [(n, f"Question {n}", ["A", "B", "C"]) for n in (1, 2, 3)]


def test_shuffle_reorders_questions_and_options_and_answers_still_grade_against_the_key(client, hr, monkeypatch):
    monkeypatch.setattr("app.exams.random.shuffle", lambda items: items.reverse())  # a shuffle that is easy to reason about
    created = make_test(client, hr, questions=THREE, shuffle=True)
    started = start_exam(client, created)
    shown = started["questions"]
    assert [(q["position"], q["prompt"], q["options"]) for q in shown] == [(n, f"Question {4 - n}", ["C", "B", "A"]) for n in (1, 2, 3)]

    # The candidate picks the third option shown on every question ("A") and the first shown ("C") on none.
    answers = {q["id"]: 2 for q in shown}
    response = finish(client, created, started, answers)
    assert response.status_code == 201 and (response.json()["score"], response.json()["total"]) == (3, 3)
    (submission,) = host_view(client, hr, created)["standalone_submissions"]
    assert set(submission["answers"].values()) == {0}  # stored as the test's own option number, so the host's review reads right


def test_a_wrong_choice_under_shuffle_is_marked_wrong(client, hr, monkeypatch):
    monkeypatch.setattr("app.exams.random.shuffle", lambda items: items.reverse())
    created = make_test(client, hr, questions=THREE, shuffle=True)
    started = start_exam(client, created)
    response = finish(client, created, started, {q["id"]: 0 for q in started["questions"]})  # "C" everywhere
    assert (response.json()["score"], response.json()["total"]) == (0, 3)


def test_picking_up_a_shuffled_exam_again_shows_the_same_order(client, hr):
    created = make_test(client, hr, questions=[{"question_type": "multiple_choice", "prompt": f"Q{n}", "options": ["a", "b", "c", "d", "e"], "correct_option_index": 0} for n in range(8)], shuffle=True)
    first, again = start_exam(client, created), start_exam(client, created)
    assert first["questions"] == again["questions"]


def test_an_option_number_outside_what_was_shown_is_still_rejected(client, hr):
    created = make_test(client, hr, questions=THREE, shuffle=True)
    started = start_exam(client, created)
    assert finish(client, created, started, {started["questions"][0]["id"]: 3}).status_code == 422
    assert finish(client, created, started, {started["questions"][0]["id"]: "x"}).status_code == 422


def _question(question_id: str, options: list[str]) -> TestQuestion:
    return TestQuestion(id=question_id, test_id="t", position=1, question_type="multiple_choice", prompt=question_id, options=options, correct_option_index=0)


def test_editing_the_exam_while_someone_sits_it_does_not_break_their_order():
    one, two, three = _question("q1", ["a", "b"]), _question("q2", ["a", "b", "c"]), _question("q3", ["a", "b"])
    layout = [{"id": "q2", "options": [2, 0, 1]}, {"id": "q1", "options": [1, 0]}, {"id": "gone", "options": [0, 1]}]
    arranged = [(question.id, order) for question, order in arrange([one, two, three], layout)]
    assert arranged == [("q2", [2, 0, 1]), ("q1", [1, 0]), ("q3", [0, 1])]  # removed skipped, added last
    two.options = ["a", "b", "c", "d"]  # an option was added after the layout was made
    assert [(q.id, order) for q, order in arrange([one, two], layout)][0] == ("q2", [0, 1, 2, 3])


def test_answers_map_back_through_the_order_shown():
    question = _question("q1", ["a", "b", "c"])
    arranged = arrange([question], [{"id": "q1", "options": [2, 0, 1]}])
    assert original_answers(arranged, {"q1": 0}) == {"q1": 2} and original_answers(arranged, {"q1": 1}) == {"q1": 0}
    assert original_answers(arranged, {"q1": 7}) == {"q1": 7}  # left for the grader to reject
    assert original_answers(arranged, {"q1": "x"}) == {"q1": "x"}
    assert sorted(make_layout([question], True)[0]["options"]) == [0, 1, 2]


# --- the host's view ------------------------------------------------------------------------------------------------


def test_the_host_sees_who_started_and_never_submitted(client, hr):
    created = make_test(client, hr, time_limit_minutes=30)
    start_exam(client, created, name="Gone Missing", email="gone@example.com")
    done = start_exam(client, created, name="Finished", email="done@example.com")
    assert finish(client, created, done).status_code == 201

    (unfinished,) = host_view(client, hr, created)["unfinished_attempts"]
    assert (unfinished["participant_name"], unfinished["participant_email"], unfinished["expired"]) == ("Gone Missing", "gone@example.com", False)
    age_attempts(31)
    assert host_view(client, hr, created)["unfinished_attempts"][0]["expired"] is True


def test_the_host_can_let_someone_start_again(client, hr):
    created = make_test(client, hr, time_limit_minutes=30)
    first = start_exam(client, created)
    age_attempts(31)
    (unfinished,) = host_view(client, hr, created)["unfinished_attempts"]
    assert client.delete(f"/api/tests/{created['id']}/attempts/{unfinished['id']}", headers=hr).status_code == 204
    assert host_view(client, hr, created)["unfinished_attempts"] == []
    fresh = start_exam(client, created)
    assert fresh["attempt"] != first["attempt"] and fresh["seconds_left"] >= 1795
    assert finish(client, created, first).status_code == 400  # the old attempt is gone


def test_only_the_owner_can_release_an_attempt_and_only_an_unsubmitted_one(client, hr, other_hr):
    created = make_test(client, hr)
    start_exam(client, created)
    attempt_id = host_view(client, hr, created)["unfinished_attempts"][0]["id"]
    assert client.delete(f"/api/tests/{created['id']}/attempts/{attempt_id}", headers=other_hr).status_code == 404
    assert client.delete(f"/api/tests/{created['id']}/attempts/garbage", headers=hr).status_code == 404
    assert client.delete(f"/api/tests/{created['id']}/attempts/8c8c3c3e-0d3b-4b4a-9a43-5f9d6b2f8e11", headers=hr).status_code == 404
    assert client.delete(f"/api/tests/{created['id']}/attempts/{attempt_id}").status_code == 401
    assert client.get(f"/api/tests/{created['id']}", headers=other_hr).status_code == 404

    with SessionLocal() as db:
        attempt = db.get(ExamAttempt, attempt_id)
        attempt.submitted_at = datetime.now(timezone.utc)
        db.commit()
    assert client.delete(f"/api/tests/{created['id']}/attempts/{attempt_id}", headers=hr).status_code == 409


# --- retention and deletion ---------------------------------------------------------------------------------------------


def test_old_attempts_are_purged_with_the_submissions_and_only_for_the_caller(client, hr, other_hr):
    mine, theirs = make_test(client, hr), make_test(client, other_hr)
    for created in (mine, theirs):
        start_exam(client, created, email="p@example.com")
    with SessionLocal() as db:
        for attempt in db.scalars(select(ExamAttempt)):
            attempt.started_at = datetime.now(timezone.utc) - timedelta(days=90)
        db.commit()
    result = client.post("/api/settings/retention/purge", headers=hr).json()
    assert result["deleted_attempts"] == 1
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ExamAttempt.id))) == 1  # the other host's is untouched


def test_recent_attempts_survive_the_purge(client, hr):
    start_exam(client, make_test(client, hr))
    assert client.post("/api/settings/retention/purge", headers=hr).json()["deleted_attempts"] == 0


def test_deleting_the_test_deletes_its_attempts(client, hr):
    created = make_test(client, hr)
    start_exam(client, created)
    assert client.delete(f"/api/tests/{created['id']}", headers=hr).status_code in (200, 204)
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ExamAttempt.id))) == 0
