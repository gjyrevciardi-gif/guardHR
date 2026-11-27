"""Attempts at a public exam, a time limit, and a per-candidate order.

exam_attempts: one row per test and email, written when a candidate starts (name, email, IP, start time, the question
and option order shown, submitted_at once they submit). It is what lets a restart resume the same clock and order, and
shows the host who started and never finished. tests gets time_limit_minutes (NULL = no limit) and shuffle (default
off, so existing tests behave as before). test_submissions gets started_at and over_limit_seconds, NULL for every
existing row.

Additive and reversible. Downgrading discards attempts (and so the record of who started and never submitted).

Revision ID: 0009
Revises: 0008
"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE tests ADD COLUMN IF NOT EXISTS time_limit_minutes INTEGER")
    op.execute("ALTER TABLE tests ADD COLUMN IF NOT EXISTS shuffle BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("ALTER TABLE tests DROP CONSTRAINT IF EXISTS ck_tests_time_limit_minutes")
    op.execute("ALTER TABLE tests ADD CONSTRAINT ck_tests_time_limit_minutes CHECK (time_limit_minutes IS NULL OR time_limit_minutes BETWEEN 1 AND 480)")
    op.execute("ALTER TABLE test_submissions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ")
    op.execute("ALTER TABLE test_submissions ADD COLUMN IF NOT EXISTS over_limit_seconds INTEGER")
    op.execute(
        """CREATE TABLE IF NOT EXISTS exam_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    participant_name VARCHAR(160) NOT NULL,
    participant_email VARCHAR(255) NOT NULL,
    participant_ip VARCHAR(64),
    layout JSON NOT NULL DEFAULT '[]',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ,
    CONSTRAINT uq_exam_attempts_test_email UNIQUE (test_id, participant_email)
)"""
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS exam_attempts")
    op.execute("ALTER TABLE test_submissions DROP COLUMN IF EXISTS over_limit_seconds")
    op.execute("ALTER TABLE test_submissions DROP COLUMN IF EXISTS started_at")
    op.execute("ALTER TABLE tests DROP CONSTRAINT IF EXISTS ck_tests_time_limit_minutes")
    op.execute("ALTER TABLE tests DROP COLUMN IF EXISTS shuffle")
    op.execute("ALTER TABLE tests DROP COLUMN IF EXISTS time_limit_minutes")
