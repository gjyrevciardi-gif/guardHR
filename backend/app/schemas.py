import json
from datetime import datetime
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, EmailStr, Field, field_validator

from .enums import EventType, QuestionType, ReviewOutcome, ReviewStatus, UserRole
from .signals import Severity

MAX_EVENT_METADATA_BYTES = 4096
MAX_ANSWERS = 200


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=160)


class AdminUserCreate(RegisterRequest):
    role: UserRole = UserRole.hr


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: EmailStr
    full_name: str
    role: str
    retention_days: int


class TokenResponse(BaseModel):
    """`access_token` is for API clients; the browser app relies on the HttpOnly session cookie."""

    access_token: str
    token_type: str = "bearer"
    user: UserOut


class SessionCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    candidate_name: str = Field(min_length=2, max_length=160)
    candidate_email: EmailStr
    expires_at: datetime
    require_screen_share: bool = False
    verify_candidate_email: bool = False
    test_id: str | None = None


class TestQuestionCreate(BaseModel):
    question_type: QuestionType = QuestionType.multiple_choice
    prompt: str = Field(min_length=2, max_length=5000)
    options: list[str] = Field(default_factory=list, max_length=8)
    correct_option_index: int | None = Field(default=None, ge=0)


class TestQuestionUpdate(TestQuestionCreate):
    id: str | None = None


class TestCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    form_mode: bool = False
    is_public: bool = True
    questions: list[TestQuestionCreate] = Field(min_length=1, max_length=100)


class TestUpdate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    form_mode: bool = False
    is_public: bool = True
    questions: list[TestQuestionUpdate] = Field(min_length=1, max_length=100)


class TestQuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    position: int
    question_type: QuestionType = QuestionType.multiple_choice
    prompt: str
    options: list[str]


class TestQuestionHostOut(TestQuestionOut):
    correct_option_index: int | None = None


class TestOut(BaseModel):
    id: str
    public_token: str
    title: str
    description: str | None
    is_public: bool = True
    form_mode: bool = False
    created_at: datetime
    question_count: int = 0
    questions: list[TestQuestionOut] = Field(default_factory=list)

    @classmethod
    def from_test(cls, test: Any, *, include_questions: bool = True, question_count: int | None = None) -> "TestOut":
        """Build from a Test model. Pass `question_count` to avoid loading questions just to count them."""
        return cls(
            id=test.id,
            public_token=test.public_token,
            title=test.title,
            description=test.description,
            is_public=test.is_public,
            form_mode=test.form_mode,
            created_at=test.created_at,
            question_count=question_count if question_count is not None else len(test.questions),
            questions=[TestQuestionOut.model_validate(q) for q in test.questions] if include_questions else [],
        )


class PublicTestOut(BaseModel):
    """What a candidate sees inside a monitored session. Deliberately omits `public_token`,
    which would let the candidate retake the test outside the monitored call."""

    id: str
    title: str
    description: str | None
    form_mode: bool = False
    question_count: int = 0
    questions: list[TestQuestionOut] = Field(default_factory=list)

    @classmethod
    def from_test(cls, test: Any) -> "PublicTestOut":
        return cls(
            id=test.id,
            title=test.title,
            description=test.description,
            form_mode=test.form_mode,
            question_count=len(test.questions),
            questions=[TestQuestionOut.model_validate(q) for q in test.questions],
        )


class TestSubmit(BaseModel):
    answers: dict[str, Any] = Field(max_length=MAX_ANSWERS)


class PublicTestSubmit(TestSubmit):
    participant_name: str | None = Field(default=None, max_length=160)
    participant_email: EmailStr | None = None


class TestSubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    test_id: str
    session_id: str | None = None
    participant_name: str | None = None
    participant_email: EmailStr | None = None
    score: int
    total: int
    answers: dict[str, Any]
    submitted_at: datetime


class TestReviewSessionOut(BaseModel):
    session_id: str
    session_title: str
    candidate_name: str
    candidate_email: EmailStr | None
    status: str
    review_status: ReviewStatus
    event_count: int
    event_summary: dict[str, int] = Field(default_factory=dict)
    submitted_at: datetime | None = None
    score: int | None = None
    total: int | None = None
    answers: dict[str, Any] | None = None


class TestStandaloneSubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    participant_name: str | None = None
    participant_email: EmailStr | None = None
    score: int
    total: int
    answers: dict[str, Any]
    submitted_at: datetime


