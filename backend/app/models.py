import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def uuid4_str() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(160))
    role: Mapped[str] = mapped_column(String(30), default="hr")
    retention_days: Mapped[int] = mapped_column(Integer, default=30)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Candidate(Base):
    __tablename__ = "candidates"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    full_name: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class InterviewSession(Base):
    __tablename__ = "interview_sessions"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    created_by: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    candidate_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("candidates.id", ondelete="RESTRICT"), index=True)
    test_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), ForeignKey("tests.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    public_token: Mapped[str] = mapped_column(Uuid(as_uuid=False), unique=True, default=uuid4_str, index=True)
    status: Mapped[str] = mapped_column(String(40), default="scheduled")
    review_status: Mapped[str] = mapped_column(String(40), default="No events detected")
    require_screen_share: Mapped[bool] = mapped_column(Boolean, default=False)
    consented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    consent_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    candidate: Mapped[Candidate] = relationship()
    creator: Mapped[User] = relationship()
    test: Mapped["Test | None"] = relationship()
    events: Mapped[list["IntegrityEvent"]] = relationship(cascade="all, delete-orphan", order_by="IntegrityEvent.started_at")
    reviews: Mapped[list["SessionReview"]] = relationship(cascade="all, delete-orphan")


class Test(Base):
    __tablename__ = "tests"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    created_by: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    public_token: Mapped[str] = mapped_column(Uuid(as_uuid=False), unique=True, default=uuid4_str, index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    form_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    questions: Mapped[list["TestQuestion"]] = relationship(cascade="all, delete-orphan", order_by="TestQuestion.position")


class TestQuestion(Base):
    __tablename__ = "test_questions"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    test_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("tests.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    question_type: Mapped[str] = mapped_column(String(40), default="multiple_choice")
    prompt: Mapped[str] = mapped_column(Text)
    options: Mapped[dict] = mapped_column(JSON, default=list)
    correct_option_index: Mapped[int | None] = mapped_column(Integer, nullable=True)


class TestSubmission(Base):
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
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class IntegrityEvent(Base):
    __tablename__ = "integrity_events"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    session_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("interview_sessions.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(60))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    event_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SessionReview(Base):
    __tablename__ = "session_reviews"
    __table_args__ = (UniqueConstraint("session_id", "reviewer_id"),)
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
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uuid4_str)
    user_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    session_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), ForeignKey("interview_sessions.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(100))
    entity_type: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
