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
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0006"
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


def test_severity_is_backfilled_and_existing_calls_have_no_coverage_figure(scratch_engine):
    upgrade(scratch_engine, "0003")
    with scratch_engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id, email, password_hash, full_name) VALUES ('00000000-0000-0000-0000-000000000001', 'u@x.com', 'h', 'U')"))
        connection.execute(text("INSERT INTO candidates (id, email, full_name, created_by) VALUES ('00000000-0000-0000-0000-000000000002', 'c@x.com', 'C', '00000000-0000-0000-0000-000000000001')"))
        connection.execute(
            text(
                "INSERT INTO interview_sessions (id, created_by, candidate_id, title, status, started_at, expires_at) "
                "VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'S', 'in_progress', NOW(), NOW() + INTERVAL '1 day')"
            )
        )
        for event_type, duration, metadata in (("phone_detected", None, "{}"), ("face_not_visible", None, "{}"), ("tab_hidden", 45, "{}"), ("tab_hidden", 3, "{}"), ("copy_paste", None, '{"operation": "paste"}'), ("copy_paste", None, '{"operation": "copy"}'), ("window_resized", None, "{}")):
            connection.execute(
                text("INSERT INTO integrity_events (session_id, event_type, duration_seconds, metadata) VALUES ('00000000-0000-0000-0000-000000000003', :t, :d, CAST(:m AS jsonb))"),
                {"t": event_type, "d": duration, "m": metadata},
            )
    upgrade(scratch_engine)
    with scratch_engine.connect() as connection:
        severities = connection.execute(text("SELECT event_type, duration_seconds, severity FROM integrity_events ORDER BY severity DESC, event_type, duration_seconds")).all()
        assert [row[2] for row in severities] == [3, 2, 2, 2, 1, 1, 0]
        session = connection.execute(text("SELECT monitored_seconds, face_seconds, last_seen_at, monitor_gaps FROM interview_sessions")).one()
        assert session == (None, None, None, 0)  # "not tracked", not "zero coverage"
        with pytest.raises(Exception, match="ck_integrity_events_severity"):
            connection.execute(text("UPDATE integrity_events SET severity = 9"))


def test_signal_migration_downgrades_cleanly(scratch_engine):
    upgrade(scratch_engine)
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with scratch_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "0003")
    with scratch_engine.connect() as connection:
        columns = {row[0] for row in connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name IN ('integrity_events', 'interview_sessions')"))}
        assert not {"severity", "last_seen_at", "monitored_seconds", "face_seconds", "monitor_gaps"} & columns
    upgrade(scratch_engine)  # and it can be applied again


def test_existing_calls_do_not_suddenly_require_email_verification(scratch_engine):
    upgrade(scratch_engine, "0004")
    with scratch_engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id, email, password_hash, full_name) VALUES ('00000000-0000-0000-0000-000000000001', 'u@x.com', 'h', 'U')"))
        connection.execute(text("INSERT INTO candidates (id, email, full_name, created_by) VALUES ('00000000-0000-0000-0000-000000000002', 'c@x.com', 'C', '00000000-0000-0000-0000-000000000001')"))
        connection.execute(
            text(
                "INSERT INTO interview_sessions (id, created_by, candidate_id, title, status, expires_at) "
                "VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'S', 'scheduled', NOW() + INTERVAL '1 day')"
            )
        )
    upgrade(scratch_engine)
    with scratch_engine.connect() as connection:
        row = connection.execute(text("SELECT verify_candidate_email, verification_code_hash, verified_at, verification_sends, verification_attempts FROM interview_sessions")).one()
        assert row == (False, None, None, 0, 0)


def test_verification_migration_downgrades_cleanly(scratch_engine):
    upgrade(scratch_engine)
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with scratch_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "0004")
    with scratch_engine.connect() as connection:
        columns = {row[0] for row in connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'interview_sessions'"))}
        assert not {"verify_candidate_email", "verification_code_hash", "verification_sent_at", "verification_sends", "verification_attempts", "verified_at"} & columns
        assert "monitored_seconds" in columns  # 0004 is untouched
    upgrade(scratch_engine)


def test_existing_calls_start_without_notes_and_the_notes_migration_downgrades_cleanly(scratch_engine):
    upgrade(scratch_engine, "0005")
    with scratch_engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id, email, password_hash, full_name) VALUES ('00000000-0000-0000-0000-000000000001', 'u@x.com', 'h', 'U')"))
        connection.execute(text("INSERT INTO candidates (id, email, full_name, created_by) VALUES ('00000000-0000-0000-0000-000000000002', 'c@x.com', 'C', '00000000-0000-0000-0000-000000000001')"))
        connection.execute(
            text(
                "INSERT INTO interview_sessions (id, created_by, candidate_id, title, status, expires_at) "
                "VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'S', 'scheduled', NOW() + INTERVAL '1 day')"
            )
        )
    upgrade(scratch_engine)
    with scratch_engine.connect() as connection:
        assert connection.execute(text("SELECT host_notes FROM interview_sessions")).scalar() is None
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with scratch_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "0005")
    with scratch_engine.connect() as connection:
        columns = {row[0] for row in connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'interview_sessions'"))}
        assert "host_notes" not in columns and "verified_at" in columns  # 0005 is untouched
    upgrade(scratch_engine)
