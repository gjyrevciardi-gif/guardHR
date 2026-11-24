import hashlib
import hmac
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer
from jwt import InvalidTokenError
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_db
from .enums import UserRole
from .models import User

password_hash = PasswordHash.recommended()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
PASSWORD_RESET_TTL_MINUTES = 60
# Verified against when the email is unknown so login time does not reveal which emails exist.
DUMMY_PASSWORD_HASH = password_hash.hash("not-a-real-password")


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def keyed_hash(purpose: str, value: str) -> str:
    """HMAC of a secret the user holds (reset token, recovery code), so a leaked database does not hand out usable ones.

    Changing JWT_SECRET invalidates every outstanding reset link and recovery code, as it does every session.
    """
    return hmac.new(get_settings().jwt_secret.encode(), f"{purpose}:{value}".encode(), hashlib.sha256).hexdigest()


EXAM_ATTEMPT_HOURS = 6


def create_exam_attempt(test_id: str, name: str, email: str, hours: float = EXAM_ATTEMPT_HOURS) -> str:
    """Proof that someone started a public exam as `name` / `email`. Stateless, so nothing is stored until they submit.

    Signed with a key derived for this purpose, so it can never pass as a login token, nor a login token as this.
    ponytail: no attempts table, so no per-attempt time limit and a candidate can start again; add one if a limit is needed.
    """
    settings = get_settings()
    expires = datetime.now(timezone.utc) + timedelta(hours=hours)
    return jwt.encode({"sub": test_id, "name": name, "email": email, "exp": expires}, keyed_hash("exam-attempt", "key"), algorithm=settings.jwt_algorithm)


def read_exam_attempt(token: str | None, test_id: str) -> dict:
    """The claims of a valid attempt for this test, or a 400 saying to start again."""
    if not token:
        raise HTTPException(status_code=400, detail="Start the test before submitting it")
    try:
        claims = jwt.decode(token, keyed_hash("exam-attempt", "key"), algorithms=[get_settings().jwt_algorithm])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=400, detail="This attempt has expired. Start the test again") from None
    except InvalidTokenError:
        raise HTTPException(status_code=400, detail="Start the test before submitting it") from None
    if claims.get("sub") != test_id:
        raise HTTPException(status_code=400, detail="Start the test before submitting it")
    return claims


def create_access_token(user_id: str, token_version: int = 0) -> str:
    settings = get_settings()
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({"sub": user_id, "tv": token_version, "exp": expires}, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.jwt_expire_minutes * 60,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(settings.session_cookie_name, path="/", httponly=True, secure=settings.cookie_secure, samesite="lax")


def user_from_token(db: Session, token: str | None) -> User | None:
    """Resolve a JWT to an active user. Shared by HTTP routes and the WebSocket handshake."""
    settings = get_settings()
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except InvalidTokenError:
        return None
    user_id = payload.get("sub")
    user = db.get(User, user_id) if user_id else None
    if not user or not user.is_active:
        return None
    # Tokens issued before versions existed have no claim and count as 0, the starting version.
    return user if payload.get("tv", 0) == user.token_version else None


def get_current_user(request: Request, bearer: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    settings = get_settings()
    cookie_token = None if bearer else request.cookies.get(settings.session_cookie_name)
    user = user_from_token(db, bearer or cookie_token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication credentials")
    # Cookie auth is ambient, so state-changing requests must come from an allowed origin (CSRF defence in depth on top of SameSite=Lax).
    if cookie_token and request.method not in SAFE_METHODS and request.headers.get("origin") not in settings.allowed_origins:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cross-origin request blocked")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    if get_settings().admin_mfa_required and not user.mfa_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enable two-step verification in Settings before using administrator features")
    return user
