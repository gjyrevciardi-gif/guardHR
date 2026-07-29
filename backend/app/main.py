from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import auth, public, sessions, settings, signaling, tests
from .config import get_settings
from .database import Base, engine
from .migrations import run_lightweight_migrations


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    run_lightweight_migrations()
    yield


app = FastAPI(title="InterviewGuard API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origin_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(auth.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(public.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(signaling.router, prefix="/api")
app.include_router(tests.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "InterviewGuard API"}
