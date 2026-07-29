from collections import defaultdict
from json import JSONDecodeError
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/ws/rooms", tags=["signaling"])

rooms: dict[str, list[tuple[WebSocket, str]]] = defaultdict(list)


async def send_json_safe(socket: WebSocket, payload: dict[str, Any]) -> None:
    try:
        await socket.send_json(payload)
    except RuntimeError:
        pass


async def broadcast(token: str, sender: WebSocket, payload: dict[str, Any]) -> None:
    for socket, _ in list(rooms[token]):
        if socket is not sender:
            await send_json_safe(socket, payload)


async def broadcast_system(token: str, payload: dict[str, Any]) -> None:
    for socket, _ in list(rooms[token]):
        await send_json_safe(socket, payload)


@router.websocket("/{token}")
async def room_signaling(websocket: WebSocket, token: str, role: str = "guest"):
    await websocket.accept()
    peers = [peer_role for _, peer_role in rooms[token]]
    rooms[token].append((websocket, role))
    await send_json_safe(websocket, {"type": "peers", "roles": peers})
    await broadcast(token, websocket, {"type": "peer-joined", "role": role})

    try:
        while True:
            try:
                payload = await websocket.receive_json()
            except JSONDecodeError:
                continue
            payload["from"] = role
            await broadcast(token, websocket, payload)
    except WebSocketDisconnect:
        rooms[token] = [(socket, peer_role) for socket, peer_role in rooms[token] if socket is not websocket]
        await broadcast(token, websocket, {"type": "peer-left", "role": role})
        if not rooms[token]:
            rooms.pop(token, None)
