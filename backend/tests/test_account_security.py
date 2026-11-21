"""Session revocation, password change and reset, and two-step verification (TOTP)."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pytest
from sqlalchemy import select

from app import mfa
from app.config import Settings
from app.database import SessionLocal
from app.email import build_password_reset
from app.models import AuditLog, User
from helpers import PASSWORD

NEW_PASSWORD = "Another-Pass-456!"
PRODUCTION = {"app_env": "production", "jwt_secret": "x" * 40, "initial_admin_password": "Another-Strong-1!", "public_app_url": "https://hr.example.com"}


@pytest.fixture
def clock(monkeypatch):
    """A frozen clock for the authenticator code, so tests never straddle a 30 second boundary."""
    now = [1_800_000_000.0]
    monkeypatch.setattr(mfa, "time", SimpleNamespace(time=lambda: now[0]))
    return now


def totp(secret: str, clock: list[float], steps: int = 0) -> str:
    return mfa.code_for_step(secret, int(clock[0] // mfa.STEP_SECONDS) + steps)


def next_step(clock: list[float]) -> None:
    clock[0] += mfa.STEP_SECONDS


def sign_in(client, email: str = "hr@example.com", password: str = PASSWORD, **extra):
    client.cookies.clear()
    return client.post("/api/auth/login", json={"email": email, "password": password, **extra})


def bearer(response) -> dict[str, str]:
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def row(email: str = "hr@example.com") -> User:
    with SessionLocal() as db:
        return db.scalar(select(User).where(User.email == email))


def actions() -> list[str]:
    with SessionLocal() as db:
        return list(db.scalars(select(AuditLog.action)))


def enroll(client, headers: dict[str, str], clock: list[float]) -> tuple[str, list[str]]:
    secret = client.post("/api/auth/mfa/setup", headers=headers).json()["secret"]
    response = client.post("/api/auth/mfa/enable", headers=headers, json={"code": totp(secret, clock)})
    assert response.status_code == 200, response.text
    return secret, response.json()["recovery_codes"]


# --- sessions -----------------------------------------------------------------------------------------------------


def test_logging_out_everywhere_invalidates_every_session_and_a_new_login_works(client, make_user):
    make_user()
    first, second = bearer(sign_in(client)), bearer(sign_in(client))
    assert client.get("/api/auth/me", headers=first).status_code == 200
    assert client.post("/api/auth/logout-everywhere", headers=first).status_code == 204
    assert client.get("/api/auth/me", headers=first).status_code == 401
    assert client.get("/api/auth/me", headers=second).status_code == 401
    assert client.get("/api/auth/me").status_code == 401  # the cookie of the requesting browser is gone too
    assert client.get("/api/auth/me", headers=bearer(sign_in(client))).status_code == 200
    assert "auth.sessions_revoked" in actions()


def test_a_token_from_before_session_versions_existed_still_works_until_revoked(client, make_user, settings):
    user = make_user()
    legacy = jwt.encode({"sub": user.id, "exp": datetime.now(timezone.utc) + timedelta(hours=1)}, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    headers = {"Authorization": f"Bearer {legacy}"}
    assert client.get("/api/auth/me", headers=headers).status_code == 200
    client.post("/api/auth/logout-everywhere", headers=headers)
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_logout_everywhere_requires_a_session(client):
    assert client.post("/api/auth/logout-everywhere").status_code == 401


# --- change password ----------------------------------------------------------------------------------------------


def test_changing_the_password_signs_out_other_devices_and_keeps_this_one(client, make_user):
    make_user()
    other_device, this_device = bearer(sign_in(client)), bearer(sign_in(client))
    response = client.post("/api/auth/password", headers=this_device, json={"current_password": PASSWORD, "new_password": NEW_PASSWORD})
    assert response.status_code == 200
    assert client.get("/api/auth/me", headers=other_device).status_code == 401
    assert client.get("/api/auth/me", headers=this_device).status_code == 401  # the old token of this device is replaced...
    assert client.get("/api/auth/me", headers=bearer(response)).status_code == 200  # ...by the fresh one in the response
    assert sign_in(client, password=PASSWORD).status_code == 401
    assert sign_in(client, password=NEW_PASSWORD).status_code == 200
    assert "auth.password_changed" in actions()


def test_changing_the_password_needs_the_current_one_and_a_valid_new_one(client, make_user):
    make_user()
    headers = bearer(sign_in(client))
    wrong = client.post("/api/auth/password", headers=headers, json={"current_password": "not-it", "new_password": NEW_PASSWORD})
    assert wrong.status_code == 400 and wrong.json()["detail"] == "Current password is incorrect"
    assert client.post("/api/auth/password", headers=headers, json={"current_password": PASSWORD, "new_password": "short"}).status_code == 422
    client.cookies.clear()
    assert client.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": NEW_PASSWORD}).status_code == 401
    assert sign_in(client, password=PASSWORD).status_code == 200  # nothing changed


def test_guessing_the_current_password_is_rate_limited(client, make_user, settings, monkeypatch):
    make_user()
    headers = bearer(sign_in(client))
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    codes = [client.post("/api/auth/password", headers=headers, json={"current_password": f"guess-{n}", "new_password": NEW_PASSWORD}).status_code for n in range(6)]
    assert codes == [400] * 5 + [429]


# --- password reset -----------------------------------------------------------------------------------------------


def request_reset(client, email: str = "hr@example.com"):
    return client.post("/api/auth/password-reset/request", json={"email": email})


def test_reset_request_answers_the_same_for_every_address_and_emails_only_real_active_accounts(client, make_user, sent_resets):
    make_user("hr@example.com")
    make_user("gone@example.com", active=False)
    answers = [request_reset(client, email) for email in ("hr@example.com", "nobody@example.com", "gone@example.com")]
    assert {(answer.status_code, answer.text) for answer in answers} == {(202, '{"status":"accepted"}')}
    assert [address for address, _ in sent_resets] == ["hr@example.com"]
    assert "auth.password_reset_email_sent" in actions()


def test_a_reset_link_sets_a_new_password_once_and_signs_out_every_device(client, make_user, sent_resets):
    make_user()
    session = bearer(sign_in(client))
    request_reset(client)
    token = sent_resets[0][1]
    done = client.post("/api/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PASSWORD})
    assert done.status_code == 204
    assert client.get("/api/auth/me", headers=session).status_code == 401
    assert sign_in(client, password=PASSWORD).status_code == 401
    assert sign_in(client, password=NEW_PASSWORD).status_code == 200
    again = client.post("/api/auth/password-reset/confirm", json={"token": token, "new_password": "Third-Pass-789!"})
    assert again.status_code == 400
    assert sign_in(client, password=NEW_PASSWORD).status_code == 200
    assert "auth.password_reset" in actions()


def test_the_database_holds_only_a_hash_of_the_reset_token(client, make_user, sent_resets):
    make_user()
    request_reset(client)
    token = sent_resets[0][1]
    stored = row()
    assert stored.password_reset_hash and token not in stored.password_reset_hash and len(stored.password_reset_hash) == 64


def test_an_expired_or_unknown_or_replaced_link_is_refused(client, make_user, sent_resets):
    make_user()
    request_reset(client)
    request_reset(client)
    old, new = sent_resets[0][1], sent_resets[1][1]
    body = {"new_password": NEW_PASSWORD}
    assert client.post("/api/auth/password-reset/confirm", json={"token": old} | body).status_code == 400  # replaced by the newer link
    assert client.post("/api/auth/password-reset/confirm", json={"token": "x" * 43} | body).status_code == 400
    assert client.post("/api/auth/password-reset/confirm", json={"token": "short"} | body).status_code == 422
    with SessionLocal() as db:
        user = db.scalar(select(User))
        user.password_reset_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
    expired = client.post("/api/auth/password-reset/confirm", json={"token": new} | body)
    assert expired.status_code == 400 and expired.json()["detail"] == "This reset link is invalid or has expired"
    assert sign_in(client, password=PASSWORD).status_code == 200  # the password never changed


def test_a_deactivated_account_cannot_use_a_link_it_was_sent_earlier(client, make_user, sent_resets):
    make_user()
    request_reset(client)
    with SessionLocal() as db:
        db.scalar(select(User)).is_active = False
        db.commit()
    assert client.post("/api/auth/password-reset/confirm", json={"token": sent_resets[0][1], "new_password": NEW_PASSWORD}).status_code == 400


def test_changing_the_password_normally_cancels_an_outstanding_reset_link(client, make_user, sent_resets):
    make_user()
    request_reset(client)
    headers = bearer(sign_in(client))
    client.post("/api/auth/password", headers=headers, json={"current_password": PASSWORD, "new_password": NEW_PASSWORD})
    assert client.post("/api/auth/password-reset/confirm", json={"token": sent_resets[0][1], "new_password": "Third-Pass-789!"}).status_code == 400


def test_reset_requests_are_rate_limited_per_address(client, make_user, settings, monkeypatch):
    make_user()
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    assert [request_reset(client).status_code for _ in range(4)] == [202, 202, 202, 429]
    assert request_reset(client, "someone-else@example.com").status_code == 202  # another address is not affected


def test_the_owner_sees_reset_requests_and_failed_second_steps_in_their_own_log(client, make_user, clock):
    make_user()
    headers = bearer(sign_in(client))
    enroll(client, headers, clock)
    request_reset(client)
    sign_in(client, code="000000")
    log = [entry["action"] for entry in client.get("/api/audit-logs", headers=headers).json()]
    assert "auth.password_reset_requested" in log and "auth.login_failed" in log


def test_a_failed_reset_email_is_audited_and_does_not_break_the_request(client, make_user, monkeypatch):
    def broken(*args):
        raise OSError("smtp is down")

    monkeypatch.setattr("app.email.send_password_reset", broken)
    make_user()
    assert request_reset(client).status_code == 202
    assert "auth.password_reset_email_failed" in actions() and "auth.password_reset_email_sent" not in actions()


def test_the_reset_email_is_albanian_with_one_link_and_an_english_line(settings):
    message = build_password_reset("ada@example.com", "Ada", "tok-123")
    body = message.get_content()
    assert message["To"] == "ada@example.com" and message["Subject"] == "Ndrysho fjalëkalimin e NemoGuardHR"
    assert f"{settings.public_app_url}/reset-password?token=tok-123" in body
    assert "Përshëndetje Ada" in body and "60 minuta" in body and "English:" in body
    assert body.count("http") == 1


# --- two-step verification ----------------------------------------------------------------------------------------


def test_totp_matches_the_rfc_6238_test_vector():
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"  # the RFC's ASCII secret 12345678901234567890
    assert mfa.code_for_step(secret, 59 // 30) == "287082"  # the RFC lists 94287082 (8 digits) at T=59


def test_setup_gives_a_secret_and_the_second_step_only_counts_after_a_valid_code(client, make_user, clock):
    make_user()
    headers = bearer(sign_in(client))
    setup = client.post("/api/auth/mfa/setup", headers=headers).json()
    assert len(setup["secret"]) == 32 and setup["otpauth_uri"].startswith("otpauth://totp/NemoGuardHR:hr%40example.com?secret=" + setup["secret"])
    assert client.get("/api/auth/me", headers=headers).json()["mfa_enabled"] is False
    wrong = client.post("/api/auth/mfa/enable", headers=headers, json={"code": "000000"})
    assert wrong.status_code == 400 and wrong.json()["detail"] == "Verification code is incorrect"
    assert sign_in(client).status_code == 200  # still no second step
    enabled = client.post("/api/auth/mfa/enable", headers=headers, json={"code": totp(setup["secret"], clock)})
    assert enabled.status_code == 200 and len(enabled.json()["recovery_codes"]) == mfa.RECOVERY_CODE_COUNT
    me = client.get("/api/auth/me", headers=headers).json()
    assert me["mfa_enabled"] is True and "mfa_secret" not in me and "mfa_recovery_hashes" not in me
    assert "auth.mfa_enabled" in actions()


def test_setup_and_enable_refuse_to_run_twice_or_out_of_order(client, make_user, clock):
    make_user()
    headers = bearer(sign_in(client))
    assert client.post("/api/auth/mfa/enable", headers=headers, json={"code": "123456"}).status_code == 409  # no setup yet
    enroll(client, headers, clock)
    assert client.post("/api/auth/mfa/setup", headers=headers).status_code == 409  # would replace a working secret
    assert client.post("/api/auth/mfa/enable", headers=headers, json={"code": "123456"}).status_code == 409


def test_login_asks_for_the_code_after_the_password_and_a_code_works_only_once(client, make_user, clock):
    make_user()
    secret, _ = enroll(client, bearer(sign_in(client)), clock)
    next_step(clock)
    assert sign_in(client, password="wrong").json()["detail"] == "Email or password is incorrect"  # no hint that a second step exists
    missing = sign_in(client)
    assert missing.status_code == 401 and missing.json()["detail"] == "mfa_required" and "set-cookie" not in missing.headers
    wrong = sign_in(client, code="000000")
    assert wrong.status_code == 401 and wrong.json()["detail"] == "Verification code is incorrect" and "set-cookie" not in wrong.headers
    ok = sign_in(client, code=totp(secret, clock))
    assert ok.status_code == 200 and client.get("/api/auth/me").json()["mfa_enabled"] is True
    assert sign_in(client, code=totp(secret, clock)).status_code == 401  # the same code cannot be replayed
    next_step(clock)
    assert sign_in(client, code=totp(secret, clock)).status_code == 200
    failed = [action for action in actions() if action == "auth.login_failed"]
    assert len(failed) == 3  # wrong password, wrong code, replayed code; asking for the code is not a failure


def test_a_code_is_accepted_one_step_either_side_but_no_further(client, make_user, clock):
    make_user()
    secret, _ = enroll(client, bearer(sign_in(client)), clock)
    next_step(clock)
    next_step(clock)
    assert sign_in(client, code=totp(secret, clock, steps=-3)).status_code == 401
    assert sign_in(client, code=totp(secret, clock, steps=2)).status_code == 401
    assert sign_in(client, code=totp(secret, clock, steps=-1)).status_code == 200
    assert sign_in(client, code=totp(secret, clock, steps=1)).status_code == 200


def test_a_recovery_code_works_once_in_any_spelling(client, make_user, clock):
    make_user()
    _, codes = enroll(client, bearer(sign_in(client)), clock)
    spelled = codes[0].upper().replace("-", " ")
    assert sign_in(client, code=spelled).status_code == 200
    assert sign_in(client, code=codes[0]).status_code == 401
    assert sign_in(client, code=codes[1]).status_code == 200
    assert len(row().mfa_recovery_hashes) == mfa.RECOVERY_CODE_COUNT - 2


def test_recovery_codes_are_stored_only_as_hashes(client, make_user, clock):
    make_user()
    _, codes = enroll(client, bearer(sign_in(client)), clock)
    stored = row().mfa_recovery_hashes
    assert len(stored) == len(codes) and not set(stored) & {code.replace("-", "") for code in codes} and not set(stored) & set(codes)


def test_guessing_the_code_is_rate_limited_per_account(client, make_user, clock, settings, monkeypatch):
    make_user()
    enroll(client, bearer(sign_in(client)), clock)
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    assert [sign_in(client, code=f"00000{n}").status_code for n in range(6)] == [401] * 5 + [429]


def test_turning_it_off_needs_the_password_and_a_current_code(client, make_user, clock):
    make_user()
    headers = bearer(sign_in(client))
    secret, _ = enroll(client, headers, clock)
    next_step(clock)
    assert client.post("/api/auth/mfa/disable", headers=headers, json={"password": "wrong", "code": totp(secret, clock)}).status_code == 400
    assert client.post("/api/auth/mfa/disable", headers=headers, json={"password": PASSWORD, "code": "000000"}).status_code == 400
    assert row().mfa_enabled is True
    assert client.post("/api/auth/mfa/disable", headers=headers, json={"password": PASSWORD, "code": totp(secret, clock)}).status_code == 204
    stored = row()
    assert not stored.mfa_enabled and stored.mfa_secret is None and stored.mfa_recovery_hashes is None
    assert sign_in(client).status_code == 200  # no second step any more
    assert client.post("/api/auth/mfa/disable", headers=headers, json={"password": PASSWORD, "code": "123456"}).status_code == 409
    assert "auth.mfa_disabled" in actions()


def test_resetting_the_password_does_not_switch_the_second_step_off(client, make_user, clock, sent_resets):
    make_user()
    secret, _ = enroll(client, bearer(sign_in(client)), clock)
    request_reset(client)
    client.post("/api/auth/password-reset/confirm", json={"token": sent_resets[0][1], "new_password": NEW_PASSWORD})
    assert row().mfa_enabled is True
    next_step(clock)
    assert sign_in(client, password=NEW_PASSWORD).json()["detail"] == "mfa_required"
    assert sign_in(client, password=NEW_PASSWORD, code=totp(secret, clock)).status_code == 200


# --- administrators -----------------------------------------------------------------------------------------------


def test_administrators_must_enrol_before_using_admin_features_but_are_never_locked_out(client, make_user, login, clock, settings, monkeypatch):
    monkeypatch.setattr(settings, "require_admin_mfa", True)
    make_user("admin@example.com", role="admin")
    headers = login("admin@example.com")  # signing in still works
    new_user = {"email": "new@example.com", "password": PASSWORD, "full_name": "New Person", "role": "hr"}
    assert client.get("/api/auth/me", headers=headers).json()["mfa_setup_required"] is True
    blocked = client.post("/api/auth/users", headers=headers, json=new_user)
    assert blocked.status_code == 403 and "two-step verification" in blocked.json()["detail"].lower()
    enroll(client, headers, clock)  # ...and they can enrol
    assert client.get("/api/auth/me", headers=headers).json()["mfa_setup_required"] is False
    assert client.post("/api/auth/users", headers=headers, json=new_user).status_code == 201


def test_the_requirement_does_not_apply_to_hr_users_or_when_switched_off(client, make_user, login, settings, monkeypatch):
    make_user("hr@example.com")
    make_user("admin@example.com", role="admin")
    hr_headers, admin_headers = login("hr@example.com"), login("admin@example.com")
    monkeypatch.setattr(settings, "require_admin_mfa", True)
    assert client.get("/api/auth/me", headers=hr_headers).json()["mfa_setup_required"] is False
    monkeypatch.setattr(settings, "require_admin_mfa", False)
    assert client.get("/api/auth/me", headers=admin_headers).json()["mfa_setup_required"] is False
    new_user = {"email": "new@example.com", "password": PASSWORD, "full_name": "New Person", "role": "hr"}
    assert client.post("/api/auth/users", headers=admin_headers, json=new_user).status_code == 201


def test_admin_mfa_is_required_in_production_unless_configured_otherwise():
    assert Settings(app_env="development").admin_mfa_required is False
    assert Settings(**PRODUCTION).admin_mfa_required is True
    assert Settings(**PRODUCTION, require_admin_mfa=False).admin_mfa_required is False
    assert Settings(**PRODUCTION, require_admin_mfa="").admin_mfa_required is True  # docker compose passes unset values as ""
