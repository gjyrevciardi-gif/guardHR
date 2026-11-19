from datetime import datetime, timezone

PASSWORD = "StrongPass123!"
ORIGIN = {"Origin": "http://localhost:3100"}


def event_payload(**overrides) -> dict:
    return {"event_type": "tab_hidden", "started_at": datetime.now(timezone.utc).isoformat(), "duration_seconds": 1.5, "confidence_score": 1, "metadata": {"source": "browser"}} | overrides


def make_test(client, headers: dict[str, str], **overrides) -> dict:
    payload = {
        "title": "Python basics",
        "description": None,
        "form_mode": False,
        "is_public": True,
        "questions": [
            {"question_type": "multiple_choice", "prompt": "2 + 2?", "options": ["3", "4"], "correct_option_index": 1},
            {"question_type": "short_text", "prompt": "Why?", "options": [], "correct_option_index": None},
        ],
    } | overrides
    response = client.post("/api/tests", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()
