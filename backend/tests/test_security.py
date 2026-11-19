import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.services import parse_uuid, request_ip


def make_request(forwarded: str | None, client_host: str = "10.0.0.9") -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return Request({"type": "http", "headers": headers, "client": (client_host, 1234), "method": "GET", "path": "/"})


def test_forwarded_header_is_ignored_unless_proxy_is_trusted(settings, monkeypatch):
    request = make_request("1.2.3.4")
    assert request_ip(request) == "10.0.0.9"  # a client cannot forge its consent IP
    monkeypatch.setattr(settings, "trust_proxy_headers", True)
    assert request_ip(request) == "1.2.3.4"


def test_trusted_proxy_uses_the_entry_it_appended(settings, monkeypatch):
    monkeypatch.setattr(settings, "trust_proxy_headers", True)
    assert request_ip(make_request("6.6.6.6, 1.2.3.4")) == "1.2.3.4"  # the leftmost value is client-supplied
    assert request_ip(make_request(None)) == "10.0.0.9"


def test_parse_uuid_turns_garbage_into_404():
    assert parse_uuid("6F9619FF-8B86-D011-B42D-00C04FC964FF", "x") == "6f9619ff-8b86-d011-b42d-00c04fc964ff"
    with pytest.raises(HTTPException) as caught:
        parse_uuid("not-a-uuid", "missing")
    assert caught.value.status_code == 404 and caught.value.detail == "missing"
