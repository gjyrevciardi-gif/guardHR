import re

import sentry_sdk

from .config import Settings

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def _mask(text: str) -> str:
    return EMAIL.sub("[email]", text)


def scrub_event(event: dict, hint: dict) -> dict:
    """Send the stack trace and nothing about the people: candidate names, answers and join links live in the request
    (body, URL, headers), the breadcrumbs and the user block; an SMTP error can quote the recipient in its message."""
    for key in ("request", "breadcrumbs", "user"):
        event.pop(key, None)
    for value in event.get("exception", {}).get("values", []):
        if value.get("value"):
            value["value"] = _mask(value["value"])
    entry = event.get("logentry")
    if entry:
        entry["message"] = _mask(entry.get("message") or "")
        entry.pop("params", None)
    return event


def init_sentry(settings: Settings) -> None:
    if not settings.sentry_dsn:
        return
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        max_breadcrumbs=0,
        traces_sample_rate=0,
        before_send=scrub_event,
    )
