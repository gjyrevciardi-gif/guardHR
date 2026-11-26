"""Migration tests. They need a real PostgreSQL server (set TEST_DATABASE_URL) and are skipped on SQLite."""

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

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
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0011"
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


def test_existing_users_keep_their_sessions_and_start_without_a_second_step_and_the_account_migration_downgrades_cleanly(scratch_engine):
    upgrade(scratch_engine, "0006")
    with scratch_engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id, email, password_hash, full_name) VALUES ('00000000-0000-0000-0000-000000000001', 'u@x.com', 'h', 'U')"))
    upgrade(scratch_engine)
    columns = "token_version, mfa_enabled, mfa_secret, mfa_last_step, mfa_recovery_hashes, password_reset_hash, password_reset_expires_at"
    with scratch_engine.connect() as connection:
        assert connection.execute(text(f"SELECT {columns} FROM users")).one() == (0, False, None, None, None, None, None)
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with scratch_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "0006")
    with scratch_engine.connect() as connection:
        names = {row[0] for row in connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"))}
        assert not set(columns.split(", ")) & names and "password_hash" in names
        assert connection.execute(text("SELECT count(*) FROM users")).scalar() == 1  # the account itself survives
    upgrade(scratch_engine)


def test_existing_submissions_start_without_signals_and_the_exam_migration_downgrades_cleanly(scratch_engine):
    upgrade(scratch_engine, "0007")
    with scratch_engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id, email, password_hash, full_name) VALUES ('00000000-0000-0000-0000-000000000001', 'u@x.com', 'h', 'U')"))
        connection.execute(text("INSERT INTO tests (id, created_by, public_token, title) VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'T')"))
        connection.execute(text("INSERT INTO test_submissions (id, test_id, answers) VALUES ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000004', '{}')"))
    upgrade(scratch_engine)
    with scratch_engine.connect() as connection:
        assert connection.execute(text("SELECT integrity_events::text FROM test_submissions")).scalar() == "[]"
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with scratch_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "0007")
    with scratch_engine.connect() as connection:
        columns = {row[0] for row in connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'test_submissions'"))}
        assert "integrity_events" not in columns and "answers" in columns
        assert connection.execute(text("SELECT count(*) FROM test_submissions")).scalar() == 1  # the answers survive
    upgrade(scratch_engine)


def test_existing_tests_keep_working_and_the_attempts_migration_downgrades_cleanly(scratch_engine):
    upgrade(scratch_engine, "0008")
    with scratch_engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id, email, password_hash, full_name) VALUES ('00000000-0000-0000-0000-000000000001', 'u@x.com', 'h', 'U')"))
        connection.execute(text("INSERT INTO tests (id, created_by, public_token, title) VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'T')"))
        connection.execute(text("INSERT INTO test_submissions (id, test_id, answers) VALUES ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000004', '{}')"))
    upgrade(scratch_engine)
    with scratch_engine.connect() as connection:
        assert tuple(connection.execute(text("SELECT time_limit_minutes, shuffle FROM tests")).one()) == (None, False)  # nothing changes for an existing test
        assert tuple(connection.execute(text("SELECT started_at, over_limit_seconds FROM test_submissions")).one()) == (None, None)

    insert = "INSERT INTO exam_attempts (test_id, participant_name, participant_email) VALUES ('00000000-0000-0000-0000-000000000004', 'A', 'a@x.com')"
    with scratch_engine.begin() as connection:
        connection.execute(text(insert))
    with pytest.raises(IntegrityError), scratch_engine.begin() as connection:
        connection.execute(text(insert))  # one attempt per test and email
    with pytest.raises(IntegrityError), scratch_engine.begin() as connection:
        connection.execute(text("UPDATE tests SET time_limit_minutes = 0"))  # the limit has bounds

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with scratch_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "0008")
    with scratch_engine.connect() as connection:
        tables = {row[0] for row in connection.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))}
        columns = {row[0] for row in connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name IN ('tests', 'test_submissions')"))}
        assert "exam_attempts" not in tables and not {"time_limit_minutes", "shuffle", "over_limit_seconds"} & columns and "answers" in columns
        assert connection.execute(text("SELECT count(*) FROM test_submissions")).scalar() == 1  # the answers survive
    upgrade(scratch_engine)


def test_the_email_code_migration_changes_nothing_for_existing_tests_and_downgrades_cleanly(scratch_engine):
    upgrade(scratch_engine, "0009")
    with scratch_engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id, email, password_hash, full_name) VALUES ('00000000-0000-0000-0000-000000000001', 'u@x.com', 'h', 'U')"))
        connection.execute(text("INSERT INTO tests (id, created_by, public_token, title) VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'T')"))
        connection.execute(text("INSERT INTO exam_attempts (test_id, participant_name, participant_email) VALUES ('00000000-0000-0000-0000-000000000004', 'A', 'a@x.com')"))
    upgrade(scratch_engine)
    with scratch_engine.connect() as connection:
        assert connection.execute(text("SELECT verify_candidate_email FROM tests")).scalar() is False  # an existing test behaves as before
        assert connection.execute(text("SELECT email_verified_at FROM exam_attempts")).scalar() is None

    insert = "INSERT INTO exam_email_codes (test_id, email) VALUES ('00000000-0000-0000-0000-000000000004', 'a@x.com')"
    with scratch_engine.begin() as connection:
        connection.execute(text(insert))
    with pytest.raises(IntegrityError), scratch_engine.begin() as connection:
        connection.execute(text(insert))  # one code row per test and address

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with scratch_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "0009")
    with scratch_engine.connect() as connection:
        tables = {row[0] for row in connection.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))}
        columns = {row[0] for row in connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name IN ('tests', 'exam_attempts', 'test_submissions')"))}
        assert "exam_email_codes" not in tables and not {"verify_candidate_email", "email_verified_at"} & columns
        assert connection.execute(text("SELECT count(*) FROM exam_attempts")).scalar() == 1  # the attempts survive
    upgrade(scratch_engine)


def test_the_draft_migration_gives_existing_attempts_an_empty_draft_and_downgrades_cleanly(scratch_engine):
    upgrade(scratch_engine, "0010")
    with scratch_engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id, email, password_hash, full_name) VALUES ('00000000-0000-0000-0000-000000000001', 'u@x.com', 'h', 'U')"))
        connection.execute(text("INSERT INTO tests (id, created_by, public_token, title) VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'T')"))
        connection.execute(text("INSERT INTO exam_attempts (test_id, participant_name, participant_email) VALUES ('00000000-0000-0000-0000-000000000004', 'A', 'a@x.com')"))
    upgrade(scratch_engine)
    with scratch_engine.connect() as connection:
        draft, saved_at = connection.execute(text("SELECT draft_answers, draft_saved_at FROM exam_attempts")).one()
        assert draft == {} and saved_at is None  # an attempt that began before the upgrade has nothing saved

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with scratch_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "0010")
    with scratch_engine.connect() as connection:
        columns = {row[0] for row in connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'exam_attempts'"))}
        assert not {"draft_answers", "draft_saved_at"} & columns and "participant_email" in columns
        assert connection.execute(text("SELECT count(*) FROM exam_attempts")).scalar() == 1  # the attempt itself survives
    upgrade(scratch_engine)
