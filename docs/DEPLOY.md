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

## 3. Run it (Render)

New → Blueprint → select the repo (reads `render.yaml`). Enter when prompted:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Session pooler string from step 1 |
| `ADMIN_EMAIL` | your email (first Super Admin) |
| `GOOGLE_CLIENT_ID` | optional |
| `GEMINI_API_KEY` | optional; see privacy note in README |

`JWT_SECRET`, `COOKIE_SECRET`, `FIELD_ENCRYPTION_KEY` are generated for you. **Back up `FIELD_ENCRYPTION_KEY`**: if it is lost, stored PAN and bank numbers cannot be decrypted.

After deploy: open `/health` (should say UP), add the site URL to Google's authorized origins, then read the generated admin password from the service log (printed once) and sign in as Super Admin; you will be asked to change it.

`render.yaml` uses Render's **free** plan so you can trial without paying: the service sleeps when idle (the first request after a pause is slow) and uploaded files do not survive a redeploy. For real use switch to a paid plan and add the persistent disk shown in the comment at the top of `render.yaml`.

**If Render still asks for a card for the Blueprint**, create the service by hand instead: New → Web Service → pick the repo → Runtime **Docker**, Region **Singapore**, Instance type **Free**, Health Check Path `/health`, then add the environment variables from the table above plus `NODE_ENV=production`, and generate the three secrets yourself with `openssl rand -hex 32` (or any random 64-character string).

### Any other Docker host

`docker build -t s2s . && docker run -p 3001:3001 --env-file .env s2s` (copy `.env.example` to `.env`). Behind a proxy keep `TRUST_PROXY` on. `docker compose up --build` starts the app with its own Postgres (set `POSTGRES_PASSWORD` in `.env`).

## 4. After it is live

- Create departments and budgets (Admin → Departments), then invite officials, finance officers and inspectors (Admin → Users). Each gets a one-time temporary password.
- Review the rates in Admin → System settings against current tax rules.
- Check Admin → AI governance to see exactly what the AI can use.

## Troubleshooting

- *Server exits at start with "FATAL … must be set"*: a required secret or `DATABASE_URL` is missing.
- *Database connection errors*: use the **Session pooler** string, check the URL-encoded password.
- *Google button missing*: `GOOGLE_CLIENT_ID` unset, or the site URL is not in the authorized origins.
- *Google says "origin_mismatch"*: the origin has a typo, a trailing slash, or the change has not propagated yet (can take minutes).
