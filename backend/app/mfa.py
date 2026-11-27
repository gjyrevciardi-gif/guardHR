"""Two-step verification with a time-based one-time code (TOTP, RFC 6238), standard library only.

Works with any authenticator app (HMAC-SHA1, 30 s steps, 6 digits). A code is accepted for the current step and
one step either side (clock drift) and never twice: the last accepted step is stored and anything at or before
it is refused. Eight single-use recovery codes cover a lost phone; only their keyed hashes are stored.

The TOTP secret has to be readable to check a code, so it is stored encrypted with a key that is not in the database
(app/secrets_box.py); this module only ever handles the plain value.
"""

import base64
import hmac
import secrets
import struct
import time
from hashlib import sha1
from urllib.parse import quote

from .models import User
from .security import keyed_hash

ISSUER = "NemoGuardHR"
STEP_SECONDS = 30
DIGITS = 6
DRIFT_STEPS = 1
RECOVERY_CODE_COUNT = 8


def new_secret() -> str:
    """160 random bits as base32 (32 characters, no padding), the format authenticator apps expect."""
    return base64.b32encode(secrets.token_bytes(20)).decode()


def code_for_step(secret: str, step: int) -> str:
    digest = hmac.new(base64.b32decode(secret), struct.pack(">Q", step), sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{value % 10**DIGITS:0{DIGITS}d}"


def otpauth_uri(email: str, secret: str) -> str:
    return f"otpauth://totp/{quote(ISSUER)}:{quote(email)}?secret={secret}&issuer={quote(ISSUER)}&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}"


def verify_totp(user: User, code: str, now: float | None = None) -> bool:
    """True when `code` is valid now and has not been used; remembers the step so the same code cannot be replayed."""
    if not user.mfa_secret or not (code.isascii() and code.isdigit() and len(code) == DIGITS):
        return False
    current = int((time.time() if now is None else now) // STEP_SECONDS)
    accepted = None
    for step in range(current - DRIFT_STEPS, current + DRIFT_STEPS + 1):
        matches = hmac.compare_digest(code_for_step(user.mfa_secret, step), code)  # no early exit: same work for every guess
        if matches and (user.mfa_last_step is None or step > user.mfa_last_step):
            accepted = step
    if accepted is None:
        return False
    user.mfa_last_step = accepted
    return True


def normalize_recovery_code(code: str) -> str:
    return "".join(code.split()).replace("-", "").lower()


def recovery_hash(user: User, code: str) -> str:
    return keyed_hash("recovery", f"{user.id}:{normalize_recovery_code(code)}")


def issue_recovery_codes(user: User) -> list[str]:
    """Replace the user's recovery codes and return the plain codes. This is the only time they can be shown."""
    codes = [f"{secrets.token_hex(3)}-{secrets.token_hex(3)}" for _ in range(RECOVERY_CODE_COUNT)]
    user.mfa_recovery_hashes = [recovery_hash(user, code) for code in codes]
    return codes


def use_recovery_code(user: User, code: str) -> bool:
    candidate = recovery_hash(user, code)
    remaining = list(user.mfa_recovery_hashes or [])
    match = next((stored for stored in remaining if hmac.compare_digest(stored, candidate)), None)
    if match is None:
        return False
    remaining.remove(match)
    user.mfa_recovery_hashes = remaining  # a new list, so the JSON column is seen as changed
    return True


def check_second_factor(user: User, code: str) -> bool:
    """An authenticator code or an unused recovery code."""
    code = code.strip()
    return verify_totp(user, code) or use_recovery_code(user, code)


def clear(user: User) -> None:
    user.mfa_enabled = False
    user.mfa_secret = None
    user.mfa_last_step = None
    user.mfa_recovery_hashes = None
