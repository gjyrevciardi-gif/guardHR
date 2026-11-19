import json
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..config import get_settings
from ..database import SessionLocal
from ..enums import SessionStatus
from ..models import InterviewSession
from ..ratelimit import hit
from ..security import user_from_token
from ..services import request_ip

router = APIRouter(prefix="/ws/rooms", tags=["signaling"])

# ponytail: room state lives in this process, so run a single uvicorn worker.
# Scaling out needs Redis pub/sub (or sticky routing per room token).
rooms: dict[str, dict[str, WebSocket]] = {}  # room token -> {"hr" | "candidate": socket}

RELAYED_TYPES = {"offer", "answer", "ice", "screen-started", "screen-stopped"}
MAX_MESSAGE_BYTES = 64 * 1024

# Close codes (4xxx = application defined)
BAD_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED = 4400, 4401, 4403, 4404, 4409, 4429


async def send_json_safe(socket: WebSocket, payload: dict[str, Any]) -> None:
    try:
        await socket.send_json(payload)
    except (RuntimeError, WebSocketDisconnect):
        pass


async def broadcast_to_role(token: str, role: str, payload: dict[str, Any]) -> None:
    socket = rooms.get(token, {}).get(role)
    if socket:
        await send_json_safe(socket, payload)


async def broadcast_to_others(token: str, sender_role: str, payload: dict[str, Any]) -> None:
    for peer_role, socket in list(rooms.get(token, {}).items()):
        if peer_role != sender_role:
            await send_json_safe(socket, payload)


def authorize(websocket: WebSocket, token: str, role: str) -> tuple[str | None, int | None]:
    """Return (canonical room token, None) or (None, close code). The role is verified, never trusted."""
    settings = get_settings()
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in settings.allowed_origins:
        return None, FORBIDDEN  # blocks cross-site WebSocket hijacking
    if role not in ("hr", "candidate"):
        return None, BAD_REQUEST
    try:
        hit(f"ws:{request_ip(websocket) or 'unknown'}", 30, 60)
    except HTTPException:
        return None, RATE_LIMITED
    try:
        room_token = str(uuid.UUID(token))
    except ValueError:
        return None, NOT_FOUND

    with SessionLocal() as db:
        session = db.scalar(select(InterviewSession).where(InterviewSession.public_token == room_token))
        if not session:
            return None, NOT_FOUND
        if session.status in (SessionStatus.completed, SessionStatus.expired):
            return None, CONFLICT
        if role == "hr":
            user = user_from_token(db, websocket.cookies.get(settings.session_cookie_name))
            if not user or user.id != session.created_by:
                return None, UNAUTHORIZED
        elif session.status != SessionStatus.in_progress:
            return None, CONFLICT  # candidates join only after consent + start
    return room_token, None


@router.websocket("/{token}")
async def room_signaling(websocket: WebSocket, token: str, role: str = "candidate"):
    room_token, rejected = authorize(websocket, token, role)
    if rejected is not None:
        # Accept first, then close: a handshake refused before accept reaches browsers as a bare 1006,
        # which would hide the reason code the UI turns into a message. No room state is touched.
        await websocket.accept()
        await websocket.close(code=rejected)
        return

    await websocket.accept()
    room = rooms.setdefault(room_token, {})
    previous = room.get(role)
    room[role] = websocket
    if previous is not None:  # same role reconnecting (page refresh): the newest socket wins
        try:
            await previous.close(code=CONFLICT)
        except RuntimeError:
            pass

    await send_json_safe(websocket, {"type": "peers", "roles": [peer for peer in room if peer != role]})
    await broadcast_to_others(room_token, role, {"type": "peer-joined", "role": role})

    try:
        while True:
            text = await websocket.receive_text()
            if len(text) > MAX_MESSAGE_BYTES:
                continue
            try:
                payload = json.loads(text)
            except json.JSONDecodeError:
                continue
            # Clients may only relay WebRTC signaling; system messages (integrity-event, peers, ...) are server-only.
            if not isinstance(payload, dict) or payload.get("type") not in RELAYED_TYPES:
                continue
            payload["from"] = role
            await broadcast_to_others(room_token, role, payload)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        if rooms.get(room_token, {}).get(role) is websocket:
            del rooms[room_token][role]
            await broadcast_to_others(room_token, role, {"type": "peer-left", "role": role})
            if not rooms[room_token]:
                rooms.pop(room_token, None)
