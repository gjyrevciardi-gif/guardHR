"""Send one test email through the configured SMTP relay: `python -m app.mailcheck you@example.com`.

Invitations, the candidate's email code (calls and public exams) and password resets all go through the relay, and a
broken one only shows up as a candidate who never gets a code. Run this on the server before relying on any of them
(in Docker: `docker compose exec backend python -m app.mailcheck you@example.com`).
"""

import sys
from email.message import EmailMessage

from .config import get_settings
from .email import deliver


def build_test_message(recipient: str) -> EmailMessage:
    message = EmailMessage()
    message["Subject"] = "Email prove nga NemoGuardHR"
    message["From"] = get_settings().smtp_from_email
    message["To"] = recipient
    message.set_content(
        "Ky është një email prove nga NemoGuardHR. Nëse po e lexon, serveri i email-it funksionon: "
        "ftesat, kodet e verifikimit dhe rivendosja e fjalëkalimit do të arrijnë.\n\n"
        "This is a test message from NemoGuardHR. If you can read it, invitations, verification codes and password resets will arrive."
    )
    return message


def main(argv: list[str]) -> int:
    if len(argv) != 1 or "@" not in argv[0]:
        print("usage: python -m app.mailcheck you@example.com", file=sys.stderr)
        return 2
    settings = get_settings()
    relay = f"{settings.smtp_host}:{settings.smtp_port}" + (" (STARTTLS)" if settings.smtp_use_tls else "")
    if settings.is_production and settings.smtp_host == "mailpit":
        print("FAILED: SMTP_HOST is still 'mailpit', the development mail catcher; production has none. Set the SMTP_* values in .env.", file=sys.stderr)
        return 1
    try:
        deliver(build_test_message(argv[0]))
    except Exception as exc:  # whatever the relay or the network answers is the diagnosis
        print(f"FAILED: could not send through {relay}: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    print(f"OK: the relay at {relay} accepted a message for {argv[0]}. Accepted is not delivered: check that it arrived, and not in spam.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
