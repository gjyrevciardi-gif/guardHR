import pytest
from starlette.websockets import WebSocketDisconnect

from app.api import signaling
from app.security import create_access_token
from helpers import event_payload

UNKNOWN = "6f9619ff-8b86-d011-b42d-00c04fc964ff"


def room_url(token: str, role: str) -> str:
    return f"/api/ws/rooms/{token}?role={role}"


def cookie_for(client, headers: dict[str, str]) -> dict[str, str]:
    user_id = client.get("/api/auth/me", headers=headers).json()["id"]
    return {"cookie": f"nemoguard_session={create_access_token(user_id)}"}


def assert_rejected(client, url: str, code: int, **kwargs) -> None:
    with pytest.raises(WebSocketDisconnect) as caught:
        with client.websocket_connect(url, **kwargs) as socket:
            socket.receive_json()  # the server closes right after accepting, with the reason code
    assert caught.value.code == code


def test_connections_are_rejected_unless_verified(client, hr, other_hr, new_session):
    data = new_session(hr)
    token = data["public_token"]
    assert_rejected(client, room_url(UNKNOWN, "candidate"), signaling.NOT_FOUND)
    assert_rejected(client, room_url("garbage", "candidate"), signaling.NOT_FOUND)
    assert_rejected(client, room_url(token, "admin"), signaling.BAD_REQUEST)
    assert_rejected(client, room_url(token, "candidate"), signaling.CONFLICT)  # candidate has not consented/started
    assert_rejected(client, room_url(token, "hr"), signaling.UNAUTHORIZED)  # claiming the host role without a session
    assert_rejected(client, room_url(token, "hr"), signaling.UNAUTHORIZED, headers=cookie_for(client, other_hr))  # someone else's account
    assert_rejected(client, room_url(token, "hr"), signaling.UNAUTHORIZED, headers={"cookie": "nemoguard_session=forged"})
    owner = cookie_for(client, hr)
    assert_rejected(client, room_url(token, "hr"), signaling.FORBIDDEN, headers=owner | {"origin": "https://evil.example"})  # cross-site hijack attempt
    with client.websocket_connect(room_url(token, "hr"), headers=owner | {"origin": "http://localhost:3100"}) as ws:
        assert ws.receive_json() == {"type": "peers", "roles": []}


def test_candidate_cannot_claim_the_host_role(client, started_session):
    assert_rejected(client, room_url(started_session["public_token"], "hr"), signaling.UNAUTHORIZED)


def test_signaling_is_relayed_between_the_two_roles(client, hr, started_session):
    token = started_session["public_token"]
    with client.websocket_connect(room_url(token, "hr"), headers=cookie_for(client, hr)) as host:
        assert host.receive_json() == {"type": "peers", "roles": []}
        with client.websocket_connect(room_url(token, "candidate")) as candidate:
            assert candidate.receive_json() == {"type": "peers", "roles": ["hr"]}
            assert host.receive_json() == {"type": "peer-joined", "role": "candidate"}

            candidate.send_json({"type": "offer", "description": {"sdp": "x"}})
            assert host.receive_json() == {"type": "offer", "description": {"sdp": "x"}, "from": "candidate"}
            host.send_json({"type": "answer", "description": {"sdp": "y"}})
            assert candidate.receive_json() == {"type": "answer", "description": {"sdp": "y"}, "from": "hr"}


def test_clients_cannot_forge_server_messages_or_crash_the_room(client, hr, started_session):
    token = started_session["public_token"]
    with client.websocket_connect(room_url(token, "hr"), headers=cookie_for(client, hr)) as host:
        host.receive_json()
        with client.websocket_connect(room_url(token, "candidate")) as candidate:
            candidate.receive_json()
            host.receive_json()  # peer-joined
            candidate.send_json({"type": "integrity-event", "event": {"event_type": "phone_detected"}})  # forged detection
            candidate.send_json({"type": "peers", "roles": []})
            candidate.send_json([1, 2, 3])  # used to raise TypeError server-side
            candidate.send_text("not json")
            candidate.send_text("x" * (signaling.MAX_MESSAGE_BYTES + 1))
            candidate.send_json({"type": "ice", "candidate": {"c": 1}})
            assert host.receive_json() == {"type": "ice", "candidate": {"c": 1}, "from": "candidate"}  # everything before it was dropped


