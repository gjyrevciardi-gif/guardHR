"""Event severity and monitor coverage.

integrity_events.severity (0 info, 1 low, 2 medium, 3 high) is backfilled from the event type with the same
rule the application applies to new events (app/signals.py, frozen here). interview_sessions gets the heartbeat
bookkeeping columns; they stay NULL for calls that started before this revision, which the API reports as
"coverage unknown" rather than as a monitoring failure. Existing review statuses are not recomputed.

Additive and reversible.

Revision ID: 0004
Revises: 0003
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE integrity_events ADD COLUMN IF NOT EXISTS severity INTEGER NOT NULL DEFAULT 1")
    op.execute(
        """UPDATE integrity_events SET severity = CASE
            WHEN event_type IN ('phone_detected', 'multiple_people', 'screen_share_stopped') THEN 3
            WHEN event_type IN ('camera_disabled', 'face_not_visible') THEN 2
            WHEN event_type = 'tab_hidden' AND COALESCE(duration_seconds, 0) >= 30 THEN 2
            WHEN event_type = 'copy_paste' AND metadata->>'operation' = 'paste' THEN 2
            WHEN event_type IN ('connection_interruption', 'window_resized') THEN 0
            ELSE 1 END"""
    )
    op.execute("ALTER TABLE integrity_events DROP CONSTRAINT IF EXISTS ck_integrity_events_severity")
    op.execute("ALTER TABLE integrity_events ADD CONSTRAINT ck_integrity_events_severity CHECK (severity BETWEEN 0 AND 3)")
    op.execute("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ")
    op.execute("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS monitored_seconds DOUBLE PRECISION")
    op.execute("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS face_seconds DOUBLE PRECISION")
    op.execute("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS monitor_gaps INTEGER NOT NULL DEFAULT 0")


def downgrade() -> None:
    op.execute("ALTER TABLE interview_sessions DROP COLUMN IF EXISTS monitor_gaps")
    op.execute("ALTER TABLE interview_sessions DROP COLUMN IF EXISTS face_seconds")
    op.execute("ALTER TABLE interview_sessions DROP COLUMN IF EXISTS monitored_seconds")
    op.execute("ALTER TABLE interview_sessions DROP COLUMN IF EXISTS last_seen_at")
    op.execute("ALTER TABLE integrity_events DROP CONSTRAINT IF EXISTS ck_integrity_events_severity")
    op.execute("ALTER TABLE integrity_events DROP COLUMN IF EXISTS severity")
