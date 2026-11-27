"""The TOTP secret is encrypted at rest with a key that is not in the database (app/secrets_box.py)."""

import pytest
from cryptography.fernet import Fernet
from pydantic import ValidationError
from sqlalchemy import select, text
from test_account_security import bearer, clock, enroll, sign_in, totp  # noqa: F401  (clock is a fixture)

from app import secrets_box
from app.config import Settings
from app.database import SessionLocal, engine
from app.models import User
from helpers import PASSWORD

KEY = Fernet.generate_key().decode()
OTHER_KEY = Fernet.generate_key().decode()
SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"


@pytest.fixture
def keyed(settings, monkeypatch):
    monkeypatch.setattr(settings, "secrets_encryption_key", KEY)


def stored_value(email: str = "hr@example.com") -> str:
    """What is in the column itself, bypassing the model's decryption."""
    with engine.connect() as connection:
        return connection.execute(text("SELECT mfa_secret FROM users WHERE email = :email"), {"email": email}).scalar_one()


def test_a_secret_round_trips_and_the_database_never_holds_it_in_the_clear(keyed, make_user):
    make_user()
    with SessionLocal() as db:
        db.scalar(select(User)).mfa_secret = SECRET
        db.commit()
    raw = stored_value()
    assert raw.startswith(secrets_box.PREFIX) and SECRET not in raw
    with SessionLocal() as db:
        assert db.scalar(select(User)).mfa_secret == SECRET


def test_every_encryption_of_the_same_secret_differs(keyed):
    assert secrets_box.encrypt(SECRET) != secrets_box.encrypt(SECRET)


def test_a_secret_stored_before_there_was_a_key_still_reads_and_is_encrypted_by_reencrypt_all(settings, make_user, monkeypatch):
    make_user()
    with SessionLocal() as db:
        db.scalar(select(User)).mfa_secret = SECRET  # no key configured: stored as is
        db.commit()
    assert stored_value() == SECRET
    monkeypatch.setattr(settings, "secrets_encryption_key", KEY)
    with SessionLocal() as db:
        assert db.scalar(select(User)).mfa_secret == SECRET  # a key arriving later does not break reading
    with engine.begin() as connection:
        assert secrets_box.reencrypt_all(connection) == 1
    assert stored_value().startswith(secrets_box.PREFIX)
    with SessionLocal() as db:
        assert db.scalar(select(User)).mfa_secret == SECRET


def test_a_rotated_key_decrypts_old_values_and_reencrypt_all_moves_them_to_the_new_one(settings, make_user, monkeypatch):
    make_user()
    monkeypatch.setattr(settings, "secrets_encryption_key", OTHER_KEY)
    with SessionLocal() as db:
        db.scalar(select(User)).mfa_secret = SECRET
        db.commit()
    old = stored_value()
    monkeypatch.setattr(settings, "secrets_encryption_key", f"{KEY},{OTHER_KEY}")  # new key first, old one still listed
    with SessionLocal() as db:
        assert db.scalar(select(User)).mfa_secret == SECRET
    with engine.begin() as connection:
        secrets_box.reencrypt_all(connection)
    assert stored_value() != old
    monkeypatch.setattr(settings, "secrets_encryption_key", KEY)  # the old key can now be dropped
    with SessionLocal() as db:
        assert db.scalar(select(User)).mfa_secret == SECRET


def test_a_wrong_or_missing_key_is_a_clear_error_not_a_wrong_secret(settings, make_user, monkeypatch):
    make_user()
    monkeypatch.setattr(settings, "secrets_encryption_key", KEY)
    with SessionLocal() as db:
        db.scalar(select(User)).mfa_secret = SECRET
        db.commit()
    monkeypatch.setattr(settings, "secrets_encryption_key", OTHER_KEY)
    with pytest.raises(RuntimeError, match="does not match"), SessionLocal() as db:
        _ = db.scalar(select(User)).mfa_secret
    monkeypatch.setattr(settings, "secrets_encryption_key", "")
    with pytest.raises(RuntimeError, match="not set"), SessionLocal() as db:
        _ = db.scalar(select(User)).mfa_secret


def test_two_step_verification_works_end_to_end_with_the_secret_encrypted(client, keyed, make_user, clock):  # noqa: F811
    make_user()
    secret, _ = enroll(client, bearer(sign_in(client)), clock)
    assert stored_value().startswith(secrets_box.PREFIX) and secret not in stored_value()
    clock[0] += 30
    assert sign_in(client).json()["detail"] == "mfa_required"
    assert sign_in(client, code=totp(secret, clock)).status_code == 200
    assert sign_in(client, password=PASSWORD, code="000000").status_code == 401


def test_the_key_must_be_valid_and_production_requires_one():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, secrets_encryption_key="not-a-key")
    with pytest.raises(ValidationError):
        Settings(_env_file=None, secrets_encryption_key=f"{KEY},not-a-key")
    assert Settings(_env_file=None, secrets_encryption_key=f" {KEY} , {OTHER_KEY} ").encryption_key_list == [KEY, OTHER_KEY]
    assert Settings(_env_file=None, secrets_encryption_key="").encryption_key_list == []  # development: plain text is allowed
