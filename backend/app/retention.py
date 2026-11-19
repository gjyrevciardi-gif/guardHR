"""Data lifecycle: scheduled retention purge and hard deletion of sessions and tests."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from .config import get_settings
from .database import SessionLocal
from .models import AuditLog, Candidate, IntegrityEvent, InterviewSession, Test, TestSubmission, User
from .services import record_audit

logger = logging.getLogger("nemoguard.retention")


def purge_user_data(db: Session, user: User, now: datetime | None = None) -> dict:
    """Remove monitoring data older than the user's retention window.

    Deleted: integrity events, test submissions (session-linked and public), stored consent IPs,
    audit-log IP addresses and legacy invite audit details. Sessions, reviews and candidate names
    stay until the HR user deletes the session explicitly (DELETE /sessions/{id}).
    """
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=user.retention_days)
    old_sessions = select(InterviewSession.id).where(InterviewSession.created_by == user.id, InterviewSession.ended_at.is_not(None), InterviewSession.ended_at < cutoff)
    own_tests = select(Test.id).where(Test.created_by == user.id)

    events = db.execute(delete(IntegrityEvent).where(IntegrityEvent.session_id.in_(old_sessions))).rowcount or 0
    session_submissions = db.execute(delete(TestSubmission).where(TestSubmission.session_id.in_(old_sessions))).rowcount or 0
    public_submissions = db.execute(delete(TestSubmission).where(TestSubmission.session_id.is_(None), TestSubmission.test_id.in_(own_tests), TestSubmission.submitted_at < cutoff)).rowcount or 0
    db.execute(update(InterviewSession).where(InterviewSession.id.in_(old_sessions)).values(consent_ip=None))
    audit_scope = or_(AuditLog.user_id == user.id, AuditLog.session_id.in_(old_sessions))
    scrubbed = db.execute(update(AuditLog).where(audit_scope, AuditLog.created_at < cutoff, AuditLog.ip_address.is_not(None)).values(ip_address=None)).rowcount or 0
    db.execute(update(AuditLog).where(audit_scope, AuditLog.created_at < cutoff, AuditLog.action.like("participant.invite.%")).values(details={}))
    return {"deleted_events": events, "deleted_submissions": session_submissions + public_submissions, "scrubbed_audit_ips": scrubbed, "cutoff": cutoff}


def delete_session(db: Session, session: InterviewSession) -> None:
    """Hard-delete a session with everything attached to it, including PII left in audit entries."""
    candidate_id = session.candidate_id
    db.execute(update(AuditLog).where(AuditLog.session_id == session.id).values(details={}, ip_address=None, session_id=None))
    db.execute(delete(TestSubmission).where(TestSubmission.session_id == session.id))
    db.delete(session)  # events and reviews cascade through the ORM relationship
    db.flush()
    still_used = db.scalar(select(InterviewSession.id).where(InterviewSession.candidate_id == candidate_id).limit(1))
    if not still_used:
        db.execute(delete(Candidate).where(Candidate.id == candidate_id))


def delete_test(db: Session, test: Test) -> None:
    db.execute(update(InterviewSession).where(InterviewSession.test_id == test.id).values(test_id=None))
    db.execute(delete(TestSubmission).where(TestSubmission.test_id == test.id))
    db.delete(test)  # questions cascade through the ORM relationship


def purge_all() -> int:
    """Run the retention purge for every active user. Returns how many users were processed."""
    processed = 0
    with SessionLocal() as db:
        for user in db.scalars(select(User).where(User.is_active.is_(True))).all():
            result = purge_user_data(db, user)
            record_audit(db, user_id=user.id, ip=None, action="retention.purge.scheduled", entity_type="integrity_event", details={k: v for k, v in result.items() if k != "cutoff"} | {"cutoff": result["cutoff"].isoformat()})
            db.commit()
            processed += 1
    return processed


async def retention_loop() -> None:
    interval = get_settings().retention_purge_interval_hours * 3600
    while True:
        await asyncio.sleep(interval)
        try:
            processed = await asyncio.to_thread(purge_all)
            logger.info("Scheduled retention purge finished for %s users", processed)
        except Exception:
            logger.exception("Scheduled retention purge failed")


if __name__ == "__main__":  # cron-friendly: python -m app.retention
    logging.basicConfig(level=logging.INFO)
    logger.info("Purged data for %s users", purge_all())
