from datetime import datetime, timezone

PASSWORD = "StrongPass123!"
ORIGIN = {"Origin": "http://localhost:3100"}
PRODUCTION = {
    "app_env": "production",
    "jwt_secret": "x" * 40,
    "secrets_encryption_key": "RxkcsUvH1-w3N1m3vUqYk0o4kVQxTq0uQ5wB8m7cX9s=",  # a throwaway Fernet key, only for tests
    "initial_admin_password": "Another-Strong-1!",
    "public_app_url": "https://hr.example.com",
}


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


def start_exam(client, created: dict, name: str = "Ardi", email: str = "ardi@example.com") -> dict:
    """What a candidate does first on a public exam: give a name and email, and get the questions and an attempt token."""
    response = client.post(f"/api/public/tests/{created['public_token']}/start", json={"participant_name": name, "participant_email": email})
    assert response.status_code == 200, response.text
    return response.json()
