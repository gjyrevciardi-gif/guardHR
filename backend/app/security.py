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
# Verified against when the email is unknown so login time does not reveal which emails exist.
DUMMY_PASSWORD_HASH = password_hash.hash("not-a-real-password")


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_access_token(user_id: str) -> str:
    settings = get_settings()
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({"sub": user_id, "exp": expires}, settings.jwt_secret, algorithm=settings.jwt_algorithm)


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
    return user if user and user.is_active else None


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
    return user
