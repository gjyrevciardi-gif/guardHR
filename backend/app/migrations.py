from sqlalchemy import text

from .database import engine


def run_lightweight_migrations() -> None:
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE candidates ALTER COLUMN email DROP NOT NULL"))
        conn.execute(text("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS test_id UUID NULL REFERENCES tests(id) ON DELETE SET NULL"))
        conn.execute(text("ALTER TABLE tests ADD COLUMN IF NOT EXISTS public_token UUID"))
        conn.execute(text("UPDATE tests SET public_token = gen_random_uuid() WHERE public_token IS NULL"))
        conn.execute(text("ALTER TABLE tests ALTER COLUMN public_token SET NOT NULL"))
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_tests_public_token ON tests(public_token)"))
        conn.execute(text("ALTER TABLE tests ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE"))
        conn.execute(text("ALTER TABLE tests ADD COLUMN IF NOT EXISTS form_mode BOOLEAN NOT NULL DEFAULT FALSE"))
        conn.execute(text("ALTER TABLE test_questions ADD COLUMN IF NOT EXISTS question_type VARCHAR(40) NOT NULL DEFAULT 'multiple_choice'"))
        conn.execute(text("ALTER TABLE test_questions ALTER COLUMN correct_option_index DROP NOT NULL"))
        conn.execute(text("ALTER TABLE test_submissions ALTER COLUMN session_id DROP NOT NULL"))
        conn.execute(text("ALTER TABLE test_submissions ADD COLUMN IF NOT EXISTS participant_name VARCHAR(160)"))
        conn.execute(text("ALTER TABLE test_submissions ADD COLUMN IF NOT EXISTS participant_email VARCHAR(255)"))
        conn.execute(text("ALTER TABLE test_submissions ADD COLUMN IF NOT EXISTS participant_ip VARCHAR(64)"))
