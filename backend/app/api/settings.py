from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AuditLog, IntegrityEvent, InterviewSession, User
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
    cutoff = datetime.now(timezone.utc) - timedelta(days=user.retention_days)
    session_ids = list(db.scalars(select(InterviewSession.id).where(InterviewSession.created_by == user.id, InterviewSession.ended_at.is_not(None), InterviewSession.ended_at < cutoff)).all())
    count = 0
    if session_ids:
        result = db.execute(delete(IntegrityEvent).where(IntegrityEvent.session_id.in_(session_ids)))
        count = result.rowcount or 0
    audit(db, user, request, "retention.purge.executed", "integrity_event", details={"deleted_events": count, "cutoff": cutoff.isoformat()})
    db.commit()
    return {"deleted_events": count, "cutoff": cutoff}


@router.get("/audit-logs", response_model=list[AuditOut])
def list_audit_logs(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.scalars(select(AuditLog).where(AuditLog.user_id == user.id).order_by(AuditLog.created_at.desc()).limit(200)).all()

