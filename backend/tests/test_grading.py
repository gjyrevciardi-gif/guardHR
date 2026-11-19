import io
import zipfile

import pytest
from fastapi import HTTPException

from app.api.tests import grade_answers, validate_questions
from app.models import TestQuestion
from app.schemas import TestCreate as QuizCreate
from app.test_generator import extract_text_from_upload
from helpers import make_test


def questions() -> list[TestQuestion]:
    return [
        TestQuestion(id="q1", position=1, question_type="multiple_choice", prompt="2+2", options=["3", "4"], correct_option_index=1),
        TestQuestion(id="q2", position=2, question_type="multiple_choice", prompt="Form-style", options=["a", "b"], correct_option_index=None),
        TestQuestion(id="q3", position=3, question_type="short_text", prompt="Why", options=[], correct_option_index=None),
    ]


def test_scores_only_questions_with_an_answer_key():
    checked, score, total = grade_answers(questions(), {"q1": 1, "q2": 0, "q3": "  because  "})
    assert (score, total) == (1, 1)
    assert checked == {"q1": 1, "q2": 0, "q3": "because"}


def test_wrong_and_missing_answers():
    assert grade_answers(questions(), {"q1": 0})[1:] == (0, 1)
    assert grade_answers(questions(), {})[1:] == (0, 0)  # unanswered questions are not counted as attempted
    assert grade_answers(questions(), {"unknown": 1})[0] == {}  # answers to unknown question ids are ignored


@pytest.mark.parametrize("answer", [-1, 2, "x", [1], {"a": 1}])
def test_invalid_choices_are_rejected(answer):
    with pytest.raises(HTTPException) as caught:
        grade_answers(questions(), {"q1": answer})
    assert caught.value.status_code == 422


def test_text_answers_are_length_limited():
    with pytest.raises(HTTPException):
        grade_answers(questions(), {"q3": "x" * 5001})


def payload(**question) -> QuizCreate:
    base = {"question_type": "multiple_choice", "prompt": "Question?", "options": ["a", "b"], "correct_option_index": 0}
    return QuizCreate(title="Quiz", questions=[base | question])


@pytest.mark.parametrize("question", [{"options": ["only one"]}, {"options": ["a", " "]}, {"correct_option_index": None}, {"correct_option_index": 2}])
def test_question_validation_failures(question):
    with pytest.raises(HTTPException) as caught:
        validate_questions(payload(**question))
    assert caught.value.status_code == 422


def test_forms_do_not_need_an_answer_key():
    validate_questions(QuizCreate(title="Form", form_mode=True, questions=[{"question_type": "multiple_choice", "prompt": "Pick", "options": ["a", "b"]}]))


def test_text_extraction_rejects_unsafe_or_corrupt_files():
    assert extract_text_from_upload("notes.txt", b"hello") == "hello"
    with pytest.raises(ValueError, match="Unsupported"):
        extract_text_from_upload("malware.exe", b"MZ")
    with pytest.raises(ValueError, match="could not be read"):
        extract_text_from_upload("broken.pdf", b"%PDF-garbage")
    with pytest.raises(ValueError, match="could not be read"):
        extract_text_from_upload("broken.docx", b"not a zip")


def test_docx_zip_bombs_are_refused_before_parsing():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", b"0" * 60_000_000)  # ~60 KB on disk, 60 MB when unpacked
    assert len(buffer.getvalue()) < 1_000_000
    with pytest.raises(ValueError, match="too large"):
        extract_text_from_upload("bomb.docx", buffer.getvalue())


def test_upload_endpoint_reports_corrupt_files_as_422(client, hr):
    for name in ("broken.pdf", "broken.docx", "notes.exe"):
        response = client.post("/api/tests/generate-from-file", headers=hr, files={"file": (name, b"garbage", "application/octet-stream")}, data={"question_count": "5"})
        assert response.status_code == 422, name
    assert client.post("/api/tests/generate-from-file", headers=hr, files={"file": ("a.txt", b"x", "text/plain")}, data={"question_count": "1"}).status_code == 422
    assert client.post("/api/tests/generate-from-file", headers=hr, files={"file": ("a.txt", b"0" * 8_000_001, "text/plain")}, data={"question_count": "5"}).status_code == 413


def test_updating_a_test_replaces_and_removes_questions(client, hr):
    created = make_test(client, hr)
    detail = client.get(f"/api/tests/{created['id']}", headers=hr).json()
    keep = detail["questions"][0]
    body = {
        "title": "Renamed",
        "description": "d",
        "form_mode": False,
        "is_public": True,
        "questions": [
            {"id": keep["id"], "question_type": "multiple_choice", "prompt": "Edited?", "options": ["x", "y", "z"], "correct_option_index": 2},
            {"question_type": "short_text", "prompt": "New one"},
        ],
    }
    updated = client.put(f"/api/tests/{created['id']}", headers=hr, json=body)
    assert updated.status_code == 200
    assert [q["prompt"] for q in updated.json()["questions"]] == ["Edited?", "New one"]
    assert updated.json()["questions"][0]["id"] == keep["id"] and updated.json()["questions"][0]["correct_option_index"] == 2
    bad = body | {"questions": [{"id": "6f9619ff-8b86-d011-b42d-00c04fc964ff", "question_type": "short_text", "prompt": "Foreign"}]}
    assert client.put(f"/api/tests/{created['id']}", headers=hr, json=bad).status_code == 422
