-- Identity, approvals and investor network (idempotent: safe to run on every start)

-- New role + account status
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('government', 'startup', 'inspector', 'finance', 'admin', 'investor'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('ACTIVE', 'PENDING_APPROVAL', 'REJECTED'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_password BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- Every way a person can sign in (Google, GitHub). One row per provider account.
CREATE TABLE IF NOT EXISTS auth_identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
    provider_user_id TEXT NOT NULL,
    email TEXT,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    display_name TEXT,
    profile_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (provider, provider_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_user_provider ON auth_identities(user_id, provider);

-- Carry over accounts that already signed in with Google
INSERT INTO auth_identities (id, user_id, provider, provider_user_id, email, email_verified, display_name)
SELECT 'IDN-' || id, id, 'google', google_sub, email, TRUE, name FROM users WHERE google_sub IS NOT NULL
ON CONFLICT DO NOTHING;
UPDATE users SET has_password = FALSE WHERE auth_provider = 'google' AND google_sub IS NOT NULL AND has_password = TRUE;

-- Requests from government / finance / inspector staff, reviewed by an administrator
CREATE TABLE IF NOT EXISTS access_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_role TEXT NOT NULL CHECK (requested_role IN ('government', 'finance', 'inspector')),
    department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
    designation TEXT NOT NULL,
    official_email TEXT NOT NULL,
    phone TEXT,
    employee_id TEXT,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_by_user_id TEXT,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status, created_at);

-- Private investors
CREATE TABLE IF NOT EXISTS investor_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    investor_type TEXT NOT NULL,
    organisation TEXT NOT NULL,
    website TEXT,
    linkedin_url TEXT,
    sectors JSONB NOT NULL DEFAULT '[]'::jsonb,
    verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
    verification_notes TEXT,
    verified_by_user_id TEXT,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Startups choose whether investors can see them
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS showcase_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS showcase_summary TEXT;

-- Investor -> startup introductions. Only the two sides can read these (administrators cannot).
CREATE TABLE IF NOT EXISTS investor_intros (
    id TEXT PRIMARY KEY,
    investor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_intros_org ON investor_intros(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_intros_investor ON investor_intros(investor_user_id, created_at);

-- Public profile links (resume, LinkedIn, deck, demo video ...), https only
CREATE TABLE IF NOT EXISTS profile_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('resume', 'linkedin', 'github', 'instagram', 'x', 'website', 'pitch_deck', 'demo_video', 'other')),
    url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, kind)
);
