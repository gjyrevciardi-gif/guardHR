from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import IntegrityEvent, InterviewSession, Test, TestQuestion, TestSubmission
from ..schemas import ConsentRequest, EventCreate, EventOut, PublicSessionOut, TestOut, TestQuestionOut, TestSubmit, TestSubmissionOut
from ..services import audit, request_ip
from ..vision import detect_objects
from .signaling import broadcast_system
from .tests import grade_answers

router = APIRouter(prefix="/public/sessions", tags=["candidate"])


def public_session(db: Session, token: str) -> InterviewSession:
    session = db.scalar(select(InterviewSession).options(selectinload(InterviewSession.candidate), selectinload(InterviewSession.test).selectinload(Test.questions)).where(InterviewSession.public_token == token))
    if not session:
        raise HTTPException(status_code=404, detail="Interview link is invalid")
    expires = session.expires_at
    now = datetime.now(timezone.utc)
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now and session.status not in ("completed", "expired"):
        session.status = "expired"
        db.commit()
    return session


@router.get("/{token}", response_model=PublicSessionOut)
def get_public_session(token: str, db: Session = Depends(get_db)):
    session = public_session(db, token)
    test = None
    if session.test:
        test = TestOut(
            id=session.test.id,
            title=session.test.title,
            description=session.test.description,
            public_token=session.test.public_token,
            is_public=session.test.is_public,
            form_mode=session.test.form_mode,
            created_at=session.test.created_at,
            question_count=len(session.test.questions),
            questions=[TestQuestionOut(id=q.id, position=q.position, question_type=q.question_type, prompt=q.prompt, options=q.options) for q in session.test.questions],
        )
    return PublicSessionOut(title=session.title, candidate_name=session.candidate.full_name, status=session.status, require_screen_share=session.require_screen_share, expires_at=session.expires_at, consented_at=session.consented_at, test=test)


@router.post("/{token}/consent", response_model=PublicSessionOut)
def consent(token: str, payload: ConsentRequest, request: Request, db: Session = Depends(get_db)):
    session = public_session(db, token)
    if session.status == "expired":
        raise HTTPException(status_code=410, detail="Interview link has expired")
    if not payload.accepted:
        raise HTTPException(status_code=422, detail="Explicit consent is required")
    session.consented_at = datetime.now(timezone.utc)
    session.consent_ip = request_ip(request)
    session.status = "consented"
    audit(db, None, request, "candidate.consent.accepted", "interview_session", session.id, session.id)
    db.commit()
    return get_public_session(token, db)


@router.post("/{token}/test-submission", response_model=TestSubmissionOut, status_code=201)
def submit_test(token: str, payload: TestSubmit, request: Request, db: Session = Depends(get_db)):
    session = public_session(db, token)
    if session.status != "in_progress":
        raise HTTPException(status_code=409, detail="Session is not in progress")
    if not session.test:
        raise HTTPException(status_code=404, detail="No test is assigned to this session")
    existing = db.scalar(select(TestSubmission).where(TestSubmission.session_id == session.id))
    if existing:
        raise HTTPException(status_code=409, detail="Test was already submitted")

    questions = db.scalars(select(TestQuestion).where(TestQuestion.test_id == session.test.id).order_by(TestQuestion.position)).all()
    checked_answers, score, total = grade_answers(list(questions), payload.answers)
    submission = TestSubmission(session_id=session.id, test_id=session.test.id, answers=checked_answers, score=score, total=total)
    db.add(submission)
    audit(db, None, request, "candidate.test.submitted", "test_submission", submission.id, session.id, {"score": score, "total": total})
    db.commit()
    db.refresh(submission)
    return TestSubmissionOut(id=submission.id, test_id=submission.test_id, session_id=submission.session_id, participant_name=submission.participant_name, participant_email=submission.participant_email, score=submission.score, total=submission.total, answers=submission.answers, submitted_at=submission.submitted_at)


@router.post("/{token}/start", status_code=204)
def start(token: str, request: Request, db: Session = Depends(get_db)):
    session = public_session(db, token)
    if not session.consented_at:
        raise HTTPException(status_code=403, detail="Consent is required before starting")
    if session.status == "expired":
        raise HTTPException(status_code=410, detail="Interview link has expired")
    session.started_at = session.started_at or datetime.now(timezone.utc)
    session.status = "in_progress"
    audit(db, None, request, "candidate.session.started", "interview_session", session.id, session.id)
    db.commit()


@router.post("/{token}/events", response_model=EventOut, status_code=201)
async def create_event(token: str, payload: EventCreate, db: Session = Depends(get_db)):
    session = public_session(db, token)
    if session.status != "in_progress":
        raise HTTPException(status_code=409, detail="Session is not in progress")
    event = IntegrityEvent(session_id=session.id, event_type=payload.event_type, started_at=payload.started_at, ended_at=payload.ended_at, duration_seconds=payload.duration_seconds, confidence_score=payload.confidence_score, event_metadata=payload.metadata)
    db.add(event)
    if session.review_status == "No events detected":
        session.review_status = "Requires review"
    db.commit()
    db.refresh(event)
    output = EventOut(id=event.id, event_type=event.event_type, started_at=event.started_at, ended_at=event.ended_at, duration_seconds=float(event.duration_seconds) if event.duration_seconds is not None else None, confidence_score=float(event.confidence_score) if event.confidence_score is not None else None, metadata=event.event_metadata)
    await broadcast_system(token, {
        "type": "integrity-event",
        "event": {
            "id": output.id,
            "event_type": output.event_type,
            "started_at": output.started_at.isoformat(),
            "ended_at": output.ended_at.isoformat() if output.ended_at else None,
            "duration_seconds": output.duration_seconds,
            "confidence_score": output.confidence_score,
            "metadata": output.metadata,
        },
    })
    return output


@router.post("/{token}/analyze-frame")
async def analyze_frame(token: str, frame: UploadFile = File(...), db: Session = Depends(get_db)):
    """Run transient YOLO inference. The uploaded frame is never persisted."""
    session = public_session(db, token)
    if session.status != "in_progress":
        raise HTTPException(status_code=409, detail="Session is not in progress")
    if frame.content_type not in {"image/jpeg", "image/webp", "image/png"}:
        raise HTTPException(status_code=415, detail="Unsupported image type")
    content = await frame.read(2_500_001)
    if len(content) > 2_500_000:
        raise HTTPException(status_code=413, detail="Frame is too large")
    try:
        return detect_objects(content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/{token}/finish", status_code=204)
def finish(token: str, request: Request, db: Session = Depends(get_db)):
    session = public_session(db, token)
    session.ended_at = datetime.now(timezone.utc)
    session.status = "completed"
    audit(db, None, request, "candidate.session.completed", "interview_session", session.id, session.id)
    db.commit()
