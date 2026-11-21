"""Email one-time code: proves that whoever holds the interview link can read the invited candidate's mailbox.

It does not prove who the person is. It stops a forwarded or leaked link from being enough on its own.
The code is 6 digits, valid for CODE_TTL_SECONDS, and only its HMAC is stored. Wrong guesses are capped per
code (MAX_ATTEMPTS) and the number of codes per call is capped (MAX_SENDS), so guessing is not practical:
at most MAX_SENDS * MAX_ATTEMPTS tries out of 1,000,000.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException

from .config import get_settings
from .models import InterviewSession
from .signals import as_utc

CODE_DIGITS = 6
CODE_TTL_SECONDS = 600
RESEND_COOLDOWN_SECONDS = 30
MAX_ATTEMPTS = 5
MAX_SENDS = 10


def hash_code(session_id: str, code: str) -> str:
    """Keyed hash bound to the call, so a leaked database does not hand out usable codes."""
    return hmac.new(get_settings().jwt_secret.encode(), f"{session_id}:{code}".encode(), hashlib.sha256).hexdigest()


def mask_email(email: str) -> str:
    """ada@example.com -> a**@example.com: enough for the candidate to recognise the mailbox."""
    local, _, domain = email.partition("@")
    return f"{local[:1]}{'*' * max(len(local) - 1, 2)}@{domain}"


def issue_code(session: InterviewSession, now: datetime | None = None) -> str:
    """Store a fresh code's hash on the session and return the plain code to email. Raises HTTPException when not allowed."""
    now = now or datetime.now(timezone.utc)
    if not session.verify_candidate_email:
        raise HTTPException(status_code=409, detail="Email verification is not required for this call")
    if not session.consented_at:
        raise HTTPException(status_code=403, detail="Consent is required before verification")
    if session.verification_sent_at:
        wait = RESEND_COOLDOWN_SECONDS - (now - as_utc(session.verification_sent_at)).total_seconds()
        if wait > 0:
            raise HTTPException(status_code=429, detail="Wait before requesting another code", headers={"Retry-After": str(int(wait) + 1)})
    if session.verification_sends >= MAX_SENDS:
        raise HTTPException(status_code=429, detail="Too many codes requested. Ask the host for a new link.")
    code = f"{secrets.randbelow(10**CODE_DIGITS):0{CODE_DIGITS}d}"
    session.verification_code_hash = hash_code(session.id, code)
    session.verification_sent_at = now
    session.verification_sends += 1
    session.verification_attempts = 0
    return code


def check_code(session: InterviewSession, code: str, now: datetime | None = None) -> bool:
    """True and the call is marked verified when the code is right. False counts one wrong attempt.

    Raises HTTPException when no usable code exists (none requested, expired, or too many wrong attempts).
    """
    now = now or datetime.now(timezone.utc)
    if not session.verification_code_hash or not session.verification_sent_at:
        raise HTTPException(status_code=409, detail="No code was requested")
    if (now - as_utc(session.verification_sent_at)).total_seconds() > CODE_TTL_SECONDS:
        raise HTTPException(status_code=410, detail="The code has expired. Request a new one.")
    if session.verification_attempts >= MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many wrong attempts. Request a new code.")
    if hmac.compare_digest(session.verification_code_hash, hash_code(session.id, code)):
        session.verified_at = now
        session.verification_code_hash = None  # single use
        return True
    session.verification_attempts += 1
    return False
