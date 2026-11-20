"""The host's private working notes for a call.

interview_sessions.host_notes is a nullable text column written by the host's autosaving notes box. It is only
ever returned on the host's own detail view, never in a public/candidate response. Notes are kept until the
call is deleted, the same as reviews (retention purges monitoring data, not the host's own records).

Additive and reversible.

Revision ID: 0006
Revises: 0005
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS host_notes TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE interview_sessions DROP COLUMN IF EXISTS host_notes")
