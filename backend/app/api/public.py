from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..enums import ReviewStatus, SessionStatus
from ..models import IntegrityEvent, InterviewSession, Test, TestQuestion, TestSubmission
from ..ratelimit import rate_limit
from ..schemas import ConsentRequest, EventCreate, EventOut, PublicSessionOut, PublicTestOut, TestSubmissionOut, TestSubmit
from ..services import audit, parse_uuid, request_ip
from ..vision import detect_objects
from .signaling import broadcast_to_role
from .tests import grade_answers

MAX_EVENTS_PER_SESSION = 2000
MAX_FRAME_BYTES = 2_500_000

router = APIRouter(prefix="/public/sessions", tags=["candidate"], dependencies=[Depends(rate_limit("public", 240, 60))])


def public_session(db: Session, token: str) -> InterviewSession:
    session = db.scalar(
        select(InterviewSession)
        .options(selectinload(InterviewSession.candidate), selectinload(InterviewSession.test).selectinload(Test.questions))
        .where(InterviewSession.public_token == parse_uuid(token, "Interview link is invalid"))
    )
    if not session:
        raise HTTPException(status_code=404, detail="Interview link is invalid")
    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    # Only a link that was never started can expire: a call that is already running must keep recording.
    if expires < datetime.now(timezone.utc) and session.status in (SessionStatus.scheduled, SessionStatus.consented):
        session.status = SessionStatus.expired
        db.commit()
    return session


def require_in_progress(session: InterviewSession) -> None:
    if session.status != SessionStatus.in_progress:
        raise HTTPException(status_code=409, detail="Session is not in progress")


def to_public_out(session: InterviewSession) -> PublicSessionOut:
    return PublicSessionOut(
        title=session.title,
        candidate_name=session.candidate.full_name,
        status=session.status,
        require_screen_share=session.require_screen_share,
        expires_at=session.expires_at,
        consented_at=session.consented_at,
        test=PublicTestOut.from_test(session.test) if session.test else None,
    )


@router.get("/{token}", response_model=PublicSessionOut)
def get_public_session(token: str, db: Session = Depends(get_db)):
    return to_public_out(public_session(db, token))


@router.post("/{token}/consent", response_model=PublicSessionOut)
def consent(token: str, payload: ConsentRequest, request: Request, db: Session = Depends(get_db)):
    session = public_session(db, token)
    if session.status == SessionStatus.expired:
        raise HTTPException(status_code=410, detail="Interview link has expired")
    if session.status == SessionStatus.completed:
        raise HTTPException(status_code=409, detail="Session is already completed")
    if not payload.accepted:
        raise HTTPException(status_code=422, detail="Explicit consent is required")
    # Idempotent: replaying consent never rewrites the stored consent evidence or rewinds the status.
    if session.consented_at is None:
        session.consented_at = datetime.now(timezone.utc)
        session.consent_ip = request_ip(request)
        audit(db, None, request, "candidate.consent.accepted", "interview_session", session.id, session.id)
    if session.status == SessionStatus.scheduled:
        session.status = SessionStatus.consented
    db.commit()
    return to_public_out(session)


@router.post("/{token}/test-submission", response_model=TestSubmissionOut, status_code=201, dependencies=[Depends(rate_limit("session-test", 10, 60, "token"))])
def submit_test(token: str, payload: TestSubmit, request: Request, db: Session = Depends(get_db)):
    session = public_session(db, token)
    require_in_progress(session)
    if not session.test:
        raise HTTPException(status_code=404, detail="No test is assigned to this session")
    if db.scalar(select(TestSubmission.id).where(TestSubmission.session_id == session.id)):
        raise HTTPException(status_code=409, detail="Test was already submitted")

    questions = db.scalars(select(TestQuestion).where(TestQuestion.test_id == session.test.id).order_by(TestQuestion.position)).all()
    checked_answers, score, total = grade_answers(list(questions), payload.answers)
    submission = TestSubmission(session_id=session.id, test_id=session.test.id, answers=checked_answers, score=score, total=total)
    db.add(submission)
    audit(db, None, request, "candidate.test.submitted", "test_submission", submission.id, session.id, {"score": score, "total": total})
    db.commit()
    db.refresh(submission)
    return TestSubmissionOut.model_validate(submission)


@router.post("/{token}/start", status_code=204)
def start(token: str, request: Request, db: Session = Depends(get_db)):
    session = public_session(db, token)
    if session.status == SessionStatus.expired:
        raise HTTPException(status_code=410, detail="Interview link has expired")
    if session.status == SessionStatus.completed:
        raise HTTPException(status_code=409, detail="Session is already completed")
    if not session.consented_at:
        raise HTTPException(status_code=403, detail="Consent is required before starting")
    session.started_at = session.started_at or datetime.now(timezone.utc)
    session.status = SessionStatus.in_progress
    audit(db, None, request, "candidate.session.started", "interview_session", session.id, session.id)
    db.commit()


@router.post("/{token}/events", response_model=EventOut, status_code=201, dependencies=[Depends(rate_limit("events", 120, 60, "token"))])
async def create_event(token: str, payload: EventCreate, db: Session = Depends(get_db)):
    session = public_session(db, token)
    require_in_progress(session)
    if db.scalar(select(func.count(IntegrityEvent.id)).where(IntegrityEvent.session_id == session.id)) >= MAX_EVENTS_PER_SESSION:
        raise HTTPException(status_code=429, detail="Event limit reached for this session")
    event = IntegrityEvent(session_id=session.id, event_type=payload.event_type, started_at=payload.started_at, ended_at=payload.ended_at, duration_seconds=payload.duration_seconds, confidence_score=payload.confidence_score, event_metadata=payload.metadata)
    db.add(event)
    if session.review_status == ReviewStatus.no_events:
        session.review_status = ReviewStatus.requires_review
    db.commit()
    db.refresh(event)
    output = EventOut.model_validate(event)
    await broadcast_to_role(session.public_token, "hr", {"type": "integrity-event", "event": output.model_dump(mode="json")})
    return output


@router.post("/{token}/analyze-frame", dependencies=[Depends(rate_limit("frames", 30, 60, "token"))])
async def analyze_frame(token: str, frame: UploadFile = File(...), db: Session = Depends(get_db)):
    """Run transient YOLO inference. The uploaded frame is never persisted."""
    session = public_session(db, token)
    require_in_progress(session)
    if frame.content_type not in {"image/jpeg", "image/webp", "image/png"}:
        raise HTTPException(status_code=415, detail="Unsupported image type")
    content = await frame.read(MAX_FRAME_BYTES + 1)
    if len(content) > MAX_FRAME_BYTES:
        raise HTTPException(status_code=413, detail="Frame is too large")
    try:
        return detect_objects(content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/{token}/finish", status_code=204)
def finish(token: str, request: Request, db: Session = Depends(get_db)):
    session = public_session(db, token)
    if session.status == SessionStatus.completed:
        return  # idempotent: never overwrite the original end time
    require_in_progress(session)
    session.ended_at = datetime.now(timezone.utc)
    session.status = SessionStatus.completed
    audit(db, None, request, "candidate.session.completed", "interview_session", session.id, session.id)
    db.commit()
