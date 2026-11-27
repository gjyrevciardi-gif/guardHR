import pytest

from helpers import make_test, start_exam

FORM = [{"question_type": "short_text", "prompt": "Team name", "options": [], "correct_option_index": None}]


def url(created: dict, path: str = "") -> str:
    return f"/api/public/tests/{created['public_token']}{path}"


def submit(client, created: dict, attempt: str | None, **payload):
    return client.post(url(created, "/submissions"), json={"attempt": attempt, "answers": {}} | payload)


def test_the_link_alone_does_not_reveal_the_exam_questions(client, hr):
    created = make_test(client, hr)
    page = client.get(url(created)).json()
    assert page["questions"] == [] and page["question_count"] == 2 and page["title"] == "Python basics"


def test_starting_gives_the_questions_without_the_answers(client, hr):
    created = make_test(client, hr)
    started = start_exam(client, created)
    assert [q["prompt"] for q in started["questions"]] == ["2 + 2?", "Why?"]
    assert all("correct_option_index" not in q for q in started["questions"])
    assert started["attempt"] and started["started_at"]


def test_a_plain_form_still_shows_its_questions_and_has_no_start(client, hr):
    created = make_test(client, hr, form_mode=True, questions=FORM)
    assert [q["prompt"] for q in client.get(url(created)).json()["questions"]] == ["Team name"]
    assert client.post(url(created, "/start"), json={"participant_name": "Ardi", "participant_email": "a@example.com"}).status_code == 400


@pytest.mark.parametrize("body", [{}, {"participant_name": "Ardi"}, {"participant_email": "a@example.com"}, {"participant_name": "A", "participant_email": "a@example.com"}, {"participant_name": "  ", "participant_email": "a@example.com"}, {"participant_name": "Ardi", "participant_email": "not-an-email"}])
def test_starting_needs_a_name_and_an_email(client, hr, body):
    assert client.post(url(make_test(client, hr), "/start"), json=body).status_code == 422


def test_a_closed_or_unknown_link_cannot_be_started(client, hr):
    closed = make_test(client, hr, is_public=False)
    body = {"participant_name": "Ardi", "participant_email": "a@example.com"}
    assert client.post(url(closed, "/start"), json=body).status_code == 404
    assert client.post("/api/public/tests/garbage/start", json=body).status_code == 404


def test_an_exam_cannot_be_submitted_without_starting_it(client, hr):
    created = make_test(client, hr)
    assert submit(client, created, None, participant_name="Ardi", participant_email="a@example.com").status_code == 400
    assert submit(client, created, "garbage").status_code == 400
    assert submit(client, created, "8c8c3c3e-0d3b-4b4a-9a43-5f9d6b2f8e11").status_code == 400  # well-formed, but nobody started it
    assert client.get(f"/api/tests/{created['id']}", headers=hr).json()["standalone_submissions"] == []


def test_an_attempt_works_only_for_the_test_it_was_started_on(client, hr):
    first, second = make_test(client, hr), make_test(client, hr)
    assert submit(client, second, start_exam(client, first)["attempt"]).status_code == 400


def test_the_exam_is_recorded_for_who_started_it_whatever_the_body_says(client, hr):
    created = make_test(client, hr)
    attempt = start_exam(client, created, name="  Ardi G  ", email="Ardi@Example.com")["attempt"]
    response = submit(client, created, attempt, participant_name="Someone Else", participant_email="else@example.com")
    assert response.status_code == 201
    assert (response.json()["participant_name"], response.json()["participant_email"]) == ("Ardi G", "ardi@example.com")


def test_one_submission_per_email_is_refused_at_the_start_not_after_the_whole_exam(client, hr):
    created = make_test(client, hr)
    assert submit(client, created, start_exam(client, created)["attempt"]).status_code == 201
    again = client.post(url(created, "/start"), json={"participant_name": "Ardi", "participant_email": "ARDI@example.com"})
    assert again.status_code == 409
    other = start_exam(client, created, email="b@example.com")
    assert submit(client, created, other["attempt"]).status_code == 201


def test_starting_again_picks_the_same_attempt_up_and_it_can_be_submitted_once(client, hr):
    created = make_test(client, hr)
    first, again = start_exam(client, created), start_exam(client, created, email="ARDI@example.com")
    assert again["attempt"] == first["attempt"] and again["started_at"] == first["started_at"]
    assert submit(client, created, first["attempt"]).status_code == 201
    assert submit(client, created, first["attempt"]).status_code == 409


def test_starting_is_limited(client, hr, settings, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    created = make_test(client, hr)
    body = {"participant_name": "Ardi", "participant_email": "a@example.com"}
    codes = [client.post(url(created, "/start"), json=body).status_code for _ in range(22)]
    assert codes.count(200) == 20 and codes[-1] == 429
