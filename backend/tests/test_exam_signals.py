from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.database import SessionLocal
from app.enums import EventType
from app.models import TestSubmission
from app.schemas import MAX_EXAM_EVENTS
from app.signals import Severity, severity_for
from helpers import make_test, start_exam


def signal(event_type: str = "tab_hidden", **overrides) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {"event_type": event_type, "started_at": now, "ended_at": now, "duration_seconds": 4.0, "metadata": {"source": "visibilitychange"}} | overrides


def submit(client, created: dict, **payload):
    """Sit the exam (or fill in the plain form) and send the answers with `payload` on top."""
    if created["form_mode"]:
        questions = client.get(f"/api/public/tests/{created['public_token']}").json()["questions"]
        body = {"participant_name": "Ardi", "participant_email": "ardi@example.com"}
    else:
        started = start_exam(client, created)
        questions, body = started["questions"], {"attempt": started["attempt"]}
    answers = {questions[0]["id"]: 1, questions[1]["id"]: "Because"}
    return client.post(f"/api/public/tests/{created['public_token']}/submissions", json=body | {"answers": answers} | payload)


def standalone(client, hr, created: dict) -> list[dict]:
    return client.get(f"/api/tests/{created['id']}", headers=hr).json()["standalone_submissions"]


def test_exam_signals_are_stored_with_the_submission_and_shown_to_the_host(client, hr):
    created = make_test(client, hr)
    events = [
        signal("tab_hidden", duration_seconds=45, metadata={"source": "window_blur"}),
        signal("copy_paste", duration_seconds=None, metadata={"operation": "paste", "char_count": 120, "content_stored": False}),
        signal("copy_paste", duration_seconds=None, metadata={"operation": "copy", "blocked": True}),
    ]
    assert submit(client, created, events=events).status_code == 201

    (submission,) = standalone(client, hr, created)
    assert [(e["event_type"], e["severity"]) for e in submission["events"]] == [("tab_hidden", "medium"), ("copy_paste", "medium"), ("copy_paste", "low")]
    assert submission["events"][1]["metadata"]["operation"] == "paste"


def test_the_browser_cannot_choose_the_severity(client, hr):
    created = make_test(client, hr)
    assert submit(client, created, events=[signal("copy_paste", metadata={"operation": "paste"}, severity="info")]).status_code == 201
    assert standalone(client, hr, created)[0]["events"][0]["severity"] == "medium"


def test_a_submission_without_signals_is_still_accepted(client, hr):
    created = make_test(client, hr)
    assert submit(client, created).status_code == 201
    assert standalone(client, hr, created)[0]["events"] == []


def test_plain_forms_are_never_monitored(client, hr):
    questions = [
        {"question_type": "multiple_choice", "prompt": "Do you come?", "options": ["Yes", "No"], "correct_option_index": None},
        {"question_type": "short_text", "prompt": "Team name", "options": [], "correct_option_index": None},
    ]
    created = make_test(client, hr, form_mode=True, questions=questions)
    assert submit(client, created, events=[signal()]).status_code == 201
    assert standalone(client, hr, created)[0]["events"] == []


@pytest.mark.parametrize("event_type", ["phone_detected", "multiple_people", "camera_disabled", "window_resized", "nonsense"])
def test_an_exam_page_can_only_report_page_signals(client, hr, event_type):
    created = make_test(client, hr)
    assert submit(client, created, events=[signal(event_type)]).status_code == 422
    assert standalone(client, hr, created) == []  # nothing was stored


def test_the_number_of_signals_is_capped(client, hr):
    created = make_test(client, hr)
    assert submit(client, created, events=[signal()] * (MAX_EXAM_EVENTS + 1)).status_code == 422
    assert submit(client, created, events=[signal()] * MAX_EXAM_EVENTS).status_code == 201


def test_signal_metadata_must_stay_small(client, hr):
    created = make_test(client, hr)
    assert submit(client, created, events=[signal(metadata={"note": "x" * 5000})]).status_code == 422


def test_signals_go_when_the_test_is_deleted(client, hr):
    created = make_test(client, hr)
    assert submit(client, created, events=[signal()]).status_code == 201
    assert client.delete(f"/api/tests/{created['id']}", headers=hr).status_code in (200, 204)
    with SessionLocal() as db:
        assert db.scalar(select(func.count(TestSubmission.id))) == 0


@pytest.mark.parametrize(
    ("metadata", "expected"),
    [
        ({"operation": "paste"}, Severity.medium),
        ({"operation": "print"}, Severity.medium),
        ({"operation": "screenshot_key"}, Severity.medium),
        ({"operation": "copy", "blocked": True}, Severity.low),
        ({"operation": "cut"}, Severity.low),
        ({}, Severity.low),
    ],
)
def test_clipboard_severity(metadata, expected):
    assert severity_for(EventType.copy_paste, None, metadata) == expected
