from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..email import send_candidate_invite
from ..models import Candidate, InterviewSession, SessionReview, Test, User
from ..schemas import ReviewCreate, ReviewOut, SessionCreate, SessionOut
from ..security import get_current_user
from ..services import audit, session_to_out

router = APIRouter(prefix="/sessions", tags=["sessions"])


def owned_session(db: Session, session_id: str, user: User) -> InterviewSession:
    stmt = select(InterviewSession).options(selectinload(InterviewSession.candidate), selectinload(InterviewSession.events), selectinload(InterviewSession.reviews), selectinload(InterviewSession.test).selectinload(Test.questions)).where(InterviewSession.id == session_id, InterviewSession.created_by == user.id)
    session = db.scalar(stmt)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("", response_model=list[SessionOut])
def list_sessions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    stmt = select(InterviewSession).options(selectinload(InterviewSession.candidate), selectinload(InterviewSession.events), selectinload(InterviewSession.reviews), selectinload(InterviewSession.test).selectinload(Test.questions)).where(InterviewSession.created_by == user.id).order_by(InterviewSession.created_at.desc())
    return [session_to_out(item) for item in db.scalars(stmt).all()]


@router.post("", response_model=SessionOut, status_code=201)
def create_session(payload: SessionCreate, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if payload.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="Expiration must be in the future")
    assigned_test = None
    if payload.test_id:
        assigned_test = db.scalar(select(Test).where(Test.id == payload.test_id, Test.created_by == user.id))
        if not assigned_test:
            raise HTTPException(status_code=404, detail="Test not found")
    candidate_email = payload.candidate_email.lower()
    candidate = db.scalar(select(Candidate).where(Candidate.email == candidate_email))
    if not candidate:
        candidate = Candidate(email=candidate_email, full_name=payload.candidate_name)
        db.add(candidate)
        db.flush()
    else:
        candidate.full_name = payload.candidate_name
    session = InterviewSession(created_by=user.id, candidate_id=candidate.id, test_id=assigned_test.id if assigned_test else None, title=payload.title, expires_at=payload.expires_at, require_screen_share=payload.require_screen_share)
    db.add(session)
    db.flush()
    audit(db, user, request, "session.created", "interview_session", session.id, session.id, {"candidate_id": candidate.id})
    invite_email_sent = False
    invite_email_error = None
    try:
        candidate_link = send_candidate_invite(session)
        invite_email_sent = True
        audit(db, user, request, "participant.invite.email_sent", "call", session.id, session.id, {"participant_email": candidate.email, "participant_link": candidate_link})
    except Exception as exc:
        invite_email_error = str(exc)
        audit(db, user, request, "participant.invite.email_failed", "call", session.id, session.id, {"participant_email": candidate.email, "error": invite_email_error})
    db.commit()
    db.refresh(session)
    session.candidate = candidate
    return session_to_out(session, invite_email_sent=invite_email_sent, invite_email_error=invite_email_error)


@router.get("/{session_id}", response_model=SessionOut)
def get_session(session_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    session = owned_session(db, session_id, user)
    audit(db, user, request, "session.viewed", "interview_session", session.id, session.id)
    db.commit()
    return session_to_out(session, include_details=True)


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
    session.review_status = payload.outcome
    audit(db, user, request, "review.saved", "session_review", review.id, session.id, {"outcome": payload.outcome})
    db.commit()
    db.refresh(review)
    return review
