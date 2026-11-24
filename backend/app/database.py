from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


database_url = get_settings().database_url
# connect_timeout: with the database down, /api/health must answer 503 inside the 3 s the Docker healthcheck waits, not hang.
connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {"connect_timeout": 3}
engine = create_engine(database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

