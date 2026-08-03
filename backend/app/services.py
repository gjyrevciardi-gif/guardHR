from fastapi import Request
from sqlalchemy.orm import Session, object_session

from .models import AuditLog, InterviewSession, TestSubmission, User
from .schemas import EventOut, ReviewOut, SessionOut, TestOut, TestQuestionOut, TestSubmissionOut


def request_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    return forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)


def audit(db: Session, user: User | None, request: Request, action: str, entity_type: str, entity_id: str | None = None, session_id: str | None = None, details: dict | None = None) -> None:
    db.add(AuditLog(user_id=user.id if user else None, session_id=session_id, action=action, entity_type=entity_type, entity_id=entity_id, details=details or {}, ip_address=request_ip(request)))


def session_to_out(
    session: InterviewSession,
    include_details: bool = False,
    invite_email_sent: bool | None = None,
    invite_email_error: str | None = None,
) -> SessionOut:
    events = []
    reviews = []
    if include_details:
        events = [EventOut(id=e.id, event_type=e.event_type, started_at=e.started_at, ended_at=e.ended_at, duration_seconds=float(e.duration_seconds) if e.duration_seconds is not None else None, confidence_score=float(e.confidence_score) if e.confidence_score is not None else None, metadata=e.event_metadata or {}) for e in session.events]
        reviews = [ReviewOut.model_validate(r) for r in session.reviews]
    test = None
    if session.test:
        test = TestOut(
            id=session.test.id,
            public_token=session.test.public_token,
            title=session.test.title,
            description=session.test.description,
            is_public=session.test.is_public,
            form_mode=session.test.form_mode,
            created_at=session.test.created_at,
            question_count=len(session.test.questions),
            questions=[TestQuestionOut(id=q.id, position=q.position, question_type=q.question_type, prompt=q.prompt, options=q.options) for q in session.test.questions] if include_details else [],
        )
    submission = None
    if include_details:
        db = object_session(session)
        found = db.query(TestSubmission).filter(TestSubmission.session_id == session.id).one_or_none() if db else None
        if found:
            submission = TestSubmissionOut(id=found.id, test_id=found.test_id, session_id=found.session_id, participant_name=found.participant_name, participant_email=found.participant_email, score=found.score, total=found.total, answers=found.answers, submitted_at=found.submitted_at)
    return SessionOut(id=session.id, title=session.title, public_token=session.public_token, status=session.status, review_status=session.review_status, invite_email_sent=invite_email_sent, invite_email_error=invite_email_error, require_screen_share=session.require_screen_share, test=test, test_submission=submission, candidate=session.candidate, expires_at=session.expires_at, consented_at=session.consented_at, started_at=session.started_at, ended_at=session.ended_at, created_at=session.created_at, event_count=len(session.events), events=events, reviews=reviews)
