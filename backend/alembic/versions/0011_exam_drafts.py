"""Answers saved on the server while a candidate sits a public exam.

exam_attempts gets draft_answers (JSON, default empty) and draft_saved_at (NULL until the first save). The draft is what
the candidate has answered so far; it is emptied when they submit and removed with the attempt (retention, release, test
deletion). Every existing attempt starts with an empty draft.

Additive and reversible. Downgrading discards the saved drafts (submissions are not affected).

Revision ID: 0011
Revises: 0010
"""
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS draft_answers JSON NOT NULL DEFAULT '{}'")
    op.execute("ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS draft_saved_at TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE exam_attempts DROP COLUMN IF EXISTS draft_saved_at")
    op.execute("ALTER TABLE exam_attempts DROP COLUMN IF EXISTS draft_answers")
