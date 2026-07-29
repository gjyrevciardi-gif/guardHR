import os
from datetime import datetime, timedelta, timezone

os.environ["DATABASE_URL"] = "sqlite:///./test_interviewguard.db"
os.environ["JWT_SECRET"] = "test-secret-that-is-long-enough-for-tests"

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import User
from app.security import hash_password


def setup_module():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        db.add(User(email="hr@example.com", full_name="Test HR", password_hash=hash_password("StrongPass123!")))
        db.commit()


def teardown_module():
    Base.metadata.drop_all(bind=engine)
    try:
        os.remove("test_interviewguard.db")
    except FileNotFoundError:
        pass


def test_complete_hr_and_candidate_flow():
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"email": "hr@example.com", "password": "StrongPass123!"})
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        created = client.post("/api/sessions", headers=headers, json={
            "title": "Backend interview",
            "candidate_name": "Ada Lovelace",
            "candidate_email": "ada@example.com",
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
            "require_screen_share": True,
        })
        assert created.status_code == 201
        data = created.json()
        token, session_id = data["public_token"], data["id"]

        assert client.post(f"/api/public/sessions/{token}/start").status_code == 403
        assert client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True}).status_code == 200
        assert client.post(f"/api/public/sessions/{token}/start").status_code == 204

        event = client.post(f"/api/public/sessions/{token}/events", json={
            "event_type": "tab_hidden",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "duration_seconds": 2.4,
            "confidence_score": 1,
            "metadata": {"source": "browser"},
        })
        assert event.status_code == 201
        assert client.post(f"/api/public/sessions/{token}/finish").status_code == 204

        detail = client.get(f"/api/sessions/{session_id}", headers=headers)
        assert detail.status_code == 200
        assert detail.json()["review_status"] == "Requires review"
        assert len(detail.json()["events"]) == 1

        review = client.post(f"/api/sessions/{session_id}/reviews", headers=headers, json={"outcome": "Insufficient evidence", "notes": "The tab switch was explained by a system notification."})
        assert review.status_code == 200
        assert client.get("/api/audit-logs", headers=headers).status_code == 200


def test_invalid_event_type_is_rejected():
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"email": "hr@example.com", "password": "StrongPass123!"})
        assert login.status_code == 200
        assert client.post("/api/public/sessions/not-a-token/events", json={"event_type": "emotion_detected", "started_at": datetime.now(timezone.utc).isoformat()}).status_code == 422

