import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import mfa
from ..config import get_settings
from ..database import get_db
from ..email import deliver_password_reset
from ..models import User
from ..ratelimit import hit, rate_limit
from ..schemas import (
    AdminUserCreate,
    LoginRequest,
    MfaCode,
    MfaDisable,
    MfaEnabledOut,
    MfaSetupOut,
    PasswordChange,
    PasswordResetConfirm,
    PasswordResetRequest,
    RegisterRequest,
    TokenResponse,
    UserOut,
)
from ..security import (
    DUMMY_PASSWORD_HASH,
    PASSWORD_RESET_TTL_MINUTES,
    clear_session_cookie,
    create_access_token,
    get_current_user,
    hash_password,
    keyed_hash,
    require_admin,
    set_session_cookie,
    verify_password,
)
from ..services import audit, request_ip
from ..signals import as_utc

router = APIRouter(prefix="/auth", tags=["authentication"])

MFA_REQUIRED = "mfa_required"  # the client answers by asking for the code; the frontend matches this exact string


def token_response(user: User, response: Response) -> TokenResponse:
    token = create_access_token(user.id, user.token_version)
    set_session_cookie(response, token)
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


def create_user(db: Session, payload: RegisterRequest, role: str) -> User:
    email = payload.email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Ky email është i regjistruar")
    user = User(email=email, full_name=payload.full_name, password_hash=hash_password(payload.password), role=role)
    db.add(user)
    db.flush()
    return user


@router.post("/register", response_model=TokenResponse, status_code=201, dependencies=[Depends(rate_limit("register", 10, 3600))])
def register(payload: RegisterRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    if not get_settings().registration_allowed:
        raise HTTPException(status_code=403, detail="Registration is disabled. Ask an administrator for an account.")
    user = create_user(db, payload, "hr")
    audit(db, user, request, "auth.register", "user", user.id)
    db.commit()
    db.refresh(user)
    return token_response(user, response)


@router.post("/users", response_model=UserOut, status_code=201)
def admin_create_user(payload: AdminUserCreate, request: Request, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = create_user(db, payload, payload.role)
    audit(db, admin, request, "user.created", "user", user.id, details={"role": payload.role})
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(rate_limit("login-ip", 30, 60))])
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    email = payload.email.lower()
    hit(f"login-email:{email}", 10, 900)  # slows distributed guessing against one account
    user = db.scalar(select(User).where(User.email == email))
    password_ok = verify_password(payload.password, user.password_hash if user else DUMMY_PASSWORD_HASH)
    if not user or not password_ok or not user.is_active:
        audit(db, None, request, "auth.login_failed", "user", user.id if user else None)
        db.commit()
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    if user.mfa_enabled:
        # Only reached with the right password, so asking for the code reveals nothing to someone who does not have it.
        if not payload.code:
            raise HTTPException(status_code=401, detail=MFA_REQUIRED)
        hit(f"mfa:{user.id}", 5, 300)
        if not mfa.check_second_factor(user, payload.code):
            audit(db, user, request, "auth.login_failed", "user", user.id, details={"reason": "second_factor"})  # the password was right: worth showing the owner
            db.commit()
            raise HTTPException(status_code=401, detail="Verification code is incorrect")
    audit(db, user, request, "auth.login", "user", user.id)
    db.commit()  # also stores the used code's step or the spent recovery code
    return token_response(user, response)


@router.post("/logout", status_code=204)
def logout(response: Response):
    clear_session_cookie(response)


@router.post("/logout-everywhere", status_code=204)
def logout_everywhere(request: Request, response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Invalidate every session token of this user, including the one making the request."""
    user.token_version += 1
    audit(db, user, request, "auth.sessions_revoked", "user", user.id)
    db.commit()
    clear_session_cookie(response)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/password", response_model=TokenResponse)
def change_password(payload: PasswordChange, request: Request, response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Change the password and sign out every other device; this one gets a fresh session."""
    hit(f"password:{user.id}", 5, 900)
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    user.password_reset_hash = None
    user.password_reset_expires_at = None
    user.token_version += 1
    audit(db, user, request, "auth.password_changed", "user", user.id)
    db.commit()
    return token_response(user, response)


@router.post("/password-reset/request", status_code=202, dependencies=[Depends(rate_limit("reset-ip", 5, 3600))])
def request_password_reset(payload: PasswordResetRequest, request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Always answers the same way, so it cannot be used to find out which emails have an account."""
    email = payload.email.lower()
    hit(f"reset-email:{email}", 3, 3600)
    user = db.scalar(select(User).where(User.email == email))
    if user and user.is_active:
        token = secrets.token_urlsafe(32)
        user.password_reset_hash = keyed_hash("password-reset", token)  # replaces any earlier link
        user.password_reset_expires_at = datetime.now(timezone.utc) + timedelta(minutes=PASSWORD_RESET_TTL_MINUTES)
        audit(db, user, request, "auth.password_reset_requested", "user", user.id)  # visible to the owner, with the requester's address
        db.commit()
        background.add_task(deliver_password_reset, user.id, user.email, user.full_name, token, request_ip(request))
    return {"status": "accepted"}


@router.post("/password-reset/confirm", status_code=204, dependencies=[Depends(rate_limit("reset-confirm-ip", 10, 3600))])
def confirm_password_reset(payload: PasswordResetConfirm, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.password_reset_hash == keyed_hash("password-reset", payload.token)))
    expired = not user or not user.password_reset_expires_at or as_utc(user.password_reset_expires_at) < datetime.now(timezone.utc)
    if not user or expired or not user.is_active:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired")
    user.password_hash = hash_password(payload.new_password)
    user.password_reset_hash = None  # single use
    user.password_reset_expires_at = None
    user.token_version += 1
    audit(db, user, request, "auth.password_reset", "user", user.id)
    db.commit()


@router.post("/mfa/setup", response_model=MfaSetupOut)
def mfa_setup(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Start enrolment with a fresh secret. It only counts once /mfa/enable has seen a valid code from it."""
    if user.mfa_enabled:
        raise HTTPException(status_code=409, detail="Two-step verification is already on")
    user.mfa_secret = mfa.new_secret()
    user.mfa_last_step = None
    db.commit()
    return MfaSetupOut(secret=user.mfa_secret, otpauth_uri=mfa.otpauth_uri(user.email, user.mfa_secret))


@router.post("/mfa/enable", response_model=MfaEnabledOut)
def mfa_enable(payload: MfaCode, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.mfa_enabled:
        raise HTTPException(status_code=409, detail="Two-step verification is already on")
    if not user.mfa_secret:
        raise HTTPException(status_code=409, detail="Start the setup first")
    hit(f"mfa:{user.id}", 5, 300)
    if not mfa.verify_totp(user, payload.code.strip()):
        raise HTTPException(status_code=400, detail="Verification code is incorrect")
    user.mfa_enabled = True
    codes = mfa.issue_recovery_codes(user)
    audit(db, user, request, "auth.mfa_enabled", "user", user.id)
    db.commit()
    return MfaEnabledOut(recovery_codes=codes)


@router.post("/mfa/disable", status_code=204)
def mfa_disable(payload: MfaDisable, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Needs the password and a current code, so a stolen session alone cannot turn the second step off."""
    if not user.mfa_enabled:
        raise HTTPException(status_code=409, detail="Two-step verification is not on")
    hit(f"mfa:{user.id}", 5, 300)
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if not mfa.check_second_factor(user, payload.code):
        raise HTTPException(status_code=400, detail="Verification code is incorrect")
    mfa.clear(user)
    audit(db, user, request, "auth.mfa_disabled", "user", user.id)
    db.commit()
