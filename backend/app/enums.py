from enum import StrEnum


class UserRole(StrEnum):
    hr = "hr"
    admin = "admin"


class SessionStatus(StrEnum):
    scheduled = "scheduled"
    consented = "consented"
    in_progress = "in_progress"
    completed = "completed"
    expired = "expired"


class ReviewStatus(StrEnum):
    no_events = "No events detected"
    requires_review = "Requires review"
    review_completed = "Review completed"
    insufficient_evidence = "Insufficient evidence"


class ReviewOutcome(StrEnum):
    review_completed = ReviewStatus.review_completed.value
    insufficient_evidence = ReviewStatus.insufficient_evidence.value


class QuestionType(StrEnum):
    multiple_choice = "multiple_choice"
    short_text = "short_text"


class EventType(StrEnum):
    tab_hidden = "tab_hidden"
    fullscreen_exit = "fullscreen_exit"
    camera_disabled = "camera_disabled"
    face_not_visible = "face_not_visible"
    multiple_people = "multiple_people"
    phone_detected = "phone_detected"
    screen_share_stopped = "screen_share_stopped"
    copy_paste = "copy_paste"
    connection_interruption = "connection_interruption"
    window_resized = "window_resized"
    multiple_monitors = "multiple_monitors"


def check_in(column: str, enum: type[StrEnum]) -> str:
    """SQL fragment for a CHECK constraint that mirrors an enum's values."""
    values = ", ".join(f"'{member.value}'" for member in enum)
    return f"{column} IN ({values})"
