from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..email import deliver_invite
from ..enums import ReviewStatus
from ..models import AuditLog, Candidate, IntegrityEvent, InterviewSession, SessionReview, Test, TestQuestion, User
from ..retention import delete_session
from ..schemas import NotesOut, NotesUpdate, ReviewCreate, ReviewOut, SessionCreate, SessionOut
from ..security import get_current_user
from ..services import audit, parse_uuid, request_ip, session_to_out

router = APIRouter(prefix="/sessions", tags=["sessions"])

# The host page polls this endpoint every few seconds; one audit row per hour records access without flooding the log.
VIEW_AUDIT_INTERVAL = timedelta(hours=1)


def owned_session(db: Session, session_id: str, user: User) -> InterviewSession:
    stmt = select(InterviewSession).options(selectinload(InterviewSession.candidate), selectinload(InterviewSession.events), selectinload(InterviewSession.reviews), selectinload(InterviewSession.test).selectinload(Test.questions)).where(InterviewSession.id == parse_uuid(session_id, "Session not found"), InterviewSession.created_by == user.id)
    session = db.scalar(stmt)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("", response_model=list[SessionOut])
def list_sessions(limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Counts come from correlated subqueries so the list never loads every event and question.
    event_count = select(func.count(IntegrityEvent.id)).where(IntegrityEvent.session_id == InterviewSession.id).correlate(InterviewSession).scalar_subquery()
    max_severity = select(func.max(IntegrityEvent.severity)).where(IntegrityEvent.session_id == InterviewSession.id).correlate(InterviewSession).scalar_subquery()
    question_count = select(func.count(TestQuestion.id)).where(TestQuestion.test_id == InterviewSession.test_id).correlate(InterviewSession).scalar_subquery()
    stmt = (
        select(InterviewSession, event_count, question_count, max_severity)
        .options(selectinload(InterviewSession.candidate), selectinload(InterviewSession.test))
        .where(InterviewSession.created_by == user.id)
        .order_by(InterviewSession.created_at.desc(), InterviewSession.id)
        .limit(limit)
        .offset(offset)
    )
    return [session_to_out(item, event_count=events, question_count=questions, max_severity=severity) for item, events, questions, severity in db.execute(stmt).all()]


@router.post("", response_model=SessionOut, status_code=201)
def create_session(payload: SessionCreate, request: Request, background: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    expires_at = payload.expires_at if payload.expires_at.tzinfo else payload.expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="Expiration must be in the future")
    assigned_test = None
    if payload.test_id:
        assigned_test = db.scalar(select(Test).where(Test.id == parse_uuid(payload.test_id, "Test not found"), Test.created_by == user.id))
        if not assigned_test:
            raise HTTPException(status_code=404, detail="Test not found")
    candidate_email = payload.candidate_email.lower()
    # Candidates are private to the HR user who invited them: never reuse or rename another user's record.
    candidate = db.scalar(select(Candidate).where(Candidate.created_by == user.id, Candidate.email == candidate_email))
    if not candidate:
        candidate = Candidate(created_by=user.id, email=candidate_email, full_name=payload.candidate_name)
        db.add(candidate)
        db.flush()
    else:
        candidate.full_name = payload.candidate_name
    session = InterviewSession(created_by=user.id, candidate_id=candidate.id, test_id=assigned_test.id if assigned_test else None, title=payload.title, expires_at=expires_at, require_screen_share=payload.require_screen_share, verify_candidate_email=payload.verify_candidate_email)
    db.add(session)
    db.flush()
    audit(db, user, request, "session.created", "interview_session", session.id, session.id, {"candidate_id": candidate.id})
    db.commit()
    db.refresh(session)
    # Sent after the response: SMTP latency or failure must neither block the HR user nor roll back the session.
    background.add_task(deliver_invite, session.id, user.id, request_ip(request))
    session.candidate = candidate
    return session_to_out(session, invite_email_queued=True)


@router.get("/{session_id}", response_model=SessionOut)
def get_session(session_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    session = owned_session(db, session_id, user)
    recently_viewed = db.scalar(select(AuditLog.id).where(AuditLog.user_id == user.id, AuditLog.session_id == session.id, AuditLog.action == "session.viewed", AuditLog.created_at > datetime.now(timezone.utc) - VIEW_AUDIT_INTERVAL).limit(1))
    if not recently_viewed:
        audit(db, user, request, "session.viewed", "interview_session", session.id, session.id)
        db.commit()
    return session_to_out(session, include_details=True)


@router.delete("/{session_id}", status_code=204)
def remove_session(session_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    session = owned_session(db, session_id, user)
    deleted_id = session.id
    delete_session(db, session)
    audit(db, user, request, "session.deleted", "interview_session", deleted_id)
    db.commit()


@router.post("/{session_id}/reviews", response_model=ReviewOut)
def save_review(session_id: str, payload: ReviewCreate, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    session = owned_session(db, session_id, user)
    review = db.scalar(select(SessionReview).where(SessionReview.session_id == session.id, SessionReview.reviewer_id == user.id))
    if review:
        review.notes = payload.notes
        review.outcome = payload.outcome
        review.updated_at = datetime.now(timezone.utc)
    else:
        review = SessionReview(session_id=session.id, reviewer_id=user.id, notes=payload.notes, outcome=payload.outcome)
        db.add(review)
    session.review_status = ReviewStatus(payload.outcome.value)
    audit(db, user, request, "review.saved", "session_review", review.id, session.id, {"outcome": payload.outcome.value})
    db.commit()
    db.refresh(review)
    return review


@router.put("/{session_id}/notes", response_model=NotesOut)
def save_notes(session_id: str, payload: NotesUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Autosaved private notes. Not audited per save (it would flood the log); they stay until the call is deleted, like reviews."""
    session = owned_session(db, session_id, user)
    session.host_notes = payload.notes or None
    saved_at = datetime.now(timezone.utc)
    session.updated_at = saved_at
    db.commit()
    return NotesOut(saved_at=saved_at)
