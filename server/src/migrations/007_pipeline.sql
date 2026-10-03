-- Bank payment files, scale-up pipeline, appeals (idempotent)

-- Column layouts for the bulk-payment file each bank accepts (administrators define them)
CREATE TABLE IF NOT EXISTS payment_file_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    delimiter TEXT NOT NULL DEFAULT ',',
    date_format TEXT NOT NULL DEFAULT 'YYYY-MM-DD',
    include_header BOOLEAN NOT NULL DEFAULT TRUE,
    columns JSONB NOT NULL,
    created_by_user_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE finance_payment_claims ADD COLUMN IF NOT EXISTS payment_file_exported_at TIMESTAMPTZ;

-- After a successful pilot: a recommendation to scale up, decided by a second person
CREATE TABLE IF NOT EXISTS scaleup_plans (
    id TEXT PRIMARY KEY,
    pilot_id TEXT NOT NULL UNIQUE REFERENCES pilots(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    department_id TEXT NOT NULL REFERENCES departments(id),
    status TEXT NOT NULL DEFAULT 'RECOMMENDED' CHECK (status IN ('RECOMMENDED', 'APPROVED', 'DECLINED')),
    rationale TEXT NOT NULL,
    proposed_value_paise BIGINT NOT NULL DEFAULT 0,
    recommended_by_user_id TEXT NOT NULL,
    decided_by_user_id TEXT,
    decision_note TEXT,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A startup can appeal a rejection once; an administrator (not the department) decides
CREATE TABLE IF NOT EXISTS proposal_appeals (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UPHELD', 'DISMISSED')),
    decision_note TEXT,
    decided_by_user_id TEXT,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
