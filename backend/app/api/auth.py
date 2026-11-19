from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import User
from ..ratelimit import hit, rate_limit
from ..schemas import AdminUserCreate, LoginRequest, RegisterRequest, TokenResponse, UserOut
from ..security import DUMMY_PASSWORD_HASH, clear_session_cookie, create_access_token, get_current_user, hash_password, require_admin, set_session_cookie, verify_password
from ..services import audit

router = APIRouter(prefix="/auth", tags=["authentication"])


def token_response(user: User, response: Response) -> TokenResponse:
    token = create_access_token(user.id)
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
    audit(db, user, request, "auth.login", "user", user.id)
    db.commit()
    return token_response(user, response)


@router.post("/logout", status_code=204)
def logout(response: Response):
    clear_session_cookie(response)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
