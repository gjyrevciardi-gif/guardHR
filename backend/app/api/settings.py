from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import AuditLog, User
from ..ratelimit import rate_limit
from ..retention import purge_user_data
from ..schemas import AuditOut, RetentionUpdate, UserOut
from ..security import get_current_user
from ..services import audit

router = APIRouter(tags=["settings and audit"])


@router.put("/settings/retention", response_model=UserOut)
def update_retention(payload: RetentionUpdate, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    previous = user.retention_days
    user.retention_days = payload.retention_days
    audit(db, user, request, "retention.updated", "user", user.id, details={"previous_days": previous, "retention_days": payload.retention_days})
    db.commit()
    db.refresh(user)
    return user


@router.post("/settings/retention/purge")
def purge_expired_data(request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = purge_user_data(db, user)
    audit(db, user, request, "retention.purge.executed", "integrity_event", details={**result, "cutoff": result["cutoff"].isoformat()})
    db.commit()
    return result


@router.get("/audit-logs", response_model=list[AuditOut])
def list_audit_logs(limit: int = Query(200, ge=1, le=500), offset: int = Query(0, ge=0), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.scalars(select(AuditLog).where(AuditLog.user_id == user.id).order_by(AuditLog.created_at.desc(), AuditLog.id).limit(limit).offset(offset)).all()


@router.get("/rtc-config", dependencies=[Depends(rate_limit("rtc-config", 60, 60))])
def rtc_config():
    """ICE servers for WebRTC, configured at runtime so a TURN relay can be added without rebuilding the frontend."""
    return {"iceServers": get_settings().ice_server_list}
