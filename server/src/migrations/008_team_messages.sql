-- Skip-for-now on forced two-step verification, several users per startup, in-app messaging (idempotent)

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_snoozed_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_skip_count INTEGER NOT NULL DEFAULT 0;
-- NULL or OWNER = the account owner of a startup; MEMBER = a teammate the owner invited
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_role TEXT;

CREATE TABLE IF NOT EXISTS team_invites (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    invited_by_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_invite_pending ON team_invites(organization_id, LOWER(email)) WHERE status = 'PENDING';

-- Messages between a startup's team and the department that runs its pilot
CREATE TABLE IF NOT EXISTS message_threads (
    id TEXT PRIMARY KEY,
    pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    department_id TEXT NOT NULL REFERENCES departments(id),
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    created_by_user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_threads_org ON message_threads(organization_id, last_message_at);
CREATE INDEX IF NOT EXISTS idx_threads_dept ON message_threads(department_id, last_message_at);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    sender_user_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_side TEXT NOT NULL CHECK (sender_side IN ('STARTUP', 'DEPARTMENT')),
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS thread_reads (
    thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (thread_id, user_id)
);
