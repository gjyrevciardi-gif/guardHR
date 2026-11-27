"""Email code before a public exam's questions are handed out.

tests.verify_candidate_email (default off, so existing tests behave as before). exam_email_codes: one row per test and
address, written when someone asks for a code (only a keyed hash of the code is stored). exam_attempts and
test_submissions get email_verified_at, NULL for every existing row and for every exam that does not check email.

Additive and reversible. Downgrading discards the pending codes and the verified-at times.

Revision ID: 0010
Revises: 0009
"""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE tests ADD COLUMN IF NOT EXISTS verify_candidate_email BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ")
    op.execute("ALTER TABLE test_submissions ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ")
    op.execute(
        """CREATE TABLE IF NOT EXISTS exam_email_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    verification_code_hash VARCHAR(64),
    verification_sent_at TIMESTAMPTZ,
    verification_sends INTEGER NOT NULL DEFAULT 0,
    verification_attempts INTEGER NOT NULL DEFAULT 0,
    verified_at TIMESTAMPTZ,
    CONSTRAINT uq_exam_email_codes_test_email UNIQUE (test_id, email)
)"""
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS exam_email_codes")
    op.execute("ALTER TABLE test_submissions DROP COLUMN IF EXISTS email_verified_at")
    op.execute("ALTER TABLE exam_attempts DROP COLUMN IF EXISTS email_verified_at")
    op.execute("ALTER TABLE tests DROP COLUMN IF EXISTS verify_candidate_email")
