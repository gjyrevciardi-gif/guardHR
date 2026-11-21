"""Index audit_logs by (session_id, action, created_at).

The session detail view looks up the latest invite-email outcome and the last `session.viewed`
row for a session on every poll. Additive and reversible; no data changes.

Revision ID: 0003
Revises: 0002
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS idx_audit_session_action ON audit_logs(session_id, action, created_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_audit_session_action")
