"""Migration tests. They need a real PostgreSQL server (set TEST_DATABASE_URL) and are skipped on SQLite."""

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from alembic import command
from app.database import engine

pytestmark = pytest.mark.skipif(engine.dialect.name != "postgresql", reason="migrations are PostgreSQL-only")

BACKEND_DIR = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"
SCRATCH_DB = "nemoguard_migration_scratch"


@pytest.fixture
def scratch_engine():
    """An empty throwaway database next to the test database."""
    admin = create_engine(engine.url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{SCRATCH_DB}"'))
        connection.execute(text(f'CREATE DATABASE "{SCRATCH_DB}"'))
    scratch = create_engine(make_url(engine.url.render_as_string(hide_password=False)).set(database=SCRATCH_DB))
    yield scratch
    scratch.dispose()
    with admin.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{SCRATCH_DB}"'))
    admin.dispose()


def upgrade(scratch, revision: str = "head") -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with scratch.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, revision)


def run_script(scratch, name: str) -> None:
    with scratch.begin() as connection:
        connection.exec_driver_sql((FIXTURES / name).read_text(encoding="utf-8"))


def test_fresh_database_reaches_head(scratch_engine):
    upgrade(scratch_engine)
    with scratch_engine.connect() as connection:
        tables = {row[0] for row in connection.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))}
        assert {"users", "candidates", "interview_sessions", "tests", "test_submissions", "alembic_version"} <= tables
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0003"
    upgrade(scratch_engine)  # running again is a no-op


def test_database_from_the_first_release_is_upgraded_and_shared_candidates_are_split(scratch_engine):
    run_script(scratch_engine, "legacy_schema_v1.sql")  # what the very first docker image created
    run_script(scratch_engine, "legacy_seed.sql")  # one candidate shared by two HR users, one orphan
    upgrade(scratch_engine)

    with scratch_engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT c.email, u.email AS owner, (SELECT string_agg(s.title, ',' ORDER BY s.title) FROM interview_sessions s WHERE s.candidate_id = c.id) "
                "FROM candidates c JOIN users u ON u.id = c.created_by ORDER BY 1, 2"
            )
        ).all()
        assert rows == [("only-b@x.com", "b@x.com", "S4"), ("shared@x.com", "a@x.com", "S1,S3"), ("shared@x.com", "b@x.com", "S2")]  # orphan row is gone
        wrong_owner = connection.execute(text("SELECT count(*) FROM interview_sessions s JOIN candidates c ON c.id = s.candidate_id WHERE c.created_by <> s.created_by")).scalar()
        assert wrong_owner == 0
        # the old narrow CHECK would have rejected these event types
        connection.execute(text("INSERT INTO integrity_events (session_id, event_type) SELECT id, 'window_resized' FROM interview_sessions LIMIT 1"))
        connection.rollback()
        with pytest.raises(Exception, match="uq_candidates_created_by_email"):
            connection.execute(text("INSERT INTO candidates (created_by, email, full_name) SELECT created_by, email, full_name FROM candidates LIMIT 1"))