def test_integrity_events_reach_only_the_host(client, hr, started_session):
    token = started_session["public_token"]
    with client.websocket_connect(room_url(token, "hr"), headers=cookie_for(client, hr)) as host:
        host.receive_json()
        with client.websocket_connect(room_url(token, "candidate")) as candidate:
            candidate.receive_json()
            host.receive_json()
            assert client.post(f"/api/public/sessions/{token}/events", json=event_payload(event_type="phone_detected")).status_code == 201
            message = host.receive_json()
            assert message["type"] == "integrity-event" and message["event"]["event_type"] == "phone_detected"
            assert message["event"]["duration_seconds"] == 1.5
            host.send_json({"type": "screen-started"})
            assert candidate.receive_json() == {"type": "screen-started", "from": "hr"}  # nothing else was queued for the candidate


def test_reconnecting_replaces_the_old_socket_and_peer_left_is_sent_once(client, hr, started_session):
    token = started_session["public_token"]
    owner = cookie_for(client, hr)
    with client.websocket_connect(room_url(token, "hr"), headers=owner) as host:
        host.receive_json()
        with client.websocket_connect(room_url(token, "candidate")) as first:
            first.receive_json()
            host.receive_json()
            with client.websocket_connect(room_url(token, "candidate")) as second:
                assert second.receive_json() == {"type": "peers", "roles": ["hr"]}
                with pytest.raises(WebSocketDisconnect) as caught:
                    first.receive_json()
                assert caught.value.code == signaling.CONFLICT
                assert host.receive_json() == {"type": "peer-joined", "role": "candidate"}
                second.send_json({"type": "ice", "candidate": {}})
                assert host.receive_json()["type"] == "ice"  # the replaced socket's disconnect did not announce peer-left
        assert host.receive_json() == {"type": "peer-left", "role": "candidate"}
    assert signaling.rooms == {}


def test_finished_sessions_close_the_room(client, hr, started_session):
    token = started_session["public_token"]
    client.post(f"/api/public/sessions/{token}/finish")
    assert_rejected(client, room_url(token, "candidate"), signaling.CONFLICT)
    assert_rejected(client, room_url(token, "hr"), signaling.CONFLICT, headers=cookie_for(client, hr))


def test_connection_attempts_are_rate_limited(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    for _ in range(30):
        assert_rejected(client, room_url(UNKNOWN, "candidate"), signaling.NOT_FOUND)
    assert_rejected(client, room_url(UNKNOWN, "candidate"), signaling.RATE_LIMITED)


def test_closing_an_episode_tells_the_host_the_participant_returned(client, hr, started_session):
    token = started_session["public_token"]
    with client.websocket_connect(room_url(token, "hr"), headers=cookie_for(client, hr)) as host:
        host.receive_json()
        with client.websocket_connect(room_url(token, "candidate")) as candidate:
            candidate.receive_json()
            host.receive_json()
            opened = client.post(f"/api/public/sessions/{token}/events", json=event_payload(duration_seconds=None, ended_at=None)).json()
            assert host.receive_json()["type"] == "integrity-event"
            assert client.patch(f"/api/public/sessions/{token}/events/{opened['id']}", json={"ended_at": event_payload()["started_at"], "duration_seconds": 42}).status_code == 200
            message = host.receive_json()
            assert message["type"] == "integrity-event-closed" and message["event"]["id"] == opened["id"] and message["event"]["duration_seconds"] == 42
