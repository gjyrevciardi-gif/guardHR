"""A host-supplied list of the addresses that may take a public exam that checks email.

tests.invited_emails (JSON list of lower-case addresses, default empty). Empty means anyone may ask for a code, as before;
a non-empty list means only those addresses may. It belongs to the test and goes with it.

Additive and reversible. Downgrading discards the lists (tests, attempts and submissions are not affected).

Revision ID: 0013
Revises: 0012
"""
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE tests ADD COLUMN IF NOT EXISTS invited_emails JSON NOT NULL DEFAULT '[]'")


def downgrade() -> None:
    op.execute("ALTER TABLE tests DROP COLUMN IF EXISTS invited_emails")
