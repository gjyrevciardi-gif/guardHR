"""Page signals recorded while a candidate takes a public exam.

test_submissions.integrity_events is a JSON list (tab left, paste, print attempts), empty for every existing row
and for plain forms. It lives on the submission so retention and deletion remove it with the answers.

Additive and reversible.

Revision ID: 0008
Revises: 0007
"""
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE test_submissions ADD COLUMN IF NOT EXISTS integrity_events JSON NOT NULL DEFAULT '[]'")


def downgrade() -> None:
    op.execute("ALTER TABLE test_submissions DROP COLUMN IF EXISTS integrity_events")
