CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(160) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'hr' CHECK (role IN ('hr', 'admin')),
    retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 365),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255),
    full_name VARCHAR(160) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    form_mode BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS test_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    question_type VARCHAR(40) NOT NULL DEFAULT 'multiple_choice' CHECK (question_type IN ('multiple_choice','short_text')),
    prompt TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    correct_option_index INTEGER
);

CREATE TABLE IF NOT EXISTS interview_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
    test_id UUID REFERENCES tests(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    public_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    status VARCHAR(40) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','consented','in_progress','completed','expired')),
    review_status VARCHAR(40) NOT NULL DEFAULT 'No events detected' CHECK (review_status IN ('No events detected','Requires review','Review completed','Insufficient evidence')),
    require_screen_share BOOLEAN NOT NULL DEFAULT FALSE,
    consented_at TIMESTAMPTZ,
    consent_ip VARCHAR(64),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS test_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES interview_sessions(id) ON DELETE CASCADE,
    test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    participant_name VARCHAR(160),
    participant_email VARCHAR(255),
    participant_ip VARCHAR(64),
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    score INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id)
);

CREATE TABLE IF NOT EXISTS integrity_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
    event_type VARCHAR(60) NOT NULL CHECK (event_type IN ('tab_hidden','fullscreen_exit','camera_disabled','face_not_visible','multiple_people','phone_detected','screen_share_stopped','copy_paste','connection_interruption','window_resized','multiple_monitors')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds NUMERIC(10,2),
    confidence_score NUMERIC(5,4) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    outcome VARCHAR(40) NOT NULL CHECK (outcome IN ('Review completed','Insufficient evidence')),
    notes TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, reviewer_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id UUID REFERENCES interview_sessions(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(60) NOT NULL,
    entity_id UUID,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_created_by ON interview_sessions(created_by);
CREATE INDEX IF NOT EXISTS idx_sessions_candidate ON interview_sessions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_sessions_test ON interview_sessions(test_id);
CREATE INDEX IF NOT EXISTS idx_tests_created_by ON tests(created_by);
CREATE INDEX IF NOT EXISTS idx_tests_public_token ON tests(public_token);
CREATE INDEX IF NOT EXISTS idx_test_questions_test ON test_questions(test_id);
CREATE INDEX IF NOT EXISTS idx_test_submissions_test ON test_submissions(test_id);
CREATE INDEX IF NOT EXISTS idx_test_submissions_session ON test_submissions(session_id);
CREATE INDEX IF NOT EXISTS idx_events_session_time ON integrity_events(session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_logs(user_id, created_at DESC);
