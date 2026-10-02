-- Startup2Sarkar Sovereign Procurement Platform
-- 001_initial_schema.sql
-- Conforms to: OWASP ASVS Level 2, Spec Sections 0-93

-- 1. Departments / Ministries
CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    ministry TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    budget_allocated_paise BIGINT NOT NULL DEFAULT 0,
    budget_committed_paise BIGINT NOT NULL DEFAULT 0,
    budget_disbursed_paise BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Organizations (Startups)
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dpiit_number TEXT UNIQUE,
    cin_llpin TEXT UNIQUE,
    pan TEXT,
    gstin TEXT,
    bank_account_encrypted TEXT,
    bank_account_masked TEXT,
    ifsc_code TEXT,
    founder_name TEXT NOT NULL,
    founder_email TEXT NOT NULL,
    founder_phone TEXT,
    website TEXT,
    sector TEXT NOT NULL,
    stage TEXT DEFAULT 'Seed',
    verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
    verification_notes TEXT,
    verified_by_user_id TEXT,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Users
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('government', 'startup', 'inspector', 'finance', 'admin')),
    name TEXT NOT NULL,
    designation TEXT,
    department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
    organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret TEXT,
    mfa_recovery_codes TEXT,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    failed_login_attempts INT NOT NULL DEFAULT 0,
    lockout_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. User Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT,
    user_agent TEXT,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Invitations (Admin invites Gov/Inspector/Finance)
CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('government', 'inspector', 'finance', 'admin')),
    department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_by_user_id TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Innovation Challenges
CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    department_id TEXT NOT NULL REFERENCES departments(id),
    department_name TEXT NOT NULL,
    problem_statement TEXT NOT NULL,
    problem_category TEXT NOT NULL,
    target_beneficiaries TEXT,
    desired_outcome TEXT NOT NULL,
    required_capabilities JSONB DEFAULT '[]'::jsonb,
    constraints TEXT,
    pilot_duration_months INT NOT NULL DEFAULT 3,
    budget_paise BIGINT NOT NULL DEFAULT 0,
    kpis JSONB DEFAULT '[]'::jsonb,
    evaluation_criteria JSONB DEFAULT '[]'::jsonb,
    required_documents JSONB DEFAULT '[]'::jsonb,
    risk_considerations JSONB DEFAULT '[]'::jsonb,
    deadline TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'PROPOSALS_RECEIVED', 'AI_EVALUATION', 'SHORTLISTED', 'PILOT_ACTIVE', 'COMPLETED', 'FINANCE_SUBMITTED', 'CLOSED', 'ARCHIVED')),
    version INT NOT NULL DEFAULT 1,
    created_by_user_id TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Startup Proposals
CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL REFERENCES challenges(id),
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    startup_name TEXT NOT NULL,
    solution_title TEXT NOT NULL,
    problem_solution_fit TEXT NOT NULL,
    technical_approach TEXT NOT NULL,
    deployment_plan TEXT NOT NULL,
    implementation_timeline TEXT NOT NULL,
    pilot_cost_paise BIGINT NOT NULL DEFAULT 0,
    scaleup_cost_paise BIGINT NOT NULL DEFAULT 0,
    evidence_deployments JSONB DEFAULT '[]'::jsonb,
    certifications JSONB DEFAULT '[]'::jsonb,
    documents JSONB DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'AI_EVALUATED', 'SHORTLISTED', 'NOT_SHORTLISTED', 'SELECTED', 'REJECTED')),
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 8. AI Proposal Evaluations (Advisory Only)
CREATE TABLE IF NOT EXISTS ai_evaluations (
    id TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL REFERENCES challenges(id),
    proposal_id TEXT NOT NULL REFERENCES proposals(id),
    overall_score INT NOT NULL,
    problem_alignment_score INT NOT NULL,
    technical_feasibility_score INT NOT NULL,
    expected_impact_score INT NOT NULL,
    evidence_strength_score INT NOT NULL,
    deployment_readiness_score INT NOT NULL,
    cost_feasibility_score INT NOT NULL,
    risk_score INT NOT NULL,
    why_recommended JSONB DEFAULT '[]'::jsonb,
    concerns JSONB DEFAULT '[]'::jsonb,
    limitations JSONB DEFAULT '[]'::jsonb,
    is_recommended_top3 BOOLEAN NOT NULL DEFAULT FALSE,
    basis_data JSONB DEFAULT '{}'::jsonb,
    model_name TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 9. Pilots
CREATE TABLE IF NOT EXISTS pilots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    challenge_id TEXT NOT NULL REFERENCES challenges(id),
    proposal_id TEXT NOT NULL REFERENCES proposals(id),
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    startup_name TEXT NOT NULL,
    department_id TEXT NOT NULL REFERENCES departments(id),
    location TEXT NOT NULL,
    duration_months INT NOT NULL DEFAULT 3,
    contract_value_paise BIGINT NOT NULL DEFAULT 0,
    original_contract_value_paise BIGINT NOT NULL DEFAULT 0,
    baseline_summary TEXT,
    target_outcome TEXT,
    status TEXT NOT NULL DEFAULT 'LAUNCHED' CHECK (status IN ('LAUNCHED', 'IN_PROGRESS', 'UNDER_INSPECTION', 'COMPLETED', 'VALIDATED', 'FINANCE_PENDING', 'STALLED', 'TERMINATED')),
    assigned_inspector_id TEXT REFERENCES users(id),
    launch_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completion_date TIMESTAMPTZ,
    final_report_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 10. Pilot Milestones
CREATE TABLE IF NOT EXISTS pilot_milestones (
    id TEXT PRIMARY KEY,
    pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    due_date TIMESTAMPTZ NOT NULL,
    amount_paise BIGINT NOT NULL DEFAULT 0,
    deliverable_description TEXT,
    deliverable_files JSONB DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'APPROVED', 'PAYMENT_PENDING', 'PAID', 'RETURNED')),
    submitted_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ
);

