import logging
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .config import get_settings
from .database import SessionLocal
from .models import InterviewSession
from .services import record_audit
from .signals import as_utc
from .verification import CODE_TTL_SECONDS

logger = logging.getLogger("nemoguard.email")


def build_candidate_link(public_token: str) -> str:
    settings = get_settings()
    return f"{settings.public_app_url.rstrip('/')}/join/{public_token}"


def local_expiry(value: datetime) -> str:
    """The link's deadline in the candidate's likely clock (Kosovo), e.g. "20.11.2026, 14:30 (ora e Kosovës)"."""
    try:
        return f"{as_utc(value).astimezone(ZoneInfo('Europe/Belgrade')):%d.%m.%Y, %H:%M} (ora e Kosovës)"
    except ZoneInfoNotFoundError:  # minimal images without tzdata: say UTC rather than guess
        return f"{as_utc(value).astimezone(timezone.utc):%d.%m.%Y, %H:%M} UTC"


def build_candidate_invite(session: InterviewSession) -> EmailMessage:
    """Albanian invitation with a short English line. Mentions only what this particular call needs."""
    settings = get_settings()
    if not session.candidate.email:
        raise ValueError("Candidate email is missing")
    link = build_candidate_link(session.public_token)
    host = session.creator.full_name
    needs = ["Një kompjuter me browser modern (Chrome, Edge, Firefox ose Safari) dhe lidhje interneti të qëndrueshme.", "Kamerën dhe mikrofonin (janë opsionale)."]
    if session.require_screen_share:
        needs.append("Të ndash ekranin: ky call e kërkon.")
    if session.test:
        needs.append("Disa minuta për një test brenda call-it.")
    steps = ["Hap linkun dhe lexo çfarë regjistrohet, pse dhe sa kohë ruhet. Hyrja kërkon pranimin tënd."]
    if session.verify_candidate_email:
        steps.append("Do të marrësh një kod 6-shifror në këtë email; shkruaje para se të hysh.")
    steps.append("Kontrollo kamerën dhe mikrofonin dhe hyr në call.")

    message = EmailMessage()
    message["Subject"] = f"Ftesë për call: {session.title}"
    message["From"] = settings.smtp_from_email
    message["To"] = session.candidate.email
    message.set_content(
        "\n".join(
            [
                f"Përshëndetje {session.candidate.full_name},",
                "",
                f"{host} të ftoi në call-in \"{session.title}\" në NemoGuardHR.",
                "",
                "Çfarë të duhet:",
                *[f"  - {item}" for item in needs],
                "",
                "Si hyn:",
                *[f"  {number}. {step}" for number, step in enumerate(steps, 1)],
                "",
                link,
                "",
                f"Linku skadon më {local_expiry(session.expires_at)}.",
                "",
                "Gjatë call-it regjistrohen sinjale aktiviteti (p.sh. dalje nga faqja, copy/paste) që i shqyrton një njeri. "
                "Video dhe zëri nuk regjistrohen dhe asnjë vendim nuk merret automatikisht. "
                f"Të dhënat fshihen {session.creator.retention_days} ditë pas përfundimit të call-it.",
                "",
                f"Questions about the call? Contact {host}. / Pyetje? Kontakto {host}.",
                "",
                f"English: {host} invited you to the call \"{session.title}\". Open the link above, read what is recorded and accept it to join. The link expires {as_utc(session.expires_at):%Y-%m-%d %H:%M} UTC.",
            ]
        )
    )
    return message


def send_candidate_invite(session: InterviewSession) -> str:
    message = build_candidate_invite(session)
    deliver(message)
    return build_candidate_link(session.public_token)


def deliver(message: EmailMessage) -> None:
    settings = get_settings()
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)


def send_verification_code(session: InterviewSession, code: str) -> None:
    """Email the one-time code to the invited candidate. Raises on SMTP failure; the caller decides what to tell the user."""
    if not session.candidate.email:
        raise ValueError("Candidate email is missing")
    minutes = CODE_TTL_SECONDS // 60
    message = EmailMessage()
    message["Subject"] = f"Kodi i verifikimit NemoGuardHR: {code}"
    message["From"] = get_settings().smtp_from_email
    message["To"] = session.candidate.email
    message.set_content(
        "\n".join(
            [
                f"Përshëndetje {session.candidate.full_name},",
                "",
                f"Kodi yt i verifikimit për call-in \"{session.title}\" është: {code}",
                f"Vlen {minutes} minuta. Mos e jep te askush.",
                "Nëse nuk po hyn në një call, injoroje këtë email.",
                "",
                f"Your verification code for \"{session.title}\" is {code}. It is valid for {minutes} minutes. Ignore this email if you are not joining a call.",
            ]
        )
    )
    deliver(message)


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
