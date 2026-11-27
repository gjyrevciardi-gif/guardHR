"""A host-supplied list of the addresses that may take a public exam that checks email."""

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import AuditLog, ExamEmailCode
from helpers import make_test

INVITED = ["Ardi@Example.com", "bora@example.com"]  # mixed case on purpose: matched in lower case


@pytest.fixture
def codes(monkeypatch):
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr("app.email.send_exam_code", lambda email, title, code: sent.append((email, code)))
    return sent


@pytest.fixture
def exam(client, hr):
    return make_test(client, hr, verify_candidate_email=True, invited_emails=INVITED)


def url(created: dict, path: str = "") -> str:
    return f"/api/public/tests/{created['public_token']}{path}"


def ask(client, created: dict, email: str):
    return client.post(url(created, "/verification"), json={"participant_email": email})


def confirm(client, created: dict, email: str, code: str):
    return client.post(url(created, "/verification/confirm"), json={"participant_name": "Someone", "participant_email": email, "code": code})


def test_an_invited_address_gets_a_code_whatever_its_case_and_can_start(client, exam, codes):
    assert ask(client, exam, "ARDI@example.com").status_code == 200
    assert codes[0][0] == "ardi@example.com"
    assert confirm(client, exam, "ardi@example.com", codes[0][1]).status_code == 200


def test_an_address_that_is_not_invited_gets_no_code_and_leaves_no_trace_of_one(client, exam, codes):
    refused = ask(client, exam, "stranger@example.com")
    assert refused.status_code == 403
    assert "invited" in refused.json()["detail"]
    assert codes == []  # nothing was mailed to a mailbox the host did not name
    with SessionLocal() as db:
        assert db.scalar(select(ExamEmailCode.id)) is None
        refusals = db.scalars(select(AuditLog).where(AuditLog.action == "public_test.code_refused")).all()
    assert len(refusals) == 1 and "stranger" not in str(refusals[0].details)


def test_the_list_is_the_hosts_alone(client, hr, exam):
    detail = client.get(f"/api/tests/{exam['id']}", headers=hr).json()
    assert detail["invited_emails"] == ["ardi@example.com", "bora@example.com"]  # stored lower case
    public = client.get(url(exam))
    assert "invited_emails" not in public.json() and "example.com" not in public.text  # a candidate never sees who else was invited
    assert "invited_emails" not in client.get("/api/tests", headers=hr).json()[0]


def test_repeats_are_dropped_and_the_order_is_kept(client, hr):
    created = make_test(client, hr, verify_candidate_email=True, invited_emails=["b@x.com", "A@x.com", "B@x.com", "a@x.com"])
    assert client.get(f"/api/tests/{created['id']}", headers=hr).json()["invited_emails"] == ["b@x.com", "a@x.com"]


def test_no_list_means_anyone_as_before(client, hr, codes):
    open_exam = make_test(client, hr, verify_candidate_email=True)
    assert client.get(f"/api/tests/{open_exam['id']}", headers=hr).json()["invited_emails"] == []
    assert ask(client, open_exam, "anyone@example.com").status_code == 200


def test_a_list_without_the_email_code_is_refused_instead_of_silently_ignored(client, hr):
    base = {"title": "Test", "description": None, "is_public": True, "questions": [{"question_type": "short_text", "prompt": "Why?", "options": [], "correct_option_index": None}]}
    for extra in ({"verify_candidate_email": False}, {"form_mode": True, "verify_candidate_email": True}):
        response = client.post("/api/tests", headers=hr, json=base | {"form_mode": False, "invited_emails": ["a@x.com"]} | extra)
        assert response.status_code == 422, extra
        assert "invited list" in response.json()["detail"]


def test_the_list_is_bounded_and_every_entry_must_be_an_address(client, hr):
    base = {"title": "Test", "description": None, "form_mode": False, "is_public": True, "verify_candidate_email": True,
            "questions": [{"question_type": "short_text", "prompt": "Why?", "options": [], "correct_option_index": None}]}
    assert client.post("/api/tests", headers=hr, json=base | {"invited_emails": ["nope"]}).status_code == 422
    assert client.post("/api/tests", headers=hr, json=base | {"invited_emails": [f"p{i}@x.com" for i in range(501)]}).status_code == 422
    assert client.post("/api/tests", headers=hr, json=base | {"invited_emails": [f"p{i}@x.com" for i in range(500)]}).status_code == 201


def test_the_editor_can_set_change_and_clear_the_list(client, hr, codes):
    created = make_test(client, hr, verify_candidate_email=True)
    detail = client.get(f"/api/tests/{created['id']}", headers=hr).json()
    questions = [{k: q[k] for k in ("id", "question_type", "prompt", "options", "correct_option_index")} for q in detail["questions"]]
    base = {"title": "Python basics", "description": None, "form_mode": False, "is_public": True, "verify_candidate_email": True, "questions": questions}

    on = client.put(f"/api/tests/{created['id']}", headers=hr, json=base | {"invited_emails": ["only@example.com"]})
    assert on.json()["invited_emails"] == ["only@example.com"]
    assert ask(client, created, "ardi@example.com").status_code == 403
    assert ask(client, created, "only@example.com").status_code == 200

    off = client.put(f"/api/tests/{created['id']}", headers=hr, json=base)
    assert off.json()["invited_emails"] == []  # leaving it out means open to anyone, like the other exam options
    assert ask(client, created, "ardi@example.com").status_code == 200

    broken = client.put(f"/api/tests/{created['id']}", headers=hr, json=base | {"verify_candidate_email": False, "invited_emails": ["x@example.com"]})
    assert broken.status_code == 422  # turning the code off while a list stands would quietly open the exam


def test_a_code_asked_for_before_the_list_existed_stops_working_once_the_address_is_off_it(client, hr, codes):
    created = make_test(client, hr, verify_candidate_email=True)
    assert ask(client, created, "stranger@example.com").status_code == 200
    code = codes[0][1]
    detail = client.get(f"/api/tests/{created['id']}", headers=hr).json()
    questions = [{k: q[k] for k in ("id", "question_type", "prompt", "options", "correct_option_index")} for q in detail["questions"]]
    client.put(
        f"/api/tests/{created['id']}",
        headers=hr,
        json={"title": "Python basics", "description": None, "form_mode": False, "is_public": True, "verify_candidate_email": True, "invited_emails": ["ardi@example.com"], "questions": questions},
    )
    assert confirm(client, created, "stranger@example.com", code).status_code == 403


def test_a_test_made_from_a_document_takes_the_invited_list_too(client, hr, codes):
    document = "\n".join(f"{n}. Question {n}?\nA. One\nB. Two\nC. Three\nD. Four\n" for n in range(1, 4)) + "\nAnswer Key:\n1. B 2. A 3. C\n"

    def upload(**fields):
        return client.post("/api/tests/generate-from-file", headers=hr, files={"file": ("quiz.txt", document.encode(), "text/plain")}, data={"question_count": "3", **fields})

    created = upload(verify_candidate_email="true", invited_emails=INVITED)
    assert created.status_code == 201
    assert client.get(f"/api/tests/{created.json()['id']}", headers=hr).json()["invited_emails"] == ["ardi@example.com", "bora@example.com"]
    assert ask(client, created.json(), "stranger@example.com").status_code == 403

    assert upload(invited_emails=INVITED).status_code == 422  # without the email code the list would do nothing
    assert upload(verify_candidate_email="true", invited_emails="not-an-address").status_code == 422
