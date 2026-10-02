# Startup2Sarkar

**Startup2Sarkar (S2S)** is a web platform for **public innovation procurement**. A government department posts a problem as a *challenge*; verified startups submit *proposals*; an officer selects one and launches a monitored *pilot*; an independent *inspector* verifies the results on site; and a *finance officer* approves and records milestone payments. Every important step is written to a tamper-evident audit trail.

It is built to replace the usual mix of emails, spreadsheets and paper files in startup-led pilots with one system where **money is exact, every decision has a named person, and nobody sees data they are not meant to see.**

> **Status: a serious prototype.** It runs, it is tested (86 automated backend tests), and it has been exercised end to end in a real browser. It has **not** had an independent security or accessibility audit, and has not been load-tested. Read [Known limits](#known-limits-and-roadmap) before putting real money or citizen data through it.

---

## Contents
1. [Who uses it](#who-uses-it) · 2. [How a procurement flows](#how-a-procurement-flows) · 3. [What is in the box](#what-is-in-the-box) · 4. [Languages and stack](#languages-and-stack) · 5. [Repository layout](#repository-layout) · 6. [Run it locally](#run-it-locally) · 7. [Configuration](#configuration) · 8. [Accounts, sign-in and approval](#accounts-sign-in-and-approval) · 9. [Security model](#security-model) · 10. [AI features](#ai-features) · 11. [API reference](#api-reference) · 12. [Data model](#data-model) · 13. [Design system](#design-system) · 14. [Testing](#testing) · 15. [Deployment](#deployment) · 16. [Known limits and roadmap](#known-limits-and-roadmap)

---

## Who uses it

| Role | What they do | Joins by | Admin's access to them |
|---|---|---|---|
| **Government official** | Posts and publishes challenges, reviews proposals, selects a startup, assigns an inspector, forwards a verified pilot to Finance | Requests access; an **administrator approves** | Full |
| **Startup founder** | Discovers challenges, submits proposals (with up to 3 links), runs the pilot, submits KPI evidence and milestones, raises payment claims | Self-registers (email, Google or GitHub). Bidding unlocks after an admin **verifies** the startup | Profile and verification |
| **Field inspector** | Verifies KPI evidence and milestones on site, files inspection dockets, keeps a risk register | Requests access; an administrator approves | Full |
| **Finance officer** | Reviews payment claims, resolves anomalies, approves, records the bank reference, watches budgets | Requests access; an administrator approves | Full |
| **Investor (private)** | Browses verified startups that opted in, asks for introductions | Self-registers; directory unlocks after an admin **verifies** them | Verify, suspend, view profile. **Cannot read introductions** |
| **Super admin** | Creates departments and users, verifies startups and investors, decides access requests, sets tax rates and AI switches, reads the audit log | First admin is created on first start; later admins are created by an admin. **Never self-signs-up** | n/a |

## How a procurement flows

1. **Challenge** drafted (optionally with an AI draft you edit), then published by a government officer.
2. **Proposals** submitted by verified startups. Supporting material is shared as **up to 3 labelled https links**.
3. **Advisory AI evaluation** scores each proposal from its own text and figures (a heuristic, not a verdict). An officer **selects** a startup and must write a reason.
4. A **pilot** is created with its KPIs (copied from the challenge) and a 30/40/30 milestone schedule. An inspector is assigned.
5. The startup submits **KPI evidence** (each submission is a new version) and **milestone deliverables**; the inspector **verifies** them and files an inspection docket.
6. The startup raises a **payment claim** once a milestone is verified. TDS and GST-TDS are deducted by the server in integer paise.
7. Finance **approves** (maker-checker: the approver must differ from the requester; a high-severity anomaly such as a duplicate invoice blocks approval), then **records the bank reference (UTR/PFMS)**. Money is never marked paid without one.
8. Everything above is appended to a **hash-chained audit log**.

## What is in the box

- Role-based web app (React) and a JSON API (Fastify) served from **one container on one port**.
- **Sign-in**: email and password (Argon2id, optional TOTP MFA, lockout), **Google** and **GitHub**; accounts can link several methods.
- **Onboarding wizard** for new Google/GitHub users with role-specific questions; an **access-request queue** for staff roles.
- **Investor network**: investor profile, opt-in startup showcase, introduction requests with contact details revealed only on acceptance.
- **Profile links** (resume, LinkedIn, GitHub, deck, demo video…): https only.
- **Finance controls**: exact money math, configurable tax rates, budget reservation, anomaly detection, stalled-pilot sentinel, CSV and PDF case files.
- **AI assistant** that answers from the signed-in user's own records (rules engine; optional Gemini, fenced in).
- **Themes**: three named themes (Graphite, Burst, Meadow), each in light and dark, remembered per browser; skippable brand intro animation.
- Docker, Render blueprint, CI workflow, OpenAPI docs (development).

## Languages and stack

| Layer | Technology |
|---|---|
| Backend language | **TypeScript** on **Node.js 20+** (developed on 22), run with `tsx` |
| API framework | **Fastify ^5.12.5** with rate limiting, cookies, CORS, static serving, Swagger UI |
| Validation | **zod ^4.6.5** on every request body |
| Database | **PostgreSQL** in production (`pg`); embedded **PGlite** for local runs and tests |
| Crypto | `@node-rs/argon2` (passwords), AES-256-GCM (PAN and bank numbers), HMAC-signed tokens, `otplib` (TOTP) |
| Frontend language | **JavaScript (JSX)** with **React ^19.2.8**, built by **Vite** |
| UI libraries | Radix UI primitives (dialog, tooltip), `lucide-react` icons, mo.js (intro bursts). Plain CSS with design tokens, no CSS framework |
| Fonts | Sora (headings), Figtree (text), JetBrains Mono (numbers), loaded from Google Fonts |
| Testing | Node's built-in test runner, in-memory database, mocked Google/GitHub |
| Tooling | `tsc --noEmit`, `oxlint`, GitHub Actions CI, Docker |

## Repository layout

```
server/src/
  app.ts            builds the Fastify app: security headers, CORS, rate limits, static SPA, route registration
  server.ts         entry point: migrations, first-admin bootstrap, scheduler, listen
  db.ts             PostgreSQL / PGlite adapter, migration runner, settings helpers
  security.ts       passwords, MFA, tokens, field encryption, validators, auth middleware, Google token verification
  tax.ts            deterministic TDS / GST-TDS engine (integer paise)
  ai.ts             rules engine + assistant + Gemini client (no tools, scope-gated)
  market.ts         server-side exchange-rate feed (one allow-listed host)
  audit.ts          hash-chained audit log + integrity check
  reports.ts        CSV / PDF case files and exports
  scheduler.ts      background sentinels (stalled pilots, payment SLA)
  adapters.ts       storage, treasury and email provider interfaces
  routes/           auth · identity · challenges · proposals · pilots · finance · admin · network · assistant · platform
  migrations/       001_initial_schema.sql · 002_identity.sql  (idempotent, run on every start)
server/tests/       api-integration · idor-security · domain-unit · s2s · identity
src/
  main.jsx, App.jsx           providers, route table, role gate, error boundary
  store.jsx                   theme + auth + app state, all real API actions (no mock data)
  api.js                      one fetch wrapper and typed endpoint helpers
  components/auth/            LoginPage, Onboarding (+ pending screen), Intro
  components/common/          AppShell, AssistantDrawer, ui (Modal, Logo, ThemeControls…), Profile (linked accounts, links)
  components/roles/<role>/    one folder per role
  theme.css, auth.css, index.css
public/                       favicon, theme bootstrap (runs before paint)
docs/                         DEPLOY.md · SPEC.md (original requirements)
```

## Run it locally

Requires **Node.js 20 or newer**.

```bash
npm ci
npm run build
ADMIN_EMAIL=you@example.com npm start        # http://localhost:3001
```

The first start creates one Super Admin and **prints its password once** (or set `ADMIN_PASSWORD`). There is **no demo data**: sign in as admin, create a department and its budget, invite staff, and let startups register.

| Command | What it does |
|---|---|
| `npm run server:dev` | API with auto-reload on :3001 |
| `npm run dev` | Vite dev server on :5173 (proxies `/api` to :3001) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | oxlint |
| `npm test` | all backend tests (in-memory database, no setup) |
| `npm run build` | production frontend into `dist/` |

## Configuration

All settings are environment variables. Copy `.env.example` to `.env` for local use; in production set them on the host. **Never commit real values.**

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | prod | `production` turns on strict checks |
| `DATABASE_URL` | prod | PostgreSQL connection string (TLS on automatically for non-local hosts) |
| `JWT_SECRET`, `COOKIE_SECRET`, `FIELD_ENCRYPTION_KEY` | prod | 32+ characters each (`openssl rand -hex 32`). The server **refuses to start** in production without them. Back up `FIELD_ENCRYPTION_KEY`: without it stored PAN and bank numbers cannot be read |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | first run | Creates the first Super Admin if none exists. If no password is given a strong one is generated and printed once |
| `GOOGLE_CLIENT_ID` | optional | Enables Google sign-in (public value) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `PUBLIC_URL` | optional | Enables GitHub sign-in; the callback is `PUBLIC_URL/api/v1/auth/github/callback` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | optional | Enables the Gemini-backed assistant (otherwise the built-in rules engine is used) |
| `MARKET_DATA` | optional | `off` disables the exchange-rate feed |
| `CORS_ORIGIN`, `TRUST_PROXY`, `UPLOAD_DIR`, `ENABLE_DOCS`, `RATE_LIMIT_MAX` | optional | Hosting details |

## Accounts, sign-in and approval

- **Methods**: email + password, Google, GitHub. Signed-in users can **link or unlink** methods from their profile page (always keeping at least one). *Connect to GitHub* lives on the **Profile** page.
- **A provider proves identity, not authority.** A first-time Google/GitHub user gets **no account** until they finish the onboarding wizard; until then only a short-lived, signed, HttpOnly cookie exists.
- **Startups and investors** are active immediately after onboarding; bidding (startups) and the directory (investors) unlock after admin verification.
- **Government, finance and inspector** requests (role, department, designation, official email, reason) wait in the admin queue. Until approved the account is `PENDING_APPROVAL` and **every data endpoint returns 403**; a rejected request stays locked out.
- **Auto-linking** a provider to an existing account only happens through an email the provider marks as **verified**. GitHub tokens are used once to read the profile and are **never stored**.
- Changing a verified startup's statutory or bank details sends it back for re-verification.

## Security model

- **Passwords**: Argon2id, strength policy, lockout after repeated failures, rate limits on all auth routes. Temporary admin-issued passwords are random, shown once, and must be changed.
- **Sessions**: signed token in an HttpOnly cookie plus a server-side session row; deactivating a user or changing their role takes effect immediately (the role is re-read from the database on every request).
- **Authorization**: enforced on the server per endpoint and per record (tenant scoping for startups, department scoping for officials, assignment scoping for inspectors). **Investors are deny-by-default**: the only endpoints an investor token can reach are the investor network, auth, notifications, the assistant and public data.
- **Data**: PAN and bank account numbers are encrypted at rest (AES-256-GCM) and shown masked; money is stored in integer paise; the audit log is append-only with a SHA-256 hash chain verified from the admin dashboard.
- **Transport and browser**: strict Content-Security-Policy (first-party plus exactly what Google Sign-In and fonts need), HSTS in production, `nosniff`, no-store on API responses.
- **Not yet done**: an independent penetration test, an accessibility audit, and email verification for password sign-ups.

## AI features

Everything works with **no AI key**: challenge drafting, proposal scoring and the assistant run on a built-in rules engine (a heuristic, not machine learning).

With `GEMINI_API_KEY` set, the assistant uses Gemini, **fenced in**: no tools (no web search or URL access), only role-scoped records plus an exchange-rate snapshot, off-topic questions never reach the model, any reply containing a link is discarded. AI is **advisory only**: it cannot select, approve, pay or change anything, and every call is logged. The market snapshot is the ECB's **daily reference rates** (USD/EUR/GBP vs INR) fetched by the server, not live quotes.

> **Privacy note.** On Google's *free* Gemini quota, Google may use submitted prompts to improve its products, and prompts include record details. Use paid quota for real data, or leave the key unset.

## API reference

Base path `/api/v1`. JSON in and out. Authentication is an HttpOnly session cookie (or `Authorization: Bearer <token>`). Interactive OpenAPI docs are served at `/docs` in development. The tables below are **generated from the route code**; a role list means only those roles may call the endpoint, and every role-less authenticated route still applies per-record checks inside the handler.

<details>
<summary><b>/api/v1/auth</b> (24 endpoints)</summary>

| Method | Path | Who may call it |
|---|---|---|
| `GET` | `/api/v1/auth/access-request` | any signed-in user |
| `POST` | `/api/v1/auth/change-password` | any signed-in user |
| `GET` | `/api/v1/auth/github/callback` | public |
| `POST` | `/api/v1/auth/github/link-url` | any signed-in user |
| `GET` | `/api/v1/auth/github/login` | public |
| `POST` | `/api/v1/auth/google` | public |
| `POST` | `/api/v1/auth/google/link` | any signed-in user |
| `GET` | `/api/v1/auth/identities` | any signed-in user |
| `DELETE` | `/api/v1/auth/identities/:provider` | any signed-in user |
| `POST` | `/api/v1/auth/login` | public |
| `POST` | `/api/v1/auth/logout` | any signed-in user |
| `POST` | `/api/v1/auth/logout-all` | any signed-in user |
| `GET` | `/api/v1/auth/me` | any signed-in user |
| `POST` | `/api/v1/auth/mfa/enable` | any signed-in user |
| `POST` | `/api/v1/auth/mfa/setup` | any signed-in user |
| `POST` | `/api/v1/auth/mfa/verify` | public |
| `GET` | `/api/v1/auth/onboarding` | public |
| `POST` | `/api/v1/auth/onboarding` | public |
| `GET` | `/api/v1/auth/organization` | startup |
| `PUT` | `/api/v1/auth/organization` | any signed-in user |
| `GET` | `/api/v1/auth/profile-links` | any signed-in user |
| `PUT` | `/api/v1/auth/profile-links` | any signed-in user |
| `POST` | `/api/v1/auth/register-startup` | public |
| `GET` | `/api/v1/auth/sessions` | any signed-in user |

</details>

<details>
<summary><b>/api/v1/challenges</b> (6 endpoints)</summary>

| Method | Path | Who may call it |
|---|---|---|
| `GET` | `/api/v1/challenges` | any signed-in user |
| `POST` | `/api/v1/challenges` | government, admin |
| `GET` | `/api/v1/challenges/:id` | any signed-in user |
| `POST` | `/api/v1/challenges/:id/close` | government, admin |
| `POST` | `/api/v1/challenges/:id/publish` | government, admin |
| `POST` | `/api/v1/challenges/ai-generate` | government, admin |

</details>

<details>
<summary><b>/api/v1/proposals</b> (4 endpoints)</summary>

| Method | Path | Who may call it |
|---|---|---|
| `GET` | `/api/v1/proposals` | any signed-in user |
| `POST` | `/api/v1/proposals` | startup |
| `POST` | `/api/v1/proposals/:id/ai-evaluate` | government, admin |
| `POST` | `/api/v1/proposals/:id/select` | government, admin |

</details>

<details>
<summary><b>/api/v1/pilots</b> (15 endpoints)</summary>

| Method | Path | Who may call it |
|---|---|---|
| `GET` | `/api/v1/pilots` | any signed-in user |
| `GET` | `/api/v1/pilots/:id` | any signed-in user |
| `POST` | `/api/v1/pilots/:id/assign-inspector` | government, admin |
| `POST` | `/api/v1/pilots/:id/inspections` | inspector, admin |
| `POST` | `/api/v1/pilots/:id/kpis/:kpiId/evidence` | startup |
| `POST` | `/api/v1/pilots/:id/kpis/:kpiId/verify` | inspector, admin |
| `POST` | `/api/v1/pilots/:id/milestones/:msId/submit` | startup |
| `POST` | `/api/v1/pilots/:id/milestones/:msId/verify` | inspector, admin |
| `GET` | `/api/v1/pilots/:id/report` | any signed-in user |
| `GET` | `/api/v1/pilots/:id/report.csv` | any signed-in user |
| `GET` | `/api/v1/pilots/:id/report.pdf` | any signed-in user |
| `POST` | `/api/v1/pilots/:id/risks` | inspector, admin |
| `PUT` | `/api/v1/pilots/:id/risks/:riskId` | inspector, admin |
| `POST` | `/api/v1/pilots/:id/submit-to-finance` | government, admin |
| `GET` | `/api/v1/pilots/inspectors/available` | government, admin |

</details>

<details>
<summary><b>/api/v1/finance</b> (18 endpoints)</summary>

| Method | Path | Who may call it |
|---|---|---|
| `GET` | `/api/v1/finance/anomalies` | finance, admin |
| `POST` | `/api/v1/finance/anomalies/:id/resolve` | finance, admin |
| `GET` | `/api/v1/finance/budget` | finance, admin |
| `POST` | `/api/v1/finance/copilot` | finance, admin |
| `GET` | `/api/v1/finance/dashboard` | finance, admin |
| `GET` | `/api/v1/finance/payments` | any signed-in user |
| `POST` | `/api/v1/finance/payments` | startup |
| `GET` | `/api/v1/finance/payments/:id` | any signed-in user |
| `POST` | `/api/v1/finance/payments/:id/approve` | finance, admin |
| `POST` | `/api/v1/finance/payments/:id/disburse` | finance, admin |
| `POST` | `/api/v1/finance/payments/:id/hold` | finance, admin |
| `POST` | `/api/v1/finance/payments/:id/reject` | finance, admin |
| `GET` | `/api/v1/finance/reports/budget.csv` | finance, admin |
| `GET` | `/api/v1/finance/reports/case-file/:id` | finance, admin |
| `GET` | `/api/v1/finance/reports/case-file/:id.csv` | finance, admin |
| `GET` | `/api/v1/finance/reports/case-file/:id.pdf` | finance, admin |
| `GET` | `/api/v1/finance/reports/claims.csv` | finance, admin |
| `GET` | `/api/v1/finance/stalled` | finance, admin |

</details>

<details>
<summary><b>/api/v1/admin</b> (20 endpoints)</summary>

| Method | Path | Who may call it |
|---|---|---|
| `GET` | `/api/v1/admin/access-requests` | admin |
| `POST` | `/api/v1/admin/access-requests/:id/approve` | admin |
| `POST` | `/api/v1/admin/access-requests/:id/reject` | admin |
| `GET` | `/api/v1/admin/ai` | admin |
| `GET` | `/api/v1/admin/ai/logs` | admin |
| `GET` | `/api/v1/admin/audit-logs` | admin |
| `GET` | `/api/v1/admin/dashboard` | admin |
| `GET` | `/api/v1/admin/departments` | admin |
| `POST` | `/api/v1/admin/departments` | admin |
| `PUT` | `/api/v1/admin/departments/:id` | admin |
| `GET` | `/api/v1/admin/investors` | admin |
| `PUT` | `/api/v1/admin/investors/:userId/verify` | admin |
| `GET` | `/api/v1/admin/settings` | admin |
| `PUT` | `/api/v1/admin/settings` | admin |
| `GET` | `/api/v1/admin/startups` | admin |
| `PUT` | `/api/v1/admin/startups/:id/verify` | admin |
| `GET` | `/api/v1/admin/users` | admin |
| `PUT` | `/api/v1/admin/users/:id` | admin |
| `POST` | `/api/v1/admin/users/:id/reset-password` | admin |
| `POST` | `/api/v1/admin/users/invite` | admin |

</details>

<details>
<summary><b>/api/v1/network</b> (8 endpoints)</summary>

| Method | Path | Who may call it |
|---|---|---|
| `GET` | `/api/v1/network/incoming` | startup |
| `POST` | `/api/v1/network/incoming/:id/respond` | startup |
| `GET` | `/api/v1/network/intros` | investor |
| `POST` | `/api/v1/network/intros` | investor |
| `GET` | `/api/v1/network/me` | investor |
| `PUT` | `/api/v1/network/me` | investor |
| `PUT` | `/api/v1/network/showcase` | startup |
| `GET` | `/api/v1/network/startups` | investor |

</details>

<details>
<summary><b>/api/v1/assistant</b> (2 endpoints)</summary>

| Method | Path | Who may call it |
|---|---|---|
| `POST` | `/api/v1/assistant/chat` | any signed-in user |
| `GET` | `/api/v1/assistant/status` | any signed-in user |

</details>

<details>
<summary><b>/api/v1/notifications</b> (4 endpoints)</summary>

| Method | Path | Who may call it |
|---|---|---|
| `GET` | `/api/v1/notifications` | any signed-in user |
| `POST` | `/api/v1/notifications/:id/read` | any signed-in user |
| `PUT` | `/api/v1/notifications/:id/read` | any signed-in user |
| `POST` | `/api/v1/notifications/read-all` | any signed-in user |

</details>

<details>
<summary><b>/api/v1/search</b> (1 endpoints)</summary>

| Method | Path | Who may call it |
|---|---|---|
| `GET` | `/api/v1/search` | any signed-in user |

</details>

<details>
<summary><b>/api/v1/audit</b> (1 endpoints)</summary>

| Method | Path | Who may call it |
|---|---|---|
| `GET` | `/api/v1/audit` | any signed-in user |

</details>

<details>
<summary><b>/api/v1/files</b> (2 endpoints)</summary>

| Method | Path | Who may call it |
|---|---|---|
| `GET` | `/api/v1/files/:id/download` | any signed-in user |
| `POST` | `/api/v1/files/upload` | any signed-in user |

</details>

<details>
<summary><b>/api/v1/public</b> (5 endpoints)</summary>

| Method | Path | Who may call it |
|---|---|---|
| `GET` | `/api/v1/public/challenges` | public |
| `GET` | `/api/v1/public/config` | public |
| `GET` | `/api/v1/public/departments` | public |
| `GET` | `/api/v1/public/stats` | public |
| `GET` | `/api/v1/public/transparency` | public |

</details>

Health probes: `GET /health` (liveness) and `GET /ready` (checks the database).

## Data model

PostgreSQL tables (all created by the idempotent migrations in `server/src/migrations/`):

`access_requests`, `ai_audit_logs`, `ai_evaluations`, `audit_logs`, `auth_identities`, `challenges`, `departments`, `files`, `finance_anomalies`, `finance_payment_claims`, `investor_intros`, `investor_profiles`, `invitations`, `kpi_submissions`, `notifications`, `organizations`, `pilot_inspections`, `pilot_kpis`, `pilot_milestones`, `pilots`, `profile_links`, `proposals`, `risks`, `sessions`, `stalled_pilots`, `system_settings`, `users`

Key rules: money columns are integer paise (`bigint`); `audit_logs` is append-only and hash-chained; `auth_identities` holds one row per linked sign-in provider; `access_requests` and `investor_profiles` back the approval flows.

## Design system

- **Logo**: a quarter-grid mark (an arch over a startup circle and an institution square) with the wordmark; used in the shell, sign-in and favicon.
- **Themes**: Graphite (default), Burst, Meadow, each light and dark. `src/theme.css` is generated from the palettes and remaps the design system's existing variables, so every screen re-skins at once. The choice is stored in `localStorage` and applied before first paint (`public/theme-init.js`).
- **Motion**: the brand intro and the login bridge animation respect `prefers-reduced-motion`; content is always visible even if animations do not run.
- **Wording**: deliberately mid-level jargon; plain words next to unavoidable terms such as TDS.

## Testing

```bash
npm run typecheck && npm run lint && npm test
```

86 backend tests cover: the full five-role procurement lifecycle and audit-chain integrity; per-role access boundaries (IDOR); the tax engine; Google token verification; the GitHub flow with a mocked GitHub (state/CSRF, verified-email rules, no token storage); onboarding for every role; approval and rejection; pending-account lockout; **investor isolation across every non-investor endpoint**; introductions and contact reveal; linking and the last-method rule; proposal-link rules; the assistant's scope fence; and the market feed. The suite also passes against a real PostgreSQL 16 (set `DATABASE_URL` and run with `--test-concurrency=1`). The interface has been exercised in a headless browser (themes, light/dark, GitHub sign-up wizard, approval, investor workspace, startup profile); there is no browser test suite in the repository yet.

## Deployment

See **[docs/DEPLOY.md](docs/DEPLOY.md)** for Render + Supabase step by step, Google and GitHub OAuth setup, and troubleshooting. `Dockerfile`, `docker-compose.yml` and `render.yaml` are included. One container serves the API and the web app.

## Known limits and roadmap

**Not built yet (planned)**
- Cheque and electronic payment lifecycle where money counts as spent **only when it clears** (today a payment is recorded with a bank reference), two-person approval above an amount threshold, a tax-remittance ledger, bank-statement matching.
- Email notifications and password reset (needs a domain and an email provider); email-and-password sign-up for investors and staff.
- File uploads screen and persistent storage (links are used instead), real DPIIT/CIN/PAN/GSTIN/bank verification APIs.
- Pilot management actions (extend, terminate), proposal drafts and withdrawal, challenge amendments and Q&A, dashboard trend charts, browser test suite.

**Know before you rely on it**
- Not independently security- or accessibility-audited. Treat as a prototype.
- Free hosting sleeps when idle and has no persistent disk; background jobs pause while asleep.
- Default tax rates (TDS 2%, GST-TDS 2% above ₹2.5 lakh) are general-knowledge defaults. **Have a tax advisor confirm them** (Admin → System settings).
- `docs/SPEC.md` is the original requirements document: it describes intended scope, not what is implemented, and its legal citations are unverified.
- Proposal "AI" scoring is a keyword heuristic.

## Contributing and licence

Run `npm run typecheck && npm run lint && npm test` before opening a pull request, keep money in integer paise, and add a test for any new endpoint's authorization. **No licence has been chosen yet**: add a `LICENSE` file before others use or contribute to the code.
