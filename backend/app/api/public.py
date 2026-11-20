import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .. import email as mailer
from ..database import get_db
from ..enums import ReviewStatus, SessionStatus
from ..models import IntegrityEvent, InterviewSession, Test, TestQuestion, TestSubmission
from ..ratelimit import rate_limit
from ..schemas import ConsentRequest, EventCreate, EventFinish, EventOut, HeartbeatIn, PublicSessionOut, PublicTestOut, TestSubmissionOut, TestSubmit, VerificationConfirm, VerificationSentOut
from ..services import audit, parse_uuid, request_ip
from ..signals import needs_review, record_heartbeat, severity_for
from ..verification import CODE_TTL_SECONDS, MAX_ATTEMPTS, RESEND_COOLDOWN_SECONDS, check_code, issue_code, mask_email
from ..vision import detect_objects
from .signaling import broadcast_to_role
from .tests import grade_answers

MAX_EVENTS_PER_SESSION = 2000
MAX_FRAME_BYTES = 2_500_000
FRAME_QUEUE_SECONDS = 3.0
# One inference at a time: Ultralytics models are not thread-safe and inference is CPU-bound.
# Frames that wait longer than FRAME_QUEUE_SECONDS are dropped (the client treats vision as best-effort).
# ponytail: single in-process slot; move detection to a worker process when one host needs more throughput.
_inference_slot = asyncio.Semaphore(1)

router = APIRouter(prefix="/public/sessions", tags=["candidate"], dependencies=[Depends(rate_limit("public", 240, 60))])


