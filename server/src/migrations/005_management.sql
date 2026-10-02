-- Proposals can be withdrawn; challenges can carry public addenda (idempotent)
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_status_check CHECK (status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'AI_EVALUATED', 'SHORTLISTED', 'NOT_SHORTLISTED', 'SELECTED', 'REJECTED', 'WITHDRAWN'));

CREATE TABLE IF NOT EXISTS challenge_addenda (
    id TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_by_user_id TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_addenda_challenge ON challenge_addenda(challenge_id, created_at);
