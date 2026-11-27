"""Encrypts a secret before it goes into the database and decrypts it on the way out.

The key (SECRETS_ENCRYPTION_KEY, in the environment) is not in the database, so a leaked dump or a read-only SQL
injection does not expose the secret. Used for the TOTP secret (`User.mfa_secret`). Fernet (AES-128-CBC + HMAC-SHA256)
from the `cryptography` package; several comma-separated keys are accepted, the first encrypts and all decrypt, which
is how a key is rotated.

`python -m app.secrets_box` re-encrypts every stored secret with the first key: run it after adding a new first key,
and only then drop the old one.
"""

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from sqlalchemy import String, text
from sqlalchemy.types import TypeDecorator

from .config import get_settings

PREFIX = "enc1:"  # tells an encrypted value from one written before the key existed


@lru_cache
def _cipher(keys: tuple[str, ...]) -> MultiFernet:
    return MultiFernet([Fernet(key) for key in keys])


def encrypt(value: str) -> str:
    keys = tuple(get_settings().encryption_key_list)
    if not keys:  # development only: production refuses to start without a key
        return value
    return PREFIX + _cipher(keys).encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    if not value.startswith(PREFIX):
        return value  # written before there was a key; the next write encrypts it
    keys = tuple(get_settings().encryption_key_list)
    if not keys:
        raise RuntimeError("An encrypted secret is stored but SECRETS_ENCRYPTION_KEY is not set")
    try:
        return _cipher(keys).decrypt(value[len(PREFIX) :].encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError("SECRETS_ENCRYPTION_KEY does not match the key the secret was encrypted with") from exc


class EncryptedString(TypeDecorator):
    """A text column whose value is encrypted at rest. Python code only ever sees the plain value."""

    impl = String(255)  # a 32-character secret becomes 145 characters
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return None if value is None else encrypt(value)

    def process_result_value(self, value, dialect):
        return None if value is None else decrypt(value)


def reencrypt_all(connection) -> int:
    """Encrypt every stored secret with the first key (also the ones stored before there was a key). Returns the count."""
    if not get_settings().encryption_key_list:
        return 0
    rows = connection.execute(text("SELECT id, mfa_secret FROM users WHERE mfa_secret IS NOT NULL")).all()
    for user_id, value in rows:
        connection.execute(text("UPDATE users SET mfa_secret = :value WHERE id = :id"), {"value": encrypt(decrypt(value)), "id": user_id})
    return len(rows)


if __name__ == "__main__":
    from .database import engine

    with engine.begin() as connection:
        print(f"Re-encrypted {reencrypt_all(connection)} secret(s)")
