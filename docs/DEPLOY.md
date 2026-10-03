# Deploying Startup2Sarkar

One container runs the API and the web app on a single port. You need a PostgreSQL database and a place to run the container.

## 1. Database (Supabase)

1. Create a project (choose a region near your users, e.g. Mumbai). Save the database password.
2. Open **Connect** → the **Direct / Connection string** tab (not Framework or ORM) → choose **Session pooler**. Copy the string; it looks like
   `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`
3. Replace `[YOUR-PASSWORD]` with your password. If it contains special characters (`@ # / ? :`), URL-encode them.

The app creates all tables itself on first start (idempotent migrations). Never paste this string anywhere public.

## 2. Google sign-in (optional)

Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application).
**Authorized JavaScript origins**: your exact site URL, `https://…`, no trailing slash (add `http://localhost:3001` for local tests). No redirect URIs are needed. Publish the consent screen so users beyond test users can sign in. Set the Client ID as `GOOGLE_CLIENT_ID`.

## 2c. Human check (optional): Cloudflare Turnstile

Create a free Turnstile widget in the Cloudflare dashboard (Turnstile → Add widget), add your site's hostname, and copy the **site key** and **secret key**. Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Sign-up, onboarding, startup registration and "forgot password" then require the check and refuse anything without it.

## 2d. Document storage (recommended): Supabase Storage

In Supabase open **Storage → New bucket**, name it `documents` and keep it **private**. Under **Project Settings → API** copy the project URL and the `service_role` key. Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (and `SUPABASE_BUCKET` if you used another name). The service key can read everything in the project, so it belongs only in the host's environment settings. Without these, uploaded PDFs go to local disk and disappear on redeploy unless `UPLOAD_DIR` is a mounted volume.

## 2a. Email (optional): forgot-password and decision emails

Create a Brevo account (brevo.com), verify a sender address (best: an address on a domain you own, with the SPF and DKIM records Brevo shows you), and create an API key. Set `BREVO_API_KEY` and `EMAIL_FROM` (the verified sender) on the host. Once both are set the sign-in page shows **Forgot password?** and people are emailed when an administrator approves or rejects their access or verifies an investor. Check Brevo's current free-plan daily limit on its pricing page. Reset links work once and expire after 30 minutes. If email is not configured, staff can still ask an administrator to reset their password.

## 2b. GitHub sign-in (optional, startups only)

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
**Homepage URL**: your site. **Authorization callback URL**: `https://<your-site>/api/v1/auth/github/callback` (exact; no trailing slash). Create the app, copy the **Client ID**, generate a **Client secret**, and set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `PUBLIC_URL` (your site's address) on the host. The secret must never go in the repository. If a person's GitHub account has no *verified* email, they are asked to verify one on GitHub first. GitHub sign-in is deliberately limited to **startups**; government, finance, inspector, investor and admin accounts use Google or a password.

## 3. Run it (Render)

New → Blueprint → select the repo (reads `render.yaml`). Enter when prompted:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Session pooler string from step 1 |
| `ADMIN_EMAIL` | your email (first Super Admin) |
| `GOOGLE_CLIENT_ID` | optional |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `PUBLIC_URL` | optional, for GitHub sign-in |
| `GEMINI_API_KEY` | optional; see privacy note in README |

`JWT_SECRET`, `COOKIE_SECRET`, `FIELD_ENCRYPTION_KEY` are generated for you. **Back up `FIELD_ENCRYPTION_KEY`**: if it is lost, stored PAN and bank numbers cannot be decrypted.

After deploy: open `/health` (should say UP), add the site URL to Google's authorized origins, then read the generated admin password from the service log (printed once) and sign in as Super Admin; you will be asked to change it.

`render.yaml` uses Render's **free** plan so you can trial without paying: the service sleeps when idle (the first request after a pause is slow) and uploaded files do not survive a redeploy. For real use switch to a paid plan and add the persistent disk shown in the comment at the top of `render.yaml`.

**If Render still asks for a card for the Blueprint**, create the service by hand instead: New → Web Service → pick the repo → Runtime **Docker**, Region **Singapore**, Instance type **Free**, Health Check Path `/health`, then add the environment variables from the table above plus `NODE_ENV=production`, and generate the three secrets yourself with `openssl rand -hex 32` (or any random 64-character string).

### Any other Docker host

`docker build -t s2s . && docker run -p 3001:3001 --env-file .env s2s` (copy `.env.example` to `.env`). Behind a proxy keep `TRUST_PROXY` on. `docker compose up --build` starts the app with its own Postgres (set `POSTGRES_PASSWORD` in `.env`).

## 3b. Upgrading an existing deployment

New releases add database tables and columns automatically on start (migrations `002`-`005`, all idempotent). Watch the first deploy's log for any migration error. Back up the database before upgrading a deployment that holds real data.

## 3c. Two-step verification for staff

In production every government, finance, inspector and admin account must turn on two-step verification before it can reach any data; the first administrator is asked on first sign-in. Keep the recovery codes somewhere safe.

## 3d. Bank payment files

Each bank accepts bulk transfers in its own layout. In **Admin → System settings → Bank payment file layouts** add one layout per bank, copying the column order from the template your bank gives you. Finance then chooses a layout when exporting from **Payment claims → Bank payment file**. The file contains account numbers, so treat it like cash: download it, upload it to the bank, and delete it.

## 4. After it is live

- Create departments and budgets (Admin → Departments), then invite officials, finance officers and inspectors (Admin → Users). Each gets a one-time temporary password.
- Review the rates in Admin → System settings against current tax rules, and set the **two-person approval amount** (default ₹50,00,000).
- Check Admin → AI governance to see exactly what the AI can use.

## Troubleshooting

- *Server exits at start with "FATAL … must be set"*: a required secret or `DATABASE_URL` is missing.
- *Database connection errors*: use the **Session pooler** string, check the URL-encoded password.
- *Google button missing*: `GOOGLE_CLIENT_ID` unset, or the site URL is not in the authorized origins.
- *Google says "origin_mismatch"*: the origin has a typo, a trailing slash, or the change has not propagated yet (can take minutes).
