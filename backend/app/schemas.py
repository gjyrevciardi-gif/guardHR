from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

ReviewLabel = Literal["No events detected", "Requires review", "Review completed", "Insufficient evidence"]
EventType = Literal[
    "tab_hidden",
    "fullscreen_exit",
    "camera_disabled",
    "face_not_visible",
    "multiple_people",
    "phone_detected",
    "screen_share_stopped",
    "copy_paste",
    "connection_interruption",
    "window_resized",
    "multiple_monitors",
]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=160)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: EmailStr
    full_name: str
    role: str
    retention_days: int


class SessionCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    candidate_name: str = Field(min_length=2, max_length=160)
    candidate_email: EmailStr
    expires_at: datetime
    require_screen_share: bool = False
    test_id: str | None = None


class TestQuestionCreate(BaseModel):
    prompt: str = Field(min_length=2, max_length=5000)
    options: list[str] = Field(min_length=2, max_length=8)
    correct_option_index: int = Field(ge=0)


class TestCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    questions: list[TestQuestionCreate] = Field(min_length=1, max_length=100)


class TestQuestionOut(BaseModel):
    id: str
    position: int
    prompt: str
    options: list[str]


class TestOut(BaseModel):
    id: str
    title: str
    description: str | None
    created_at: datetime
    question_count: int = 0
    questions: list[TestQuestionOut] = Field(default_factory=list)


class TestSubmit(BaseModel):
    answers: dict[str, int]


class TestSubmissionOut(BaseModel):
    id: str
    test_id: str
    score: int
    total: int
    answers: dict[str, int]
    submitted_at: datetime


class CandidateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: EmailStr | None
    full_name: str


class EventCreate(BaseModel):
    event_type: EventType
    started_at: datetime
    ended_at: datetime | None = None
    duration_seconds: float | None = Field(default=None, ge=0)
    confidence_score: float | None = Field(default=None, ge=0, le=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    event_type: str
    started_at: datetime
    ended_at: datetime | None
    duration_seconds: float | None
    confidence_score: float | None
    metadata: dict[str, Any]


class ReviewCreate(BaseModel):
    outcome: Literal["Review completed", "Insufficient evidence"]
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
    review_status: ReviewLabel
    invite_email_sent: bool | None = None
    invite_email_error: str | None = None
    require_screen_share: bool
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
    status: str
    require_screen_share: bool
    expires_at: datetime
    consented_at: datetime | None
    test: TestOut | None = None


class ConsentRequest(BaseModel):
    accepted: bool


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
