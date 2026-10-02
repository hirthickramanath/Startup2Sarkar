# Startup2Sarkar

Outcome-based innovation procurement for government. A department posts a **challenge**, verified startups submit **proposals**, an officer selects one and launches a monitored **pilot**, an independent **inspector** verifies results on site, and a **finance officer** releases milestone payments. Every step is recorded in a tamper-evident audit trail.

Five roles, each limited (on the server, not just in the UI) to its own data: Government Official, Startup Founder, Field Inspector, Finance Officer, Super Admin.

## Run it locally

```bash
npm ci
npm run build
ADMIN_EMAIL=you@example.com npm start      # http://localhost:3001
```

The first start creates one Super Admin and **prints its password once** in the terminal (or set `ADMIN_PASSWORD`). There is no demo data: sign in as admin, create a department, then invite government / finance / inspector users. Startups register themselves (or use Google) and wait for your verification.

Local development with hot reload: `npm run server:dev` (API on :3001) and `npm run dev` (UI on :5173, proxies `/api`).
Checks: `npm run typecheck`, `npm run lint`, `npm test` (in-memory database; no setup needed).

## Deploy

See **[docs/DEPLOY.md](docs/DEPLOY.md)** (Render + Supabase, or any Docker host). Config reference: `.env.example`.

## What it does

- **Money is exact**: all amounts are integer paise. TDS and GST-TDS are deducted per claim at rates the admin sets (defaults: 2% and 2% above a ₹2.5 lakh contract; **confirm with your tax advisor**).
- **Maker-checker**: whoever raised a claim cannot approve it. Money is never marked paid without a bank reference (UTR/PFMS). Open high-severity anomalies (e.g. duplicate invoice) block approval.
- **Verification chain**: a payment claim can only be raised after the inspector verifies the milestone.
- **Audit trail**: append-only, each entry hashes the previous one; the admin dashboard verifies the chain.
- **Sensitive data**: PAN and bank account numbers are encrypted at rest (AES-256-GCM); passwords use Argon2id; optional TOTP MFA; failed-login lockout; rate limits.
- **Sign-in**: email + password, and optional Google (startups may self-register; officials, inspectors, finance and admins must be invited first).

## The AI, honestly

- Without a Gemini key everything runs on a built-in **rules engine**: challenge drafting from templates, proposal scoring by keyword coverage and rule checks (a heuristic, not machine learning), and an assistant that answers from the platform's rules and the signed-in user's own records.
- With `GEMINI_API_KEY` set, the assistant uses Gemini, fenced in: the model receives **no tools** (no web search, no URL access), only role-scoped records plus an exchange-rate snapshot; off-topic questions never reach it; any answer containing a link is discarded.
- The market snapshot is ECB **daily reference rates** (USD/EUR/GBP vs INR), fetched by the server from one fixed host. It is not live trading data.
- AI is advisory only: it cannot select a startup, approve a claim, pay anything, or change a record.
- **Privacy**: on Google's *free* Gemini quota Google may use prompts to improve its products. Use paid quota for real data, or leave the key unset.

## Known limits

- Not independently security-audited or accessibility-audited; no penetration test. Treat as a serious prototype until it is.
- Tested on Node 22 with embedded PGlite and PostgreSQL 16. Not yet tested on Render, Supabase or a built Docker image.
- Uploaded files are stored on local disk (`UPLOAD_DIR`); on hosts with ephemeral disks attach a persistent volume.
- Email notifications are not sent (in-app notifications only).
- `docs/SPEC.md` is the original requirements document. It describes the intended scope, not a statement of what is implemented. Statutory rules and legal citations in it have not been verified.
