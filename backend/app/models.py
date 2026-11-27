import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, Uuid, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .enums import EventType, QuestionType, ReviewOutcome, ReviewStatus, SessionStatus, UserRole, check_in
from .secrets_box import EncryptedString


def uuid4_str() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(check_in("role", UserRole), name="ck_users_role"),
        CheckConstraint("retention_days BETWEEN 1 AND 365", name="ck_users_retention_days"),
    )
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(160))
    role: Mapped[str] = mapped_column(String(30), default=UserRole.hr)
    retention_days: Mapped[int] = mapped_column(Integer, default=30)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Session tokens carry the version they were issued under; bumping it signs the user out everywhere.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Only the keyed hash of the emailed reset token is stored (app/security.py keyed_hash).
    password_reset_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    password_reset_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Two-step verification (app/mfa.py). mfa_secret is set at setup and only counts once mfa_enabled is true; it is
    # encrypted at rest (app/secrets_box.py), so code here always sees the plain value.
    mfa_secret: Mapped[str | None] = mapped_column(EncryptedString)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    mfa_last_step: Mapped[int | None] = mapped_column(Integer)
    mfa_recovery_hashes: Mapped[list[str] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Candidate(Base):
    """A candidate belongs to the HR user who invited them; the same email may exist once per HR user."""

    __tablename__ = "candidates"
    __table_args__ = (UniqueConstraint("created_by", "email", name="uq_candidates_created_by_email"),)
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    created_by: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    email: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    full_name: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class InterviewSession(Base):
    __tablename__ = "interview_sessions"
    __table_args__ = (
        CheckConstraint(check_in("status", SessionStatus), name="ck_interview_sessions_status"),
        CheckConstraint(check_in("review_status", ReviewStatus), name="ck_interview_sessions_review_status"),
    )
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    created_by: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    candidate_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("candidates.id", ondelete="RESTRICT"), index=True)
    test_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), ForeignKey("tests.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    public_token: Mapped[str] = mapped_column(Uuid(as_uuid=False), unique=True, default=uuid4_str, index=True)
    status: Mapped[str] = mapped_column(String(40), default=SessionStatus.scheduled)
    review_status: Mapped[str] = mapped_column(String(40), default=ReviewStatus.no_events)
    require_screen_share: Mapped[bool] = mapped_column(Boolean, default=False)
    consented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    consent_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Email one-time code (see app/verification.py). Off for calls created before this option existed.
    verify_candidate_email: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    verification_code_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    verification_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_sends: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    verification_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The host's private working notes (autosaved during the call). Never part of a public/candidate response.
    host_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Monitor heartbeat bookkeeping (see app/signals.py). NULL monitored_seconds = coverage was not tracked for this call.
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    monitored_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    face_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    monitor_gaps: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    candidate: Mapped[Candidate] = relationship()
    creator: Mapped[User] = relationship()
    test: Mapped["Test | None"] = relationship()
    events: Mapped[list["IntegrityEvent"]] = relationship(cascade="all, delete-orphan", order_by="IntegrityEvent.started_at")
    reviews: Mapped[list["SessionReview"]] = relationship(cascade="all, delete-orphan")


class Test(Base):
    __test__ = False  # not a pytest test class
    __tablename__ = "tests"
    __table_args__ = (CheckConstraint("time_limit_minutes IS NULL OR time_limit_minutes BETWEEN 1 AND 480", name="ck_tests_time_limit_minutes"),)
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    created_by: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    public_token: Mapped[str] = mapped_column(Uuid(as_uuid=False), unique=True, default=uuid4_str, index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    form_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    # Public exam link only (a plain form has neither): minutes from the start, and a per-candidate question and option order.
    time_limit_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    shuffle: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # Public exam link only: the candidate must enter a code emailed to the address they give before the questions appear.
    verify_candidate_email: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    questions: Mapped[list["TestQuestion"]] = relationship(cascade="all, delete-orphan", order_by="TestQuestion.position")


class TestQuestion(Base):
    __test__ = False  # not a pytest test class
    __tablename__ = "test_questions"
    __table_args__ = (CheckConstraint(check_in("question_type", QuestionType), name="ck_test_questions_question_type"),)
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    test_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("tests.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    question_type: Mapped[str] = mapped_column(String(40), default=QuestionType.multiple_choice)
    prompt: Mapped[str] = mapped_column(Text)
    options: Mapped[list[str]] = mapped_column(JSON, default=list)
    correct_option_index: Mapped[int | None] = mapped_column(Integer, nullable=True)


class TestSubmission(Base):
    __test__ = False  # not a pytest test class
    __tablename__ = "test_submissions"
    __table_args__ = (UniqueConstraint("session_id"),)
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    session_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=True, index=True)
    test_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("tests.id", ondelete="CASCADE"), index=True)
    participant_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    participant_email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    participant_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    answers: Mapped[dict] = mapped_column(JSON, default=dict)
    score: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    # Page signals (left the page, paste, print) the browser reported while a public exam was open. Only public
    # exams fill it; a call's signals are IntegrityEvent rows. Part of the row, so every purge or delete that removes
    # the submission removes these too.
    integrity_events: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    # Public exams: when the candidate started, and by how many seconds they went past the time limit (only when it was
    # more than a few seconds, so network lag is not reported). Copied from the attempt so the row stands on its own.
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    over_limit_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Public exams with the email code on: when the candidate last proved they read this mailbox (copied from the attempt).
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ExamAttempt(Base):
    """Someone started a public exam. Written at the start, so a candidate who never submits is on record, starting again
    resumes this row (same clock, same order) instead of resetting it, and its id is what the candidate holds to submit.
    One per test and email. Holds a name, email and IP, so retention removes it like a submission."""

    __tablename__ = "exam_attempts"
    __table_args__ = (UniqueConstraint("test_id", "participant_email", name="uq_exam_attempts_test_email"),)
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    test_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("tests.id", ondelete="CASCADE"))
    participant_name: Mapped[str] = mapped_column(String(160))
    participant_email: Mapped[str] = mapped_column(String(255))
    participant_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # What this candidate was shown: [{"id": question id, "options": [original option indexes in the order shown]}].
    layout: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # What the candidate has answered so far, as they saw it ({question id: option position shown, or text}), saved while
    # they work and emptied on submit. Handed back only to someone who proved the mailbox; the host sees how many, not what.
    draft_answers: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    draft_saved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ExamEmailCode(Base):
    """The one-time code emailed to someone who wants to start a public exam that checks email. One row per test and
    address, written when they ask for a code, so it exists before any attempt does. Only a keyed hash of the code is
    kept. The column names match the call's (app.verification works on either). Holds an email and nothing else, and
    retention removes it like an attempt."""

    __tablename__ = "exam_email_codes"
    __table_args__ = (UniqueConstraint("test_id", "email", name="uq_exam_email_codes_test_email"),)
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    test_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("tests.id", ondelete="CASCADE"))
    email: Mapped[str] = mapped_column(String(255))
    verification_code_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    verification_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_sends: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    verification_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class IntegrityEvent(Base):
    __tablename__ = "integrity_events"
    __table_args__ = (
        CheckConstraint(check_in("event_type", EventType), name="ck_integrity_events_event_type"),
        CheckConstraint("confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1", name="ck_integrity_events_confidence"),
        CheckConstraint("severity BETWEEN 0 AND 3", name="ck_integrity_events_severity"),
    )
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    session_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("interview_sessions.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(60))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    event_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    severity: Mapped[int] = mapped_column(Integer, default=1, server_default="1")  # app.signals.Severity
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SessionReview(Base):
    __tablename__ = "session_reviews"
    __table_args__ = (
        UniqueConstraint("session_id", "reviewer_id"),
        CheckConstraint(check_in("outcome", ReviewOutcome), name="ck_session_reviews_outcome"),
    )
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    session_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("interview_sessions.id", ondelete="CASCADE"))
    reviewer_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("users.id", ondelete="RESTRICT"))
    outcome: Mapped[str] = mapped_column(String(40))
    notes: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    reviewer: Mapped[User] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("idx_audit_session_action", "session_id", "action", "created_at"),)
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    user_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    session_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), ForeignKey("interview_sessions.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(100))
    entity_type: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
