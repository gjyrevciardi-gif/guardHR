from email.message import EmailMessage
import smtplib

from .config import get_settings
from .models import InterviewSession


def build_candidate_link(public_token: str) -> str:
    settings = get_settings()
    return f"{settings.public_app_url.rstrip('/')}/join/{public_token}"


def send_candidate_invite(session: InterviewSession) -> str:
    settings = get_settings()
    candidate_link = build_candidate_link(session.public_token)
    if not session.candidate.email:
        raise ValueError("Candidate email is missing")

    message = EmailMessage()
    message["Subject"] = f"Nemo Call invite: {session.title}"
    message["From"] = settings.smtp_from_email
    message["To"] = session.candidate.email
    message.set_content(
        "\n".join(
            [
                f"Hello {session.candidate.full_name},",
                "",
                "You have been invited to a Nemo Call session.",
                "Please open this link to review the consent notice and join the call:",
                "",
                candidate_link,
                "",
                "Nemo Call records activity signals such as tab changes, focus loss, copy/paste, and test activity for the host to review.",
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
