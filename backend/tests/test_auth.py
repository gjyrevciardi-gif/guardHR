import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.config import Settings
from app.database import SessionLocal
from app.models import AuditLog
from app.ratelimit import hit
from app.security import DUMMY_PASSWORD_HASH, verify_password
from helpers import ORIGIN, PASSWORD, PRODUCTION


def test_login_sets_httponly_cookie_and_cookie_authenticates(client, make_user):
    make_user()
    response = client.post("/api/auth/login", json={"email": "hr@example.com", "password": PASSWORD})
    assert response.status_code == 200
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert client.get("/api/auth/me").json()["email"] == "hr@example.com"  # cookie only, no Authorization header


def test_cookie_authenticated_writes_require_an_allowed_origin(client, make_user):
    make_user()
    client.post("/api/auth/login", json={"email": "hr@example.com", "password": PASSWORD})
    assert client.put("/api/settings/retention", json={"retention_days": 10}).status_code == 403
    assert client.put("/api/settings/retention", json={"retention_days": 10}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.put("/api/settings/retention", json={"retention_days": 10}, headers=ORIGIN).status_code == 200


def test_bearer_token_works_without_origin(client, hr):
    assert client.put("/api/settings/retention", json={"retention_days": 10}, headers=hr).status_code == 200


def test_logout_clears_the_session_cookie(client, make_user):
    make_user()
    client.post("/api/auth/login", json={"email": "hr@example.com", "password": PASSWORD})
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


@pytest.mark.parametrize("email,password", [("hr@example.com", "wrong-password"), ("nobody@example.com", PASSWORD)])
def test_bad_credentials_are_rejected_and_audited(client, make_user, email, password):
    make_user()
    assert client.post("/api/auth/login", json={"email": email, "password": password}).status_code == 401
    with SessionLocal() as db:
        assert db.query(AuditLog).filter(AuditLog.action == "auth.login_failed").count() == 1


def test_inactive_user_cannot_log_in(client, make_user):
    make_user(active=False)
    assert client.post("/api/auth/login", json={"email": "hr@example.com", "password": PASSWORD}).status_code == 401


def test_dummy_hash_is_a_valid_hash_so_unknown_emails_cost_the_same_time():
    assert verify_password("anything", DUMMY_PASSWORD_HASH) is False


def test_login_is_throttled_per_account(client, make_user, settings, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    make_user()
    codes = [client.post("/api/auth/login", json={"email": "hr@example.com", "password": "wrong"}).status_code for _ in range(12)]
    assert codes[:10] == [401] * 10
    assert codes[10:] == [429, 429]
    assert client.post("/api/auth/login", json={"email": "hr@example.com", "password": PASSWORD}).status_code == 429


def test_rate_limit_window_helper(settings, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    hit("unit", 2, 60)
    hit("unit", 2, 60)
    with pytest.raises(HTTPException) as caught:
        hit("unit", 2, 60)
    assert caught.value.status_code == 429


def test_registration_can_be_closed(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "registration_enabled", False)
    response = client.post("/api/auth/register", json={"email": "new@example.com", "password": PASSWORD, "full_name": "New Person"})
    assert response.status_code == 403


def test_registration_creates_hr_user_with_cookie(client):
    response = client.post("/api/auth/register", json={"email": "New@Example.com", "password": PASSWORD, "full_name": "New Person"})
    assert response.status_code == 201
    assert response.json()["user"]["role"] == "hr" and response.json()["user"]["email"] == "new@example.com"
    assert "set-cookie" in response.headers
    assert client.post("/api/auth/register", json={"email": "new@example.com", "password": PASSWORD, "full_name": "Dup"}).status_code == 409


def test_only_admins_can_create_users(client, make_user, login):
    make_user("hr@example.com", role="hr")
    make_user("admin@example.com", role="admin")
    body = {"email": "created@example.com", "password": PASSWORD, "full_name": "Created User", "role": "hr"}
    assert client.post("/api/auth/users", json=body, headers=login("hr@example.com")).status_code == 403
    assert client.post("/api/auth/users", json=body).status_code == 401
    created = client.post("/api/auth/users", json=body, headers=login("admin@example.com"))
    assert created.status_code == 201 and created.json()["role"] == "hr"
    assert client.post("/api/auth/users", json=body, headers=login("admin@example.com")).status_code == 409
    assert client.post("/api/auth/login", json={"email": "created@example.com", "password": PASSWORD}).status_code == 200


def test_production_refuses_insecure_configuration():
    Settings(_env_file=None, **PRODUCTION)
    for bad in ({"jwt_secret": "short"}, {"jwt_secret": "replace-with-at-least-32-random-characters"}, {"initial_admin_password": "ChangeMe123!"}, {"public_app_url": "http://hr.example.com"}, {"secrets_encryption_key": ""}, {"secrets_encryption_key": "not-a-key"}):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, **(PRODUCTION | bad))


def test_production_closes_registration_by_default(monkeypatch):
    monkeypatch.delenv("REGISTRATION_ENABLED")
    assert Settings(_env_file=None).registration_allowed is True
    assert Settings(_env_file=None, **PRODUCTION).registration_allowed is False
    assert Settings(_env_file=None, **PRODUCTION, registration_enabled=True).registration_allowed is True


def test_ice_servers_must_be_valid():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, ice_servers="not json")
    with pytest.raises(ValidationError):
        Settings(_env_file=None, ice_servers='[{"url": "missing urls key"}]')
    assert Settings(_env_file=None, ice_servers='[{"urls": "turn:t.example:3478", "username": "u", "credential": "c"}]').ice_server_list[0]["username"] == "u"


def test_rtc_config_is_public_and_configurable(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "ice_servers", '[{"urls": "turn:t.example:3478"}]')
    assert client.get("/api/rtc-config").json() == {"iceServers": [{"urls": "turn:t.example:3478"}]}


def test_rtc_config_hands_out_short_lived_turn_credentials(client, settings, monkeypatch):
    import base64
    import hashlib
    import hmac

    monkeypatch.setattr(settings, "turn_urls", "turn:t.example:3478?transport=udp, turns:t.example:5349?transport=tcp")
    monkeypatch.setattr(settings, "turn_secret", "s" * 40)
    monkeypatch.setattr("app.api.settings.time.time", lambda: 1_000_000)
    stun, turn = client.get("/api/rtc-config").json()["iceServers"]
    assert stun["urls"].startswith("stun:") and "credential" not in stun  # the configured STUN entry is kept as is
    assert turn["urls"] == ["turn:t.example:3478?transport=udp", "turns:t.example:5349?transport=tcp"]
    assert turn["username"] == "1028800:nemoguard"  # expires 8 h from now; the number before the colon is what coturn checks
    assert turn["credential"] == base64.b64encode(hmac.new(b"s" * 40, b"1028800:nemoguard", hashlib.sha1).digest()).decode()
    assert "s" * 40 not in str(turn)  # the secret itself is never sent
    monkeypatch.setattr("app.api.settings.time.time", lambda: 1_000_060)
    assert client.get("/api/rtc-config").json()["iceServers"][1]["credential"] != turn["credential"]  # a new one every time


def test_turn_urls_and_secret_must_come_together():
    for only in ({"turn_urls": "turn:t.example:3478"}, {"turn_secret": "s" * 40}):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, **only)
    assert Settings(_env_file=None, turn_urls="turn:t.example:3478", turn_secret="s" * 40).turn_url_list == ["turn:t.example:3478"]
    assert Settings(_env_file=None).turn_url_list == []
    with pytest.raises(ValidationError):  # production: a guessable secret would let anyone mint relay credentials
        Settings(_env_file=None, **(PRODUCTION | {"turn_urls": "turn:t.example:3478", "turn_secret": "short"}))
    Settings(_env_file=None, **(PRODUCTION | {"turn_urls": "turn:t.example:3478", "turn_secret": "s" * 32}))


def test_blank_environment_values_fall_back_to_defaults(monkeypatch):
    monkeypatch.setenv("REGISTRATION_ENABLED", "")
    monkeypatch.setenv("ICE_SERVERS", "")
    loaded = Settings(_env_file=None)
    assert loaded.registration_enabled is None and loaded.ice_server_list[0]["urls"].startswith("stun:")
