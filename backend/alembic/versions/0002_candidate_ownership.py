"""Candidates belong to the HR user who invited them.

Before this revision `candidates.email` was globally unique and shared across HR users, so one
user could rename a candidate another user had invited. Now the pair (created_by, email) is unique.

Data handling: a candidate that already has sessions from several HR users is split into one row
per user (sessions are repointed). Candidates with no sessions at all (never reachable from the
app) are deleted. Not reversible, because merged rows could violate the old unique(email).

Revision ID: 0002
Revises: 0001
"""
import uuid

import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    op.execute(sa.text("ALTER TABLE candidates ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE RESTRICT"))
    # The old global uniqueness must go first: splitting a shared candidate creates a second row with the same email.
    op.execute(sa.text("ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_email_key"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_candidates_email"))

    pairs = bind.execute(
        sa.text("SELECT candidate_id, created_by FROM interview_sessions GROUP BY candidate_id, created_by ORDER BY candidate_id, MIN(created_at)")
    ).all()
    claimed: set = set()
    for candidate_id, owner_id in pairs:
        if candidate_id not in claimed:
            claimed.add(candidate_id)
            bind.execute(sa.text("UPDATE candidates SET created_by = :owner WHERE id = :candidate"), {"owner": owner_id, "candidate": candidate_id})
        else:  # candidate already claimed by another HR user: give this user their own copy
            clone_id = uuid.uuid4()
            bind.execute(
                sa.text("INSERT INTO candidates (id, created_by, email, full_name, created_at) SELECT :clone, :owner, email, full_name, created_at FROM candidates WHERE id = :candidate"),
                {"clone": clone_id, "owner": owner_id, "candidate": candidate_id},
            )
            bind.execute(
                sa.text("UPDATE interview_sessions SET candidate_id = :clone WHERE candidate_id = :candidate AND created_by = :owner"),
                {"clone": clone_id, "owner": owner_id, "candidate": candidate_id},
            )

    op.execute(sa.text("DELETE FROM candidates WHERE created_by IS NULL"))
    op.execute(sa.text("ALTER TABLE candidates ALTER COLUMN created_by SET NOT NULL"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_candidates_created_by ON candidates(created_by)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_candidates_email ON candidates(email)"))
    op.execute(sa.text("ALTER TABLE candidates DROP CONSTRAINT IF EXISTS uq_candidates_created_by_email"))
    op.execute(sa.text("ALTER TABLE candidates ADD CONSTRAINT uq_candidates_created_by_email UNIQUE (created_by, email)"))


def downgrade() -> None:
    raise RuntimeError("0002 cannot be reversed automatically: candidate rows were split per HR user.")