def public_session(db: Session, token: str) -> InterviewSession:
    session = db.scalar(
        select(InterviewSession)
        .options(selectinload(InterviewSession.candidate), selectinload(InterviewSession.creator), selectinload(InterviewSession.test).selectinload(Test.questions))
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
        host_name=session.creator.full_name,
        retention_days=session.creator.retention_days,
        status=session.status,
        require_screen_share=session.require_screen_share,
        expires_at=session.expires_at,
        consented_at=session.consented_at,
        verification_required=session.verify_candidate_email and session.verified_at is None,
        candidate_email_hint=mask_email(session.candidate.email) if session.verify_candidate_email and session.verified_at is None and session.candidate.email else None,
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


@router.post("/{token}/verification", response_model=VerificationSentOut, dependencies=[Depends(rate_limit("verify-send", 12, 600, "token"))])
def send_verification(token: str, request: Request, db: Session = Depends(get_db)):
    """Email a one-time code to the invited address. Sent inline so a delivery failure is reported, not hidden."""
    session = public_session(db, token)
    if session.status == SessionStatus.expired:
        raise HTTPException(status_code=410, detail="Interview link has expired")
    if session.status == SessionStatus.completed:
        raise HTTPException(status_code=409, detail="Session is already completed")
    if session.verified_at:
        raise HTTPException(status_code=409, detail="Email is already verified")
    code = issue_code(session)
    db.commit()
    try:
        mailer.send_verification_code(session, code)
    except Exception:
        mailer.logger.exception("Verification email for session %s could not be delivered", session.id)
        session.verification_code_hash = None
        session.verification_sent_at = None  # nothing arrived, so the candidate may retry straight away
        audit(db, None, request, "candidate.verification.code_failed", "interview_session", session.id, session.id)
        db.commit()
        raise HTTPException(status_code=502, detail="The code could not be sent. Try again or ask the host.") from None
    audit(db, None, request, "candidate.verification.code_sent", "interview_session", session.id, session.id, {"sends": session.verification_sends})
    db.commit()
    return VerificationSentOut(email_hint=mask_email(session.candidate.email or ""), expires_in_seconds=CODE_TTL_SECONDS, resend_after_seconds=RESEND_COOLDOWN_SECONDS)


@router.post("/{token}/verification/confirm", response_model=PublicSessionOut, dependencies=[Depends(rate_limit("verify-confirm", 30, 600, "token"))])
def confirm_verification(token: str, payload: VerificationConfirm, request: Request, db: Session = Depends(get_db)):
    session = public_session(db, token)
    if session.status in (SessionStatus.expired, SessionStatus.completed):
        raise HTTPException(status_code=409, detail="Session is not open for verification")
    if session.verified_at:
        return to_public_out(session)  # idempotent: replaying a correct code changes nothing
    accepted = check_code(session, payload.code)  # raises when no usable code exists
    if not accepted:
        locked = session.verification_attempts >= MAX_ATTEMPTS
        if locked:
            audit(db, None, request, "candidate.verification.locked", "interview_session", session.id, session.id)
        db.commit()
        detail = "Too many wrong attempts. Request a new code." if locked else "The code is incorrect"
        raise HTTPException(status_code=429 if locked else 422, detail=detail)
    audit(db, None, request, "candidate.verification.succeeded", "interview_session", session.id, session.id)
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
    if session.verify_candidate_email and not session.verified_at:
        raise HTTPException(status_code=403, detail="Email verification is required before starting")
    session.started_at = session.started_at or datetime.now(timezone.utc)
    session.status = SessionStatus.in_progress
    if session.monitored_seconds is None:  # from now on this call has a coverage figure
        session.monitored_seconds = session.face_seconds = 0.0
        session.last_seen_at = datetime.now(timezone.utc)
    audit(db, None, request, "candidate.session.started", "interview_session", session.id, session.id)
    db.commit()


def flag_for_review_if_needed(db: Session, session: InterviewSession) -> None:
    """Move a call to "Requires review" once its signals cross the rule in app/signals.py. Never moves it back."""
    if session.review_status != ReviewStatus.no_events:
        return
    db.flush()  # sessions use autoflush=False: the event just added must be counted
    counts = dict(db.execute(select(IntegrityEvent.severity, func.count()).where(IntegrityEvent.session_id == session.id).group_by(IntegrityEvent.severity)).all())
    if needs_review(counts):
        session.review_status = ReviewStatus.requires_review


def record_event(db: Session, token: str, payload: EventCreate) -> tuple[InterviewSession, EventOut]:
    session = public_session(db, token)
    require_in_progress(session)
    if db.scalar(select(func.count(IntegrityEvent.id)).where(IntegrityEvent.session_id == session.id)) >= MAX_EVENTS_PER_SESSION:
        raise HTTPException(status_code=429, detail="Event limit reached for this session")
    event = IntegrityEvent(session_id=session.id, event_type=payload.event_type, started_at=payload.started_at, ended_at=payload.ended_at, duration_seconds=payload.duration_seconds, confidence_score=payload.confidence_score, event_metadata=payload.metadata, severity=severity_for(payload.event_type, payload.duration_seconds, payload.metadata))
    db.add(event)
    flag_for_review_if_needed(db, session)
    db.commit()
    db.refresh(event)
    return session, EventOut.model_validate(event)


@router.post("/{token}/events", response_model=EventOut, status_code=201, dependencies=[Depends(rate_limit("events", 120, 60, "token"))])
async def create_event(token: str, payload: EventCreate, db: Session = Depends(get_db)):
    # Database work runs in the threadpool so a slow query cannot stall signaling on the single event loop.
    session, output = await run_in_threadpool(record_event, db, token, payload)
    await broadcast_to_role(session.public_token, "hr", {"type": "integrity-event", "event": output.model_dump(mode="json")})
    return output


def finish_event(db: Session, token: str, event_id: str, payload: EventFinish) -> tuple[InterviewSession, EventOut]:
    session = public_session(db, token)
    require_in_progress(session)
    event = db.scalar(select(IntegrityEvent).where(IntegrityEvent.id == parse_uuid(event_id, "Event not found"), IntegrityEvent.session_id == session.id))
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.ended_at is not None or event.duration_seconds is not None:
        raise HTTPException(status_code=409, detail="Event is already closed")
    event.ended_at = payload.ended_at
    event.duration_seconds = payload.duration_seconds
    event.severity = severity_for(event.event_type, payload.duration_seconds, event.event_metadata)  # a long absence is worse than a short one
    flag_for_review_if_needed(db, session)
    db.commit()
    db.refresh(event)
    return session, EventOut.model_validate(event)


@router.patch("/{token}/events/{event_id}", response_model=EventOut, dependencies=[Depends(rate_limit("events", 120, 60, "token"))])
async def close_event(token: str, event_id: str, payload: EventFinish, db: Session = Depends(get_db)):
    """One tab switch is one event: the browser posts it when it starts and closes it here when it ends."""
    session, output = await run_in_threadpool(finish_event, db, token, event_id, payload)
    await broadcast_to_role(session.public_token, "hr", {"type": "integrity-event-closed", "event": output.model_dump(mode="json")})
    return output


@router.post("/{token}/heartbeat", status_code=204, dependencies=[Depends(rate_limit("heartbeat", 30, 60, "token"))])
def heartbeat(token: str, payload: HeartbeatIn, db: Session = Depends(get_db)):
    """The browser monitor calls this every 10 s; the gaps between calls are what coverage is computed from."""
    session = public_session(db, token)
    require_in_progress(session)
    record_heartbeat(session, payload.face_detection, datetime.now(timezone.utc))
    db.commit()


@router.post("/{token}/analyze-frame", dependencies=[Depends(rate_limit("frames", 30, 60, "token"))])
async def analyze_frame(token: str, frame: UploadFile = File(...), db: Session = Depends(get_db)):
    """Run transient YOLO inference. The uploaded frame is never persisted."""
    await run_in_threadpool(lambda: require_in_progress(public_session(db, token)))
    if frame.content_type not in {"image/jpeg", "image/webp", "image/png"}:
        raise HTTPException(status_code=415, detail="Unsupported image type")
    content = await frame.read(MAX_FRAME_BYTES + 1)
    if len(content) > MAX_FRAME_BYTES:
        raise HTTPException(status_code=413, detail="Frame is too large")
    try:
        await asyncio.wait_for(_inference_slot.acquire(), FRAME_QUEUE_SECONDS)
    except TimeoutError:
        raise HTTPException(status_code=503, detail="Detector busy", headers={"Retry-After": "5"}) from None
    try:
        return await run_in_threadpool(detect_objects, content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        _inference_slot.release()


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
