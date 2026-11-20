import uuid

from fastapi import HTTPException
from fastapi.requests import HTTPConnection
from sqlalchemy import select
from sqlalchemy.orm import Session, object_session

from .config import get_settings
from .models import AuditLog, InterviewSession, TestSubmission, User
from .schemas import EventOut, ReviewOut, SessionOut, TestOut, TestSubmissionOut


def parse_uuid(value: str, not_found: str) -> str:
    """Normalise a path/body identifier. A malformed UUID is a 404, never a database error."""
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail=not_found) from None


def request_ip(request: HTTPConnection) -> str | None:
    """Client IP. X-Forwarded-For is only honoured when TRUST_PROXY_HEADERS is on, because
    otherwise any client could forge the address stored as consent evidence."""
    if get_settings().trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[-1].strip()  # the entry appended by our own proxy
    return request.client.host if request.client else None


def record_audit(db: Session, *, user_id: str | None, ip: str | None, action: str, entity_type: str, entity_id: str | None = None, session_id: str | None = None, details: dict | None = None) -> None:
    db.add(AuditLog(user_id=user_id, session_id=session_id, action=action, entity_type=entity_type, entity_id=entity_id, details=details or {}, ip_address=ip))


# Outcome of the background invite email, recorded by app.email.deliver_invite.
INVITE_OUTCOMES = {"participant.invite.email_sent": "sent", "participant.invite.email_failed": "failed"}


def audit(db: Session, user: User | None, request: HTTPConnection, action: str, entity_type: str, entity_id: str | None = None, session_id: str | None = None, details: dict | None = None) -> None:
    record_audit(db, user_id=user.id if user else None, ip=request_ip(request), action=action, entity_type=entity_type, entity_id=entity_id, session_id=session_id, details=details)


def session_to_out(
    session: InterviewSession,
    include_details: bool = False,
    invite_email_queued: bool = False,
    event_count: int | None = None,
    question_count: int | None = None,
) -> SessionOut:
    """`event_count` / `question_count` let list views pass COUNT results instead of loading rows."""
    submission = None
    invite_status = None
    if include_details:
        db = object_session(session)
        found = db.scalar(select(TestSubmission).where(TestSubmission.session_id == session.id)) if db else None
        submission = TestSubmissionOut.model_validate(found) if found else None
        last_invite = db.scalar(select(AuditLog.action).where(AuditLog.session_id == session.id, AuditLog.action.in_(INVITE_OUTCOMES)).order_by(AuditLog.created_at.desc()).limit(1)) if db else None
        invite_status = INVITE_OUTCOMES.get(last_invite)
    return SessionOut(
        id=session.id,
        title=session.title,
        public_token=session.public_token,
        status=session.status,
        review_status=session.review_status,
        invite_email_queued=invite_email_queued,
        invite_status=invite_status,
        require_screen_share=session.require_screen_share,
        test=TestOut.from_test(session.test, include_questions=include_details, question_count=question_count) if session.test else None,
        test_submission=submission,
        candidate=session.candidate,
        expires_at=session.expires_at,
        consented_at=session.consented_at,
        started_at=session.started_at,
        ended_at=session.ended_at,
        created_at=session.created_at,
        event_count=event_count if event_count is not None else len(session.events),
        events=[EventOut.model_validate(event) for event in session.events] if include_details else [],
        reviews=[ReviewOut.model_validate(review) for review in session.reviews] if include_details else [],
    )
