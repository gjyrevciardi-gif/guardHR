import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
SQLITE_FILE = BACKEND_DIR / "test_nemoguard.db"

# Must be set before `app` is imported. TEST_DATABASE_URL points the suite at PostgreSQL (CI does this);
# otherwise a throwaway SQLite file is used.
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{SQLITE_FILE}"
os.environ.update(
    APP_ENV="development",
    JWT_SECRET="test-secret-that-is-long-enough-for-tests",
    RATE_LIMIT_ENABLED="false",
    REGISTRATION_ENABLED="true",
    TRUST_PROXY_HEADERS="false",
    RETENTION_PURGE_INTERVAL_HOURS="0",
    PUBLIC_APP_URL="http://localhost:3100",
    CORS_ORIGINS="http://localhost:3100",
)

from fastapi.testclient import TestClient  # noqa: E402

from app.api import signaling  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.ratelimit import reset_rate_limits  # noqa: E402
from app.security import hash_password  # noqa: E402
from helpers import PASSWORD  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def database():
    if engine.dialect.name == "sqlite":
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
    else:  # PostgreSQL: build the schema with the real migrations so they are tested too
        from alembic.config import Config

        from alembic import command

        config = Config(str(BACKEND_DIR / "alembic.ini"))
        config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        command.upgrade(config, "head")
    yield
    engine.dispose()
    SQLITE_FILE.unlink(missing_ok=True)


@pytest.fixture(autouse=True)
def clean_state():
    with engine.begin() as connection:
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())
    reset_rate_limits()
    signaling.rooms.clear()
    yield


@pytest.fixture(autouse=True)
def sent_invites(monkeypatch):
    """Capture invite emails instead of talking to SMTP."""
    sent: list[str] = []
    monkeypatch.setattr("app.email.send_candidate_invite", lambda session: sent.append(session.public_token) or "link")
    return sent


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def make_user():
    def create(email: str = "hr@example.com", role: str = "hr", active: bool = True) -> User:
        with SessionLocal() as db:
            user = User(email=email, full_name="Test User", role=role, is_active=active, password_hash=hash_password(PASSWORD))
            db.add(user)
            db.commit()
            db.refresh(user)
            return user

    return create


@pytest.fixture
def login(client):
    def do_login(email: str = "hr@example.com") -> dict[str, str]:
        response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        assert response.status_code == 200, response.text
        client.cookies.clear()  # fixtures authenticate with Bearer headers only; cookie behaviour has its own tests
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    return do_login


@pytest.fixture
def hr(make_user, login):
    make_user("hr@example.com")
    return login("hr@example.com")


@pytest.fixture
def other_hr(make_user, login):
    make_user("other@example.com")
    return login("other@example.com")


@pytest.fixture
def new_session(client):
    def create(headers: dict[str, str], **overrides) -> dict:
        payload = {
            "title": "Backend interview",
            "candidate_name": "Ada Lovelace",
            "candidate_email": "ada@example.com",
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
            "require_screen_share": False,
        } | overrides
        response = client.post("/api/sessions", headers=headers, json=payload)
        assert response.status_code == 201, response.text
        return response.json()

    return create


@pytest.fixture
def started_session(client, hr, new_session):
    """A consented and started session owned by `hr`."""
    data = new_session(hr)
    token = data["public_token"]
    assert client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True}).status_code == 200
    assert client.post(f"/api/public/sessions/{token}/start").status_code == 204
    return data
