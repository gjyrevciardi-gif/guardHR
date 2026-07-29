from sqlalchemy import text

from .database import engine


def run_lightweight_migrations() -> None:
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE candidates ALTER COLUMN email DROP NOT NULL"))
        conn.execute(text("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS test_id UUID NULL REFERENCES tests(id) ON DELETE SET NULL"))