class TestDetailOut(BaseModel):
    id: str
    public_token: str
    title: str
    description: str | None
    is_public: bool = True
    form_mode: bool = False
    created_at: datetime
    question_count: int = 0
    questions: list[TestQuestionHostOut] = Field(default_factory=list)
    sessions: list[TestReviewSessionOut] = Field(default_factory=list)
    standalone_submissions: list[TestStandaloneSubmissionOut] = Field(default_factory=list)


class CandidateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: EmailStr | None
    full_name: str


class EventCreate(BaseModel):
    event_type: EventType
    started_at: datetime
    ended_at: datetime | None = None
    duration_seconds: float | None = Field(default=None, ge=0, le=86400)
    confidence_score: float | None = Field(default=None, ge=0, le=1)
    metadata: dict[str, Any] = Field(default_factory=dict, max_length=30)

    @field_validator("metadata")
    @classmethod
    def metadata_must_be_small(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(value, default=str)) > MAX_EVENT_METADATA_BYTES:
            raise ValueError(f"metadata must be at most {MAX_EVENT_METADATA_BYTES} bytes")
        return value


class EventFinish(BaseModel):
    """Closes an open episode (for example the candidate returned to the tab)."""

    ended_at: datetime
    duration_seconds: float = Field(ge=0, le=86400)


class HeartbeatIn(BaseModel):
    face_detection: bool = False  # whether face detection was running in the browser at this moment


class MonitoringOut(BaseModel):
    quality: Literal["unknown", "none", "partial", "good"]
    coverage_percent: int | None
    face_percent: int | None
    gaps: int
    last_seen_at: datetime | None


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    id: str
    event_type: str
    started_at: datetime
    ended_at: datetime | None
    duration_seconds: float | None
    confidence_score: float | None
    severity: Literal["info", "low", "medium", "high"]
    # The ORM attribute is `event_metadata` because `metadata` is reserved on declarative models.
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias=AliasChoices("event_metadata", "metadata"))

    @field_validator("severity", mode="before")
    @classmethod
    def severity_name(cls, value: Any) -> Any:
        return Severity(value).name if isinstance(value, int) else value


class NotesUpdate(BaseModel):
    notes: str = Field(max_length=10000)


class NotesOut(BaseModel):
    saved_at: datetime


class ReviewCreate(BaseModel):
    outcome: ReviewOutcome
    notes: str = Field(min_length=3, max_length=5000)


class ReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    outcome: str
    notes: str
    created_at: datetime
    updated_at: datetime


class SessionOut(BaseModel):
    id: str
    title: str
    public_token: str
    status: str
    review_status: ReviewStatus
    invite_email_queued: bool = False
    invite_status: Literal["sent", "failed"] | None = None
    signal_level: Literal["none", "info", "low", "medium", "high"] = "none"
    monitoring: MonitoringOut | None = None
    require_screen_share: bool
    verify_candidate_email: bool = False
    verified_at: datetime | None = None
    host_notes: str | None = None  # only filled on the detail view
    test: TestOut | None = None
    test_submission: TestSubmissionOut | None = None
    candidate: CandidateOut
    expires_at: datetime
    consented_at: datetime | None
    started_at: datetime | None
    ended_at: datetime | None
    created_at: datetime
    event_count: int = 0
    events: list[EventOut] = Field(default_factory=list)
    reviews: list[ReviewOut] = Field(default_factory=list)


class PublicSessionOut(BaseModel):
    title: str
    candidate_name: str
    host_name: str  # who is responsible for the data: shown on the consent page
    retention_days: int  # how long after the call ends the monitoring data is kept
    status: str
    require_screen_share: bool
    expires_at: datetime
    consented_at: datetime | None
    verification_required: bool = False  # the host asked for an email code and it has not been entered yet
    candidate_email_hint: str | None = None  # masked, shown only while verification is pending
    test: PublicTestOut | None = None


class ConsentRequest(BaseModel):
    accepted: bool


class VerificationSentOut(BaseModel):
    email_hint: str
    expires_in_seconds: int
    resend_after_seconds: int


class VerificationConfirm(BaseModel):
    code: str = Field(pattern=r"^[0-9]{6}$")


class RetentionUpdate(BaseModel):
    retention_days: int = Field(ge=1, le=365)


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    action: str
    entity_type: str
    entity_id: str | None
    details: dict[str, Any]
    ip_address: str | None
    created_at: datetime
