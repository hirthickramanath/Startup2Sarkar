-- Payment lifecycle: cheque or electronic, two-person approval, tax remittance ledger (idempotent)

ALTER TABLE finance_payment_claims DROP CONSTRAINT IF EXISTS finance_payment_claims_status_check;
ALTER TABLE finance_payment_claims ADD CONSTRAINT finance_payment_claims_status_check CHECK (status IN (
  'SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_PENDING', 'FINANCE_REVIEW', 'AWAITING_SECOND_APPROVAL', 'APPROVED',
  'CHEQUE_ISSUED', 'PROCESSING', 'PAID', 'ON_HOLD', 'REJECTED', 'DISPUTED'));

ALTER TABLE finance_payment_claims ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE finance_payment_claims ADD COLUMN IF NOT EXISTS cheque_number TEXT;
ALTER TABLE finance_payment_claims ADD COLUMN IF NOT EXISTS cheque_date DATE;
ALTER TABLE finance_payment_claims ADD COLUMN IF NOT EXISTS drawee_bank TEXT;
ALTER TABLE finance_payment_claims ADD COLUMN IF NOT EXISTS cheque_signatories TEXT;
ALTER TABLE finance_payment_claims ADD COLUMN IF NOT EXISTS cheque_issued_at TIMESTAMPTZ;
ALTER TABLE finance_payment_claims ADD COLUMN IF NOT EXISTS cheque_issued_by_user_id TEXT;
ALTER TABLE finance_payment_claims ADD COLUMN IF NOT EXISTS cheque_history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Tax deducted at source, and whether the department has paid it on to the government
CREATE TABLE IF NOT EXISTS tax_remittances (
    id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL REFERENCES finance_payment_claims(id) ON DELETE CASCADE,
    department_id TEXT NOT NULL REFERENCES departments(id),
    tax_type TEXT NOT NULL CHECK (tax_type IN ('TDS', 'GST_TDS')),
    amount_paise BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DEDUCTED' CHECK (status IN ('DEDUCTED', 'REMITTED')),
    deducted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    challan_number TEXT,
    challan_date DATE,
    remitted_by_user_id TEXT,
    remitted_at TIMESTAMPTZ,
    UNIQUE (claim_id, tax_type)
);
CREATE INDEX IF NOT EXISTS idx_tax_remittances_status ON tax_remittances(status, deducted_at);

-- Claims paid before this feature existed
INSERT INTO tax_remittances (id, claim_id, department_id, tax_type, amount_paise, deducted_at)
SELECT 'TAX-' || id || '-TDS', id, department_id, 'TDS', tds_paise, COALESCE(disbursed_at, created_at) FROM finance_payment_claims WHERE status = 'PAID' AND tds_paise > 0
ON CONFLICT DO NOTHING;
INSERT INTO tax_remittances (id, claim_id, department_id, tax_type, amount_paise, deducted_at)
SELECT 'TAX-' || id || '-GST', id, department_id, 'GST_TDS', gst_paise, COALESCE(disbursed_at, created_at) FROM finance_payment_claims WHERE status = 'PAID' AND gst_paise > 0
ON CONFLICT DO NOTHING;
