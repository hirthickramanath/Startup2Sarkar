-- A record of every email the platform tries to send, so a failure is never silent (no message bodies: they can hold one-time links)
CREATE TABLE IF NOT EXISTS email_log (
    id TEXT PRIMARY KEY,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('SENT', 'FAILED')),
    error TEXT,
    provider_message_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at DESC);
