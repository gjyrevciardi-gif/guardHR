"""Account security: session revocation, password reset and two-step verification.

users.token_version is part of every session token; bumping it signs the user out everywhere. Tokens issued
before this migration carry no version and count as 0, which is every user's starting value, so nobody is
signed out by the upgrade. Password reset tokens and recovery codes are stored only as keyed hashes
(app/security.py). The TOTP secret has to be readable to verify a code, so it is stored as is.

Additive and reversible. Downgrading discards reset tokens, secrets and recovery codes (users have to enrol again).

Revision ID: 0007
Revises: 0006
"""
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

COLUMNS = {
    "token_version": "INTEGER NOT NULL DEFAULT 0",
    "password_reset_hash": "VARCHAR(64)",
    "password_reset_expires_at": "TIMESTAMPTZ",
    "mfa_secret": "VARCHAR(64)",
    "mfa_enabled": "BOOLEAN NOT NULL DEFAULT FALSE",
    "mfa_last_step": "INTEGER",
    "mfa_recovery_hashes": "JSON",
}


def upgrade() -> None:
    for name, ddl in COLUMNS.items():
        op.execute(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {name} {ddl}")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_password_reset_hash ON users (password_reset_hash)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_users_password_reset_hash")
    for name in reversed(COLUMNS):
        op.execute(f"ALTER TABLE users DROP COLUMN IF EXISTS {name}")
