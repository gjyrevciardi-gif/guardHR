"""The invitation is the candidate's first contact with the product: Albanian, specific to the call, and honest about what is recorded."""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.email import build_candidate_invite, local_expiry


def make_session(**overrides):
    base = {
        "title": "Frontend screening",
        "public_token": "0b9d6a52-6d3a-4e9d-8b0e-0c1f8a6f6a11",
        "require_screen_share": False,
        "verify_candidate_email": False,
        "test": None,
        "expires_at": datetime(2026, 11, 20, 14, 30, tzinfo=timezone.utc),
        "candidate": SimpleNamespace(full_name="Dren Krasniqi", email="dren@example.com"),
        "creator": SimpleNamespace(full_name="Arta Hoxha", retention_days=30),
    }
    return SimpleNamespace(**{**base, **overrides})


def body(message) -> str:
    return message.get_content()


def test_invite_names_the_host_the_call_and_the_local_deadline():
    message = build_candidate_invite(make_session())
    text = body(message)
    assert message["Subject"] == "Ftesë për call: Frontend screening"
    assert message["To"] == "dren@example.com"
    assert "Arta Hoxha të ftoi në call-in \"Frontend screening\"" in text
    assert "/join/0b9d6a52-6d3a-4e9d-8b0e-0c1f8a6f6a11" in text
    assert "20.11.2026, 15:30 (ora e Kosovës)" in text  # 14:30 UTC is 15:30 in winter
    assert "Video dhe zëri nuk regjistrohen" in text and "30 ditë pas përfundimit" in text
    assert "English:" in text and "2026-11-20 14:30 UTC" in text


def test_invite_only_mentions_what_this_call_needs():
    plain = body(build_candidate_invite(make_session()))
    assert "ndash ekranin" not in plain and "kod 6-shifror" not in plain and "test brenda call-it" not in plain

    full = body(build_candidate_invite(make_session(require_screen_share=True, verify_candidate_email=True, test=object())))
    assert "ndash ekranin" in full and "kod 6-shifror" in full and "test brenda call-it" in full


def test_local_expiry_treats_naive_datetimes_as_utc_and_follows_summer_time():
    assert local_expiry(datetime(2026, 7, 1, 10, 0)) == "01.07.2026, 12:00 (ora e Kosovës)"


def test_invite_requires_an_email_address():
    with pytest.raises(ValueError):
        build_candidate_invite(make_session(candidate=SimpleNamespace(full_name="Dren", email=None)))
