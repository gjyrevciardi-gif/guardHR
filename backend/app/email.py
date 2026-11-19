import logging
import smtplib
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .config import get_settings
from .database import SessionLocal
from .models import InterviewSession
from .services import record_audit

logger = logging.getLogger("nemoguard.email")


def build_candidate_link(public_token: str) -> str:
    settings = get_settings()
    return f"{settings.public_app_url.rstrip('/')}/join/{public_token}"


def send_candidate_invite(session: InterviewSession) -> str:
    settings = get_settings()
    candidate_link = build_candidate_link(session.public_token)
    if not session.candidate.email:
        raise ValueError("Candidate email is missing")

    message = EmailMessage()
    message["Subject"] = f"NemoGuardHR invite: {session.title}"
    message["From"] = settings.smtp_from_email
    message["To"] = session.candidate.email
    message.set_content(
        "\n".join(
            [
                f"Hello {session.candidate.full_name},",
                "",
                "You have been invited to a NemoGuardHR call.",
                "Please open this link to review the consent notice and join the call:",
                "",
                candidate_link,
                "",
                "NemoGuardHR records activity signals such as tab changes, focus loss, copy/paste, and test activity for the host to review.",
                "It does not automatically accuse, reject, or label participants.",
                "",
                f"This link expires at: {session.expires_at.isoformat()}",
            ]
        )
    )

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)

    return candidate_link


def deliver_invite(session_id: str, user_id: str, ip: str | None) -> None:
    """Background task: send the invite and audit the outcome. The SMTP error stays in the server log only."""
    with SessionLocal() as db:
        session = db.scalar(select(InterviewSession).options(selectinload(InterviewSession.candidate)).where(InterviewSession.id == session_id))
        if not session:
            return
        try:
            send_candidate_invite(session)
            action = "participant.invite.email_sent"
        except Exception:
            logger.exception("Invite email for session %s could not be delivered", session_id)
            action = "participant.invite.email_failed"
        record_audit(db, user_id=user_id, ip=ip, action=action, entity_type="call", entity_id=session.id, session_id=session.id, details={"candidate_id": session.candidate_id})
        db.commit()
