"""How serious an activity signal is, when a call needs review, and how much of a call was actually monitored.

Everything here is a pure function of data the candidate's browser reported. A candidate controls that
browser, so none of it is proof: it only tells the host how much weight a signal (or its absence) deserves.
"""

from datetime import datetime, timezone
from enum import IntEnum

from .enums import EventType
from .models import InterviewSession


class Severity(IntEnum):
    info = 0
    low = 1
    medium = 2
    high = 3


# Review rule (assumption, tune here): one high signal, two medium ones, or six low ones put a call in the
# "Requires review" queue. Info signals never do. A single medium signal does not, but the host still sees it.
REVIEW_HIGH = 1
REVIEW_MEDIUM = 2
REVIEW_LOW = 6

LONG_ABSENCE_SECONDS = 30  # a tab/window absence at least this long counts as medium instead of low

# The browser sends a heartbeat every 10 s. A longer silence is a gap: it is not counted as monitored time.
HEARTBEAT_MAX_GAP_SECONDS = 45
MIN_JUDGEABLE_SECONDS = 30  # shorter calls get no coverage verdict
GOOD_COVERAGE = 0.8


def as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)  # SQLite returns naive datetimes


def severity_for(event_type: str, duration_seconds: float | None = None, metadata: dict | None = None) -> Severity:
    if event_type in (EventType.phone_detected, EventType.multiple_people, EventType.screen_share_stopped):
        return Severity.high
    if event_type in (EventType.camera_disabled, EventType.face_not_visible):
        return Severity.medium
    if event_type == EventType.tab_hidden:
        return Severity.medium if (duration_seconds or 0) >= LONG_ABSENCE_SECONDS else Severity.low
    if event_type == EventType.copy_paste:
        # Bringing text in, printing the page and pressing Print Screen are deliberate; a blocked copy is only an attempt.
        return Severity.medium if (metadata or {}).get("operation") in ("paste", "print", "screenshot_key") else Severity.low
    if event_type in (EventType.fullscreen_exit, EventType.multiple_monitors):
        return Severity.low  # multiple_monitors is false-positive prone (docks, mirrored displays)
    return Severity.info  # connection_interruption, window_resized


def needs_review(counts: dict[int, int]) -> bool:
    """`counts` maps a Severity value to how many events of that severity the call has."""
    return counts.get(Severity.high, 0) >= REVIEW_HIGH or counts.get(Severity.medium, 0) >= REVIEW_MEDIUM or counts.get(Severity.low, 0) >= REVIEW_LOW


def signal_level(max_severity: int | None) -> str:
    return "none" if max_severity is None else Severity(max_severity).name


def record_heartbeat(session: InterviewSession, face_detection_active: bool, now: datetime) -> None:
    """Add the time since the previous heartbeat to the monitored total, or count a gap if it was too long."""
    if session.monitored_seconds is None:  # first heartbeat of a call that began before coverage was tracked
        session.monitored_seconds = session.face_seconds = 0.0
    else:
        elapsed = (now - as_utc(session.last_seen_at or session.started_at or now)).total_seconds()
        if 0 <= elapsed <= HEARTBEAT_MAX_GAP_SECONDS:
            session.monitored_seconds += elapsed
            if face_detection_active:
                session.face_seconds = (session.face_seconds or 0.0) + elapsed
        else:
            session.monitor_gaps += 1
    session.last_seen_at = now


def monitoring_summary(session: InterviewSession, now: datetime | None = None) -> dict:
    """quality: unknown (not started, too short, or begun before coverage was tracked), none, partial or good."""
    now = now or datetime.now(timezone.utc)
    summary = {"quality": "unknown", "coverage_percent": None, "face_percent": None, "gaps": session.monitor_gaps or 0, "last_seen_at": session.last_seen_at}
    if session.started_at is None or session.monitored_seconds is None:
        return summary
    duration = (as_utc(session.ended_at or now) - as_utc(session.started_at)).total_seconds()
    if duration < MIN_JUDGEABLE_SECONDS:
        return summary
    coverage = min(1.0, session.monitored_seconds / duration)
    summary["coverage_percent"] = round(coverage * 100)
    summary["face_percent"] = round(min(1.0, (session.face_seconds or 0.0) / duration) * 100)
    summary["quality"] = "none" if session.monitored_seconds == 0 else "good" if coverage >= GOOD_COVERAGE else "partial"
    return summary