-- 11. Pilot KPIs
CREATE TABLE IF NOT EXISTS pilot_kpis (
    id TEXT PRIMARY KEY,
    pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    baseline_value TEXT NOT NULL,
    target_value TEXT NOT NULL,
    current_value TEXT NOT NULL,
    unit TEXT,
    measurement_method TEXT,
    frequency TEXT,
    status TEXT NOT NULL DEFAULT 'ON_TRACK' CHECK (status IN ('ON_TRACK', 'ACHIEVED', 'AT_RISK', 'OFF_TRACK')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 12. KPI Versioned Submissions
CREATE TABLE IF NOT EXISTS kpi_submissions (
    id TEXT PRIMARY KEY,
    kpi_id TEXT NOT NULL REFERENCES pilot_kpis(id) ON DELETE CASCADE,
    pilot_id TEXT NOT NULL REFERENCES pilots(id),
    version_number INT NOT NULL,
    reported_value TEXT NOT NULL,
    evidence_file_id TEXT,
    evidence_notes TEXT,
    submitted_by_user_id TEXT NOT NULL REFERENCES users(id),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'PARTIALLY_VERIFIED', 'REJECTED', 'REQUIRES_EVIDENCE')),
    inspector_notes TEXT,
    verified_by_user_id TEXT REFERENCES users(id),
    verified_at TIMESTAMPTZ
);

