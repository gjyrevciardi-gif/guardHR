import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from .api import auth, public, sessions, settings, signaling, tests
from .config import get_settings
from .database import Base, engine
from .monitoring import init_sentry
from .retention import retention_loop
from .vision import frame_stats, vision_installed

logger = logging.getLogger("nemoguard")
init_sentry(get_settings())  # before the app exists, so Sentry can hook FastAPI


@asynccontextmanager
async def lifespan(_: FastAPI):
    # PostgreSQL schemas are managed by Alembic (`alembic upgrade head`); create_all only serves SQLite dev/test runs.
    if engine.dialect.name == "sqlite":
        Base.metadata.create_all(bind=engine)
    if not vision_installed():
        logger.warning("YOLO/OpenCV are not installed: phone and extra-person detection is disabled (see README, INSTALL_CV).")
    purge_task = asyncio.create_task(retention_loop()) if get_settings().retention_purge_interval_hours > 0 else None
    yield
    if purge_task:
        purge_task.cancel()


app = FastAPI(title="NemoGuardHR API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origin_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(auth.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(public.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(signaling.router, prefix="/api")
app.include_router(tests.router, prefix="/api")
app.include_router(tests.public_router, prefix="/api")


@app.get("/api/health")
def health():
    body = {"status": "ok", "service": "NemoGuardHR API", "database": True, "vision": vision_installed(), "frames": frame_stats.snapshot()}
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        # A warning, not logger.exception: Docker polls this every 15 s and an outage would otherwise flood Sentry.
        logger.warning("Health check: database unreachable (%s)", type(exc).__name__)
        return JSONResponse({**body, "status": "degraded", "database": False}, status_code=503)
    return body
