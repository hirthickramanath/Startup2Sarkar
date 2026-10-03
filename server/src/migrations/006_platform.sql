-- Email sign-up, startup documents and verification, challenge Q&A, bank confirmation (idempotent)

-- Email + password sign-up waits here until the person proves they own the address
CREATE TABLE IF NOT EXISTS pending_signups (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pending_signups_email ON pending_signups(LOWER(email));

-- The 3-4 statutory documents a startup uploads (PDF only), reviewed by an administrator
CREATE TABLE IF NOT EXISTS organization_documents (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL CHECK (doc_type IN ('DPIIT_CERTIFICATE', 'INCORPORATION_CERTIFICATE', 'FINANCIAL_STATEMENTS', 'BANK_PROOF')),
    filename TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')),
    review_note TEXT,
    reviewed_by_user_id TEXT,
    reviewed_at TIMESTAMPTZ,
    uploaded_by_user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_org_documents_org ON organization_documents(organization_id, doc_type, created_at);

-- What the administrator has checked while verifying a startup
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS verification_checklist JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Challenge questions and official answers
CREATE TABLE IF NOT EXISTS challenge_questions (
    id TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    asked_by_user_id TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT,
    answered_by_user_id TEXT,
    answered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_challenge_questions ON challenge_questions(challenge_id, created_at);

-- A bank statement line that confirmed an electronic payment
ALTER TABLE finance_payment_claims ADD COLUMN IF NOT EXISTS bank_confirmed_at TIMESTAMPTZ;