-- 13. Pilot Inspections
CREATE TABLE IF NOT EXISTS pilot_inspections (
    id TEXT PRIMARY KEY,
    pilot_id TEXT NOT NULL REFERENCES pilots(id),
    inspector_id TEXT NOT NULL REFERENCES users(id),
    scheduled_date TIMESTAMPTZ NOT NULL,
    completed_date TIMESTAMPTZ,
    checklist_results JSONB DEFAULT '{}'::jsonb,
    findings TEXT,
    gps_latitude NUMERIC,
    gps_longitude NUMERIC,
    gps_address TEXT,
    observation_photos JSONB DEFAULT '[]'::jsonb,
    validation_status TEXT NOT NULL DEFAULT 'VERIFIED' CHECK (validation_status IN ('VERIFIED', 'PARTIALLY_VERIFIED', 'REQUIRES_FURTHER_EVIDENCE', 'NOT_VERIFIED')),
    scaleup_evidence_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 14. Operational Risks
CREATE TABLE IF NOT EXISTS risks (
    id TEXT PRIMARY KEY,
    pilot_id TEXT NOT NULL REFERENCES pilots(id),
    category TEXT NOT NULL CHECK (category IN ('TECHNICAL', 'OPERATIONAL', 'FINANCIAL', 'CYBERSECURITY', 'DATA', 'SCALABILITY')),
    description TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    evidence TEXT,
    mitigation TEXT,
    owner TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'MITIGATED', 'CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 15. Finance Payment Claims
CREATE TABLE IF NOT EXISTS finance_payment_claims (
    id TEXT PRIMARY KEY,
    pilot_id TEXT NOT NULL REFERENCES pilots(id),
    milestone_id TEXT NOT NULL REFERENCES pilot_milestones(id),
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    department_id TEXT NOT NULL REFERENCES departments(id),
    invoice_number TEXT NOT NULL,
    invoice_date TIMESTAMPTZ NOT NULL,
    gross_amount_paise BIGINT NOT NULL DEFAULT 0,
    tds_paise BIGINT NOT NULL DEFAULT 0,
    gst_paise BIGINT NOT NULL DEFAULT 0,
    penalty_deduction_paise BIGINT NOT NULL DEFAULT 0,
    net_payable_paise BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_PENDING', 'FINANCE_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'ON_HOLD', 'REJECTED', 'DISPUTED')),
    hold_reason TEXT,
    requester_user_id TEXT NOT NULL REFERENCES users(id),
    first_reviewer_user_id TEXT REFERENCES users(id),
    approver_user_id TEXT REFERENCES users(id),
    disbursement_reference TEXT,
    disbursed_at TIMESTAMPTZ,
    disbursed_by_user_id TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 16. Financial Anomalies
CREATE TABLE IF NOT EXISTS finance_anomalies (
    id TEXT PRIMARY KEY,
    claim_id TEXT REFERENCES finance_payment_claims(id),
    pilot_id TEXT NOT NULL REFERENCES pilots(id),
    anomaly_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DETECTED' CHECK (status IN ('DETECTED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED')),
    resolution_notes TEXT,
    resolved_by_user_id TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 17. Stalled / Failed Pilots Tracking
CREATE TABLE IF NOT EXISTS stalled_pilots (
    id TEXT PRIMARY KEY,
    pilot_id TEXT NOT NULL UNIQUE REFERENCES pilots(id),
    stalled_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    stall_reason TEXT NOT NULL,
    amount_paid_paise BIGINT NOT NULL DEFAULT 0,
    amount_committed_paise BIGINT NOT NULL DEFAULT 0,
    amount_recoverable_paise BIGINT NOT NULL DEFAULT 0,
    amount_recovered_paise BIGINT NOT NULL DEFAULT 0,
    action_taken TEXT NOT NULL DEFAULT 'NONE' CHECK (action_taken IN ('EXTENSION_REQUESTED', 'RECOVERY_INITIATED', 'REFUNDED', 'TERMINATED', 'NONE')),
    recovery_deadline TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'IDENTIFIED' CHECK (status IN ('IDENTIFIED', 'EXPLANATION_REQUESTED', 'UNDER_ASSESSMENT', 'RECOVERY_ACTIVE', 'RESOLVED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 18. Tamper-Evident Hash-Chained Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_state_hash TEXT,
    after_state_hash TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT NOT NULL,
    user_agent TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 19. AI Inference Audit Log
CREATE TABLE IF NOT EXISTS ai_audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    feature TEXT NOT NULL,
    model_name TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    input_ref TEXT NOT NULL,
    tokens_used INT NOT NULL DEFAULT 0,
    raw_output TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 20. In-App Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    role TEXT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'INFO' CHECK (priority IN ('INFO', 'WARNING', 'CRITICAL')),
    action_link TEXT,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 21. File Storage Registry
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256_hash TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    uploaded_by_user_id TEXT NOT NULL REFERENCES users(id),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 22. System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_by_user_id TEXT REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for Fast Lookups and Row-Level Security
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_challenges_dept ON challenges(department_id);
CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);
CREATE INDEX IF NOT EXISTS idx_proposals_challenge ON proposals(challenge_id);
CREATE INDEX IF NOT EXISTS idx_proposals_org ON proposals(organization_id);
CREATE INDEX IF NOT EXISTS idx_pilots_org ON pilots(organization_id);
CREATE INDEX IF NOT EXISTS idx_pilots_dept ON pilots(department_id);
CREATE INDEX IF NOT EXISTS idx_pilots_inspector ON pilots(assigned_inspector_id);
CREATE INDEX IF NOT EXISTS idx_claims_pilot ON finance_payment_claims(pilot_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON finance_payment_claims(status);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);


-- ── Google sign-in & account provenance (idempotent for existing databases) ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_audit_time ON ai_audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
