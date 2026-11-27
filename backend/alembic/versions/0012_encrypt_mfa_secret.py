"""Encrypt the two-step verification secret at rest.

users.mfa_secret is widened (an encrypted secret is 145 characters) and every secret already stored is encrypted with
SECRETS_ENCRYPTION_KEY. Without a key (development) nothing is encrypted and the column is only widened; the next
`python -m app.secrets_box` after a key is set does the encrypting. New and changed secrets are encrypted by the model
(app/secrets_box.py), so no application code changed.

Reversible: the downgrade decrypts every secret back to plain text (it needs the key if any are encrypted) and narrows
the column again.

Revision ID: 0012
Revises: 0011
"""
from sqlalchemy import text

from alembic import op
from app.secrets_box import PREFIX, decrypt, reencrypt_all

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ALTER COLUMN mfa_secret TYPE VARCHAR(255)")
    reencrypt_all(op.get_bind())


def downgrade() -> None:
    connection = op.get_bind()
    for user_id, value in connection.execute(text("SELECT id, mfa_secret FROM users WHERE mfa_secret LIKE :prefix"), {"prefix": PREFIX + "%"}).all():
        connection.execute(text("UPDATE users SET mfa_secret = :value WHERE id = :id"), {"value": decrypt(value), "id": user_id})
    op.execute("ALTER TABLE users ALTER COLUMN mfa_secret TYPE VARCHAR(64)")
