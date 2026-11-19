import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from .config import get_settings
from .services import request_ip

# ponytail: in-process sliding window. Correct for a single uvicorn worker;
# move the counters to Redis if the backend is ever scaled out.
_hits: dict[str, deque[float]] = defaultdict(deque)


def hit(key: str, limit: int, window_seconds: int) -> None:
    """Count one hit for `key`; raise 429 once `limit` hits happened inside the window."""
    if not get_settings().rate_limit_enabled:
        return
    now = time.monotonic()
    hits = _hits[key]
    while hits and hits[0] <= now - window_seconds:
        hits.popleft()
    if len(hits) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.", headers={"Retry-After": str(window_seconds)})
    hits.append(now)
    if len(_hits) > 10_000:
        for stale in [name for name, window in _hits.items() if not window or window[-1] < now - 3600]:
            del _hits[stale]


def rate_limit(bucket: str, limit: int, window_seconds: int, path_param: str | None = None):
    """FastAPI dependency limiting a route per client IP (and optionally per path parameter)."""

    def dependency(request: Request) -> None:
        key = f"{bucket}:{request_ip(request) or 'unknown'}"
        if path_param:
            key += f":{request.path_params.get(path_param, '')}"
        hit(key, limit, window_seconds)

    return dependency


def reset_rate_limits() -> None:
    _hits.clear()
