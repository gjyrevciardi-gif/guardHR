"""Optional email one-time code before a candidate can start a call.

interview_sessions.verify_candidate_email is the host's option and defaults to false, so every existing call
keeps working exactly as before. The code itself is never stored, only its keyed hash (app/verification.py).
verified_at is kept as evidence like consented_at.

Additive and reversible.

Revision ID: 0005
Revises: 0004
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

COLUMNS = {
    "verify_candidate_email": "BOOLEAN NOT NULL DEFAULT FALSE",
    "verification_code_hash": "VARCHAR(64)",
    "verification_sent_at": "TIMESTAMPTZ",
    "verification_sends": "INTEGER NOT NULL DEFAULT 0",
    "verification_attempts": "INTEGER NOT NULL DEFAULT 0",
    "verified_at": "TIMESTAMPTZ",
}


def upgrade() -> None:
    for name, ddl in COLUMNS.items():
        op.execute(f"ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS {name} {ddl}")


def downgrade() -> None:
    for name in reversed(COLUMNS):
        op.execute(f"ALTER TABLE interview_sessions DROP COLUMN IF EXISTS {name}")
