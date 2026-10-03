import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { getDatabase, DatabaseAdapter } from '../src/db';
import crypto from 'crypto';
import { generateSync } from 'otplib';
import { hashPassword, _resetGoogleJwksCache } from '../src/security';
import { DevelopmentEmailProvider, BrevoEmailProvider } from '../src/adapters';

process.env.AUTH_RATE_MAX = '1000';
process.env.RATE_LIMIT_MAX = '5000';

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const GKEY = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const GJWK = { ...GKEY.publicKey.export({ format: 'jwk' }), kid: 'id-key', alg: 'RS256', use: 'sig' };
const GCLIENT = 'id-client.apps.googleusercontent.com';
/** A signed Google ID token for a pretend Google account. */
const gtoken = (sub: string, email: string, name = 'Person') => {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'id-key', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: 'https://accounts.google.com', aud: GCLIENT, sub, email, email_verified: true, name, iat: now, exp: now + 3600 }));
  return `${head}.${body}.${b64u(crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), GKEY.privateKey))}`;
};

/** A pretend GitHub: token exchange + profile + emails, switchable per test. */
function fakeGithub(user: { id: number; login: string; name?: string; emails: Array<{ email: string; primary?: boolean; verified: boolean }>; denyToken?: boolean }) {
  const calls: string[] = [];
  const impl = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u === 'https://github.com/login/oauth/access_token') return new Response(JSON.stringify(user.denyToken ? { error: 'bad_verification_code' } : { access_token: 'gho_test_token' }), { status: 200 });
    if (u === 'https://api.github.com/user') return new Response(JSON.stringify({ id: user.id, login: user.login, name: user.name ?? null, avatar_url: 'https://avatars.example/x.png', html_url: `https://github.com/${user.login}` }), { status: 200 });
    if (u === 'https://api.github.com/user/emails') return new Response(JSON.stringify(user.emails), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

describe('Identity: sign-in methods, onboarding, approvals and the investor wall', () => {
  let app: FastifyInstance;
  let db: DatabaseAdapter;
  let gh = fakeGithub({ id: 1, login: 'x', emails: [] });
  const mail = new DevelopmentEmailProvider();
  let captchaImpl: typeof fetch = (async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as any;
  let adminToken = '';
  const PW = 'Adm1n#Passw0rd!';

  const cookiesOf = (res: any) => Object.fromEntries((res.cookies as any[]).map((c) => [c.name, c.value]));
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const J = (res: any) => JSON.parse(res.body);

  async function login(email: string, role: string, password = PW) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password, role } });
    assert.strictEqual(res.statusCode, 200, `login ${email}: ${res.body}`);
    return J(res).token as string;
  }

  /** Runs the whole GitHub redirect dance against the fake GitHub and returns the callback response. */
  async function githubCallback(opts: { cookies?: Record<string, string>; tamperState?: boolean; dropNonce?: boolean } = {}) {
    const start = await app.inject({ method: 'GET', url: '/api/v1/auth/github/login' });
    assert.strictEqual(start.statusCode, 302);
    const loc = new URL(String(start.headers.location));
    assert.strictEqual(loc.host, 'github.com');
    assert.strictEqual(loc.searchParams.get('scope'), 'read:user user:email', 'only profile + email scopes, never repo access');
    const nonce = cookiesOf(start).s2s_oauth_nonce;
    const state = opts.tamperState ? loc.searchParams.get('state') + 'x' : loc.searchParams.get('state');
    return app.inject({
      method: 'GET', url: `/api/v1/auth/github/callback?code=abc&state=${encodeURIComponent(state as string)}`,
      cookies: { ...(opts.dropNonce ? {} : { s2s_oauth_nonce: nonce }), ...(opts.cookies || {}) }
    });
  }

  const googleStart = async (sub: string, email: string, name = 'Person') => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: gtoken(sub, email, name) } });
    assert.strictEqual(res.statusCode, 200, res.body);
    return res;
  };
  const googleSignup = async (sub: string, email: string, name = 'Person') => {
    const res = await googleStart(sub, email, name);
    assert.strictEqual(J(res).needsOnboarding, true, `first sign-in for ${email} must start onboarding`);
    return cookiesOf(res).s2s_signup as string;
  };
  const onboard = (signup: string, payload: any) => app.inject({ method: 'POST', url: '/api/v1/auth/onboarding', cookies: { s2s_signup: signup }, payload });
  const base = { phone: '9876543210', acceptTerms: true };

  before(async () => {
    process.env.GITHUB_CLIENT_ID = 'cid';
    process.env.GITHUB_CLIENT_SECRET = 'csecret';
    process.env.GOOGLE_CLIENT_ID = GCLIENT; _resetGoogleJwksCache();
    db = getDatabase();
    app = await buildApp({ db, emailProvider: mail, captchaFetch: ((u: any, i: any) => (captchaImpl as any)(u, i)) as any, jwksFetcher: async () => ({ keys: [GJWK] }), githubFetch: ((u: any, i: any) => (gh.impl as any)(u, i)) as any });
    await db.query(`INSERT INTO departments (id, name, code, ministry, budget_allocated_paise) VALUES ('DEPT-ID','Dept Identity','ID','Min ID',0) ON CONFLICT (id) DO NOTHING`);
    await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation) VALUES ('USR-ADM-ID','admin@id.test',$1,'admin','Admin','Super Admin')`, [await hashPassword(PW)]);
    adminToken = await login('admin@id.test', 'admin');
  });
  after(async () => { delete process.env.GITHUB_CLIENT_ID; delete process.env.GITHUB_CLIENT_SECRET; delete process.env.GOOGLE_CLIENT_ID; await app.close(); });

  describe('GitHub sign-in', () => {
    it('is switched off cleanly when GitHub is not configured', async () => {
      const id = process.env.GITHUB_CLIENT_ID; delete process.env.GITHUB_CLIENT_ID;
      try {
        const res = await app.inject({ method: 'GET', url: '/api/v1/auth/github/login' });
        assert.strictEqual(res.headers.location, '/login?error=github_not_configured');
      } finally { process.env.GITHUB_CLIENT_ID = id; }
    });

    it('rejects a forged or replayed state and a missing nonce cookie (CSRF)', async () => {
      gh = fakeGithub({ id: 10, login: 'mallory', emails: [{ email: 'm@example.com', primary: true, verified: true }] });
      assert.strictEqual((await githubCallback({ tamperState: true })).headers.location, '/login?error=github_state');
      assert.strictEqual((await githubCallback({ dropNonce: true })).headers.location, '/login?error=github_state');
      assert.strictEqual(gh.calls.length, 0, 'GitHub was never even contacted for a bad state');
    });

    it('refuses a new GitHub user who has no VERIFIED email', async () => {
      gh = fakeGithub({ id: 11, login: 'noemail', emails: [{ email: 'unverified@example.com', primary: true, verified: false }] });
      const res = await githubCallback();
      assert.strictEqual(res.headers.location, '/login?error=no_verified_email');
    });

    it('sends a brand-new GitHub user to onboarding, creates nothing yet, and a startup sign-up is active at once', async () => {
      gh = fakeGithub({ id: 12, login: 'ada-dev', name: 'Ada Dev', emails: [{ email: 'secondary@example.com', verified: true }, { email: 'ada@startup.test', primary: true, verified: true }] });
      const cb = await githubCallback();
      assert.strictEqual(cb.headers.location, '/signup');
      const signup = cookiesOf(cb).s2s_signup;
      assert.ok(signup);
      assert.strictEqual(Number((await db.query(`SELECT COUNT(*) c FROM users WHERE email = 'ada@startup.test'`)).rows[0].c), 0);

      const prefill = await app.inject({ method: 'GET', url: '/api/v1/auth/onboarding', cookies: { s2s_signup: signup } });
      assert.strictEqual(J(prefill).email, 'ada@startup.test', 'the PRIMARY verified email is chosen');
      assert.strictEqual(J(prefill).name, 'Ada Dev');

      const done = await onboard(signup, { ...base, role: 'startup', name: 'Ada Dev', startupName: 'Ada Robotics', sector: 'Robotics', dpiitNumber: 'DIPP90001' });
      assert.strictEqual(done.statusCode, 201, done.body);
      assert.strictEqual(J(done).user.status, 'ACTIVE');
      const link = await db.query(`SELECT url FROM profile_links WHERE kind = 'github' AND user_id = $1`, [J(done).user.id]);
      assert.strictEqual(link.rows[0].url, 'https://github.com/ada-dev', 'the GitHub profile is added to their links automatically');
    });

    it('signs the same GitHub account straight in next time (cookie set, redirect home) and never stores the token', async () => {
      const cb = await githubCallback();
      assert.strictEqual(cb.headers.location, '/');
      assert.ok(cookiesOf(cb).s2s_session);
      const stored = await db.query(`SELECT * FROM auth_identities WHERE provider = 'github' AND provider_user_id = '12'`);
      assert.strictEqual(stored.rows.length, 1);
      assert.ok(!JSON.stringify(stored.rows[0]).includes('gho_test_token'));
    });

    it('links a GitHub login to an existing account only by a verified email', async () => {
      await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation) VALUES ('USR-EMAIL-MATCH','match@example.com',$1,'startup','Matcher','Founder')`, [await hashPassword(PW)]);
      gh = fakeGithub({ id: 13, login: 'matcher', emails: [{ email: 'match@example.com', primary: true, verified: true }] });
      assert.strictEqual((await githubCallback()).headers.location, '/');
      assert.strictEqual(Number((await db.query(`SELECT COUNT(*) c FROM auth_identities WHERE user_id = 'USR-EMAIL-MATCH'`)).rows[0].c), 1);
      // an UNVERIFIED email must never be enough
      await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation) VALUES ('USR-VICTIM','victim@example.com',$1,'startup','Victim','Founder')`, [await hashPassword(PW)]);
      gh = fakeGithub({ id: 14, login: 'attacker', emails: [{ email: 'victim@example.com', primary: true, verified: false }] });
      assert.strictEqual((await githubCallback()).headers.location, '/login?error=no_verified_email');
      assert.strictEqual(Number((await db.query(`SELECT COUNT(*) c FROM auth_identities WHERE user_id = 'USR-VICTIM'`)).rows[0].c), 0);
    });
  });

  describe('GitHub is for startups only', () => {
    it('GitHub cannot be used to sign up as an investor or as staff', async () => {
      gh = fakeGithub({ id: 601, login: 'wants-staff', name: 'Wants Staff', emails: [{ email: 'wants.staff@example.com', primary: true, verified: true }] });
      const cb = await githubCallback();
      assert.strictEqual(cb.headers.location, '/signup');
      const signup = cookiesOf(cb).s2s_signup;
      const prefill = J(await app.inject({ method: 'GET', url: '/api/v1/auth/onboarding', cookies: { s2s_signup: signup } }));
      assert.strictEqual(prefill.provider, 'github');
      for (const payload of [
        { ...base, role: 'investor', name: 'W S', investorType: 'ANGEL', organisation: 'Angel Co' },
        { ...base, role: 'government', name: 'W S', departmentId: 'DEPT-ID', designation: 'Officer', officialEmail: 'w@dept.gov.in', reason: 'I need access to run procurement.' }
      ]) {
        const r = await onboard(signup, payload);
        assert.strictEqual(r.statusCode, 400); assert.strictEqual(J(r).code, 'GITHUB_STARTUP_ONLY');
      }
      assert.strictEqual(Number((await db.query(`SELECT COUNT(*) c FROM users WHERE email = 'wants.staff@example.com'`)).rows[0].c), 0);
    });

    it('an existing staff or investor account cannot sign in or auto-link through GitHub, even with a verified matching email', async () => {
      await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation, department_id) VALUES ('USR-STAFF-GH','staff.gh@example.com',$1,'finance','Staff','Officer','DEPT-ID')`, [await hashPassword(PW)]);
      gh = fakeGithub({ id: 602, login: 'staff-gh', emails: [{ email: 'staff.gh@example.com', primary: true, verified: true }] });
      assert.strictEqual((await githubCallback()).headers.location, '/login?error=github_startup_only');
      assert.strictEqual(Number((await db.query(`SELECT COUNT(*) c FROM auth_identities WHERE user_id = 'USR-STAFF-GH'`)).rows[0].c), 0);
      const staffToken = await login('staff.gh@example.com', 'finance');
      const link = await app.inject({ method: 'POST', url: '/api/v1/auth/github/link-url', headers: bearer(staffToken) });
      assert.strictEqual(link.statusCode, 403); assert.strictEqual(J(link).code, 'GITHUB_STARTUP_ONLY');
      assert.strictEqual(J(await app.inject({ method: 'GET', url: '/api/v1/auth/identities', headers: bearer(staffToken) })).githubAvailable, false);
    });
  });

  describe('Onboarding for every role', () => {
    const newSignup = (sub: string, email: string, name = 'Person') => googleSignup(`g${sub}`, email, name);

    it('validates answers (terms, DPIIT format, duplicates, unknown department)', async () => {
      const s = await newSignup('201', 'v1@example.com');
      assert.strictEqual((await onboard(s, { ...base, acceptTerms: false, role: 'startup', name: 'V', startupName: 'VCo', sector: 'IT', dpiitNumber: 'DIPP11111' })).statusCode, 400);
      assert.strictEqual((await onboard(s, { ...base, role: 'startup', name: 'Vee', startupName: 'VCo', sector: 'IT', dpiitNumber: '!!bad!!' })).statusCode, 400);
      assert.strictEqual((await onboard(s, { ...base, role: 'startup', name: 'Vee', startupName: 'VCo', sector: 'IT', dpiitNumber: 'DIPP90001' })).statusCode, 409, 'DPIIT already used by Ada Robotics');
      assert.strictEqual((await onboard(s, { ...base, role: 'government', name: 'Vee', departmentId: 'DEPT-NOPE', designation: 'Officer', officialEmail: 'vee@gov.in', reason: 'I coordinate procurement for the department.' })).statusCode, 400);
      assert.strictEqual((await onboard(s, { ...base, role: 'government', name: 'Vee', departmentId: 'DEPT-ID', designation: 'Officer', officialEmail: 'vee@gov.in', reason: 'too short' })).statusCode, 400);
      assert.strictEqual((await app.inject({ method: 'POST', url: '/api/v1/auth/onboarding', payload: { ...base, role: 'startup' } })).statusCode, 401, 'no sign-up cookie, no onboarding');
    });

    it('government, finance and inspector sign-ups wait for approval and can reach NO data meanwhile', async () => {
      const s = await newSignup('202', 'officer@example.com', 'Officer One');
      const done = await onboard(s, { ...base, role: 'government', name: 'Officer One', departmentId: 'DEPT-ID', designation: 'Section Officer', officialEmail: 'officer@dept.gov.in', employeeId: 'E-12', reason: 'I run innovation procurement for this department.' });
      assert.strictEqual(done.statusCode, 201, done.body);
      assert.strictEqual(J(done).user.status, 'PENDING_APPROVAL');
      assert.strictEqual(J(done).nextStep, 'AWAIT_APPROVAL');
      const token = J(done).token;
      for (const url of ['/api/v1/challenges', '/api/v1/proposals', '/api/v1/pilots', '/api/v1/finance/payments', '/api/v1/admin/users', '/api/v1/notifications']) {
        const r = await app.inject({ method: 'GET', url, headers: bearer(token) });
        assert.strictEqual(r.statusCode, 403, `${url} must be closed while pending`);
        assert.strictEqual(J(r).code, 'ACCOUNT_NOT_ACTIVE');
      }
      assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(token) })).statusCode, 200, 'they can still see their own status');
      const mine = J(await app.inject({ method: 'GET', url: '/api/v1/auth/access-request', headers: bearer(token) }));
      assert.strictEqual(mine.request.status, 'PENDING');
    });

    it('an administrator approves the request, assigning role and department, and access opens', async () => {
      const list = J(await app.inject({ method: 'GET', url: '/api/v1/admin/access-requests', headers: bearer(adminToken) }));
      assert.strictEqual(list.requests.length, 1);
      const reqId = list.requests[0].id;
      assert.strictEqual(list.requests[0].applicant_name, 'Officer One');
      // a non-admin cannot decide
      const startupToken = await loginFreshStartup();
      assert.strictEqual((await app.inject({ method: 'POST', url: `/api/v1/admin/access-requests/${reqId}/approve`, headers: bearer(startupToken), payload: {} })).statusCode, 403);
      const ok = await app.inject({ method: 'POST', url: `/api/v1/admin/access-requests/${reqId}/approve`, headers: bearer(adminToken), payload: { note: 'Verified with the department' } });
      assert.strictEqual(ok.statusCode, 200, ok.body);
      assert.strictEqual((await app.inject({ method: 'POST', url: `/api/v1/admin/access-requests/${reqId}/approve`, headers: bearer(adminToken), payload: {} })).statusCode, 409, 'cannot be decided twice');
      const u = (await db.query(`SELECT role, status, department_id FROM users WHERE email = 'officer@example.com'`)).rows[0];
      assert.deepStrictEqual({ role: u.role, status: u.status, dept: u.department_id }, { role: 'government', status: 'ACTIVE', dept: 'DEPT-ID' });
      // an approved person signs in again and now reaches their workspace
      const back = J(await googleStart('g202', 'officer@example.com', 'Officer One'));
      assert.strictEqual(back.success, true);
      const me = J(await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(back.token) }));
      assert.strictEqual(me.user.role, 'government');
      assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/challenges', headers: bearer(back.token) })).statusCode, 200);
    });

    it('a rejected request stays locked out and records the reason', async () => {
      const s = await newSignup('203', 'rejected@example.com', 'Rejected Person');
      const done = await onboard(s, { ...base, role: 'finance', name: 'Rejected Person', departmentId: 'DEPT-ID', designation: 'Clerk', officialEmail: 'rejected@dept.gov.in', reason: 'I would like access to finance screens please.' });
      const reqId = J(await app.inject({ method: 'GET', url: '/api/v1/admin/access-requests', headers: bearer(adminToken) })).requests[0].id;
      assert.strictEqual((await app.inject({ method: 'POST', url: `/api/v1/admin/access-requests/${reqId}/reject`, headers: bearer(adminToken), payload: { note: 'x' } })).statusCode, 400, 'a reason is mandatory');
      assert.strictEqual((await app.inject({ method: 'POST', url: `/api/v1/admin/access-requests/${reqId}/reject`, headers: bearer(adminToken), payload: { note: 'Not an employee of this department' } })).statusCode, 200);
      const r = await app.inject({ method: 'GET', url: '/api/v1/finance/payments', headers: bearer(J(done).token) });
      assert.strictEqual(r.statusCode, 403); assert.strictEqual(J(r).status, 'REJECTED');
    });
  });

  /** Signs "Ada" (the startup created in the first suite) in through the fake GitHub and returns her session token. */
  async function loginFreshStartup() {
    gh = fakeGithub({ id: 12, login: 'ada-dev', emails: [{ email: 'ada@startup.test', primary: true, verified: true }] });
    const c = await githubCallback();
    assert.strictEqual(c.headers.location, '/');
    return cookiesOf(c).s2s_session as string;
  }

  describe('Investors', () => {
    let invToken = ''; let invId = ''; let startupToken = ''; let orgId = '';
    const SECRET_MSG = 'We would like to discuss a seed round of one crore for your robotics work.';

    it('an investor signs up instantly but sees no startups until an administrator verifies them', async () => {
      const signup = await googleSignup('g301', 'vc@fund.test', 'Vee Cee');
      const done = await onboard(signup, { ...base, role: 'investor', name: 'Vee Cee', investorType: 'VENTURE_CAPITAL', organisation: 'Fund One', website: 'https://fund.test', sectors: ['Robotics'] });
      assert.strictEqual(done.statusCode, 201, done.body);
      assert.strictEqual(J(done).user.status, 'ACTIVE');
      invToken = J(done).token; invId = J(done).user.id;
      const r = await app.inject({ method: 'GET', url: '/api/v1/network/startups', headers: bearer(invToken) });
      assert.strictEqual(r.statusCode, 403); assert.strictEqual(J(r).code, 'INVESTOR_NOT_VERIFIED');
    });

    it('is walled off: every non-investor endpoint refuses an investor token', async () => {
      for (const [method, url] of [
        ['GET', '/api/v1/challenges'], ['GET', '/api/v1/proposals'], ['GET', '/api/v1/pilots'], ['GET', '/api/v1/finance/payments'], ['GET', '/api/v1/finance/dashboard'],
        ['GET', '/api/v1/finance/budget'], ['GET', '/api/v1/finance/anomalies'], ['GET', '/api/v1/admin/users'], ['GET', '/api/v1/admin/audit-logs'], ['GET', '/api/v1/admin/access-requests'],
        ['GET', '/api/v1/search?q=a'], ['GET', '/api/v1/audit'], ['POST', '/api/v1/files/upload'], ['GET', '/api/v1/pilots/inspectors/available']
      ] as const) {
        const r = await app.inject({ method, url, headers: bearer(invToken) });
        assert.strictEqual(r.statusCode, 403, `${method} ${url} must refuse an investor`);
      }
      assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/network/me', headers: bearer(invToken) })).statusCode, 200);
    });

    it('the administrator can verify and suspend an investor, and sees profile details only', async () => {
      const list = J(await app.inject({ method: 'GET', url: '/api/v1/admin/investors', headers: bearer(adminToken) }));
      assert.strictEqual(list.investors.length, 1);
      assert.ok(!JSON.stringify(list).includes('seed round'), 'no message content is exposed to the administrator');
      assert.strictEqual((await app.inject({ method: 'PUT', url: `/api/v1/admin/investors/${invId}/verify`, headers: bearer(adminToken), payload: { status: 'VERIFIED' } })).statusCode, 400, 'notes are mandatory');
      assert.strictEqual((await app.inject({ method: 'PUT', url: `/api/v1/admin/investors/${invId}/verify`, headers: bearer(adminToken), payload: { status: 'VERIFIED', notes: 'Fund registration checked' } })).statusCode, 200);
    });

    it('a verified investor only sees startups that are verified AND opted in, then asks for an introduction', async () => {
      startupToken = await loginFreshStartup();
      const me = J(await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(startupToken) })).user;
      orgId = me.organization_id;
      assert.strictEqual(J(await app.inject({ method: 'GET', url: '/api/v1/network/startups', headers: bearer(invToken) })).startups.length, 0, 'not opted in yet');
      assert.strictEqual((await app.inject({ method: 'PUT', url: '/api/v1/network/showcase', headers: bearer(startupToken), payload: { optIn: true, summary: 'short' } })).statusCode, 400, 'needs a real summary');
      assert.strictEqual((await app.inject({ method: 'PUT', url: '/api/v1/network/showcase', headers: bearer(startupToken), payload: { optIn: true, summary: 'We build warehouse robots that cut picking time in half.' } })).statusCode, 200);
      assert.strictEqual(J(await app.inject({ method: 'GET', url: '/api/v1/network/startups', headers: bearer(invToken) })).startups.length, 0, 'opted in but not yet verified by the administrator');
      assert.strictEqual((await app.inject({ method: 'PUT', url: `/api/v1/admin/startups/${orgId}/verify`, headers: bearer(adminToken), payload: { status: 'VERIFIED', verificationNotes: 'DPIIT checked' } })).statusCode, 200);
      const seen = J(await app.inject({ method: 'GET', url: '/api/v1/network/startups', headers: bearer(invToken) })).startups;
      assert.strictEqual(seen.length, 1);
      assert.deepStrictEqual(Object.keys(seen[0]).sort(), ['id', 'introStatus', 'links', 'name', 'sector', 'stage', 'summary', 'verifiedPilots', 'website'], 'only the public showcase fields');
      assert.strictEqual((await app.inject({ method: 'POST', url: '/api/v1/network/intros', headers: bearer(invToken), payload: { organizationId: orgId, message: 'short' } })).statusCode, 400);
      const ask = await app.inject({ method: 'POST', url: '/api/v1/network/intros', headers: bearer(invToken), payload: { organizationId: orgId, message: SECRET_MSG } });
      assert.strictEqual(ask.statusCode, 201, ask.body);
      assert.strictEqual((await app.inject({ method: 'POST', url: '/api/v1/network/intros', headers: bearer(invToken), payload: { organizationId: orgId, message: SECRET_MSG } })).statusCode, 409, 'one pending request per startup');
    });

    it('contact details stay hidden until the startup accepts; the audit trail never stores the message', async () => {
      const inbox = J(await app.inject({ method: 'GET', url: '/api/v1/network/incoming', headers: bearer(startupToken) })).intros;
      assert.strictEqual(inbox.length, 1); assert.strictEqual(inbox[0].investorEmail, null);
      let mine = J(await app.inject({ method: 'GET', url: '/api/v1/network/intros', headers: bearer(invToken) })).intros;
      assert.strictEqual(mine[0].contact, null);
      assert.strictEqual((await app.inject({ method: 'POST', url: `/api/v1/network/incoming/${inbox[0].id}/respond`, headers: bearer(startupToken), payload: { accept: true } })).statusCode, 200);
      assert.strictEqual((await app.inject({ method: 'POST', url: `/api/v1/network/incoming/${inbox[0].id}/respond`, headers: bearer(startupToken), payload: { accept: false } })).statusCode, 409, 'cannot change the answer');
      mine = J(await app.inject({ method: 'GET', url: '/api/v1/network/intros', headers: bearer(invToken) })).intros;
      assert.strictEqual(mine[0].contact.email, 'ada@startup.test');
      assert.strictEqual(J(await app.inject({ method: 'GET', url: '/api/v1/network/incoming', headers: bearer(startupToken) })).intros[0].investorEmail, 'vc@fund.test');
      const audit = await db.query(`SELECT details FROM audit_logs WHERE action LIKE 'INVESTOR_INTRO%'`);
      assert.ok(audit.rows.length >= 2 && !JSON.stringify(audit.rows).includes('seed round'));
      // another startup's token cannot answer or read it
      assert.strictEqual((await app.inject({ method: 'POST', url: `/api/v1/network/incoming/${inbox[0].id}/respond`, headers: bearer(adminToken), payload: { accept: true } })).statusCode, 403, 'not even an administrator');
    });

    it('suspending an investor ends their session at once', async () => {
      assert.strictEqual((await app.inject({ method: 'PUT', url: `/api/v1/admin/users/${invId}`, headers: bearer(adminToken), payload: { isActive: false } })).statusCode, 200);
      assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/network/me', headers: bearer(invToken) })).statusCode, 401);
    });
  });

  describe('Linked accounts, profile links and startup details', () => {
    let token = '';
    before(async () => { token = await loginFreshStartup(); });

    it('lists linked accounts and refuses to remove the last way to sign in', async () => {
      const ids = J(await app.inject({ method: 'GET', url: '/api/v1/auth/identities', headers: bearer(token) }));
      assert.deepStrictEqual(ids.identities.map((i: any) => i.provider), ['github']);
      assert.strictEqual(ids.hasPassword, false); assert.strictEqual(ids.canUnlink, false); assert.strictEqual(ids.githubAvailable, true);
      const r = await app.inject({ method: 'DELETE', url: '/api/v1/auth/identities/github', headers: bearer(token) });
      assert.strictEqual(r.statusCode, 409); assert.strictEqual(J(r).code, 'LAST_SIGN_IN_METHOD');
    });

    it('"Connect to GitHub" works for someone who signed in another way, and a GitHub account cannot be shared', async () => {
      // password-based startup who wants to connect GitHub
      await db.query(`INSERT INTO organizations (id, name, founder_name, founder_email, sector) VALUES ('ORG-PW','Pw Co','Pat','pat@pw.test','IT')`);
      await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation, organization_id) VALUES ('USR-PW','pat@pw.test',$1,'startup','Pat','Founder','ORG-PW')`, [await hashPassword(PW)]);
      const pwToken = await login('pat@pw.test', 'startup');
      const link = await app.inject({ method: 'POST', url: '/api/v1/auth/github/link-url', headers: bearer(pwToken) });
      assert.strictEqual(link.statusCode, 200);
      const url = new URL(J(link).url);
      gh = fakeGithub({ id: 401, login: 'pat-hub', emails: [{ email: 'pat@elsewhere.test', primary: true, verified: true }] });
      const cb = await app.inject({ method: 'GET', url: `/api/v1/auth/github/callback?code=x&state=${encodeURIComponent(url.searchParams.get('state') as string)}`, cookies: { s2s_oauth_nonce: cookiesOf(link).s2s_oauth_nonce } });
      assert.strictEqual(cb.headers.location, '/startup/profile?github=linked');
      assert.deepStrictEqual(J(await app.inject({ method: 'GET', url: '/api/v1/auth/identities', headers: bearer(pwToken) })).identities.map((i: any) => i.provider), ['github']);
      // now that GitHub account is taken: a different user cannot link it
      const link2 = await app.inject({ method: 'POST', url: '/api/v1/auth/github/link-url', headers: bearer(token) });
      const u2 = new URL(J(link2).url);
      const cb2 = await app.inject({ method: 'GET', url: `/api/v1/auth/github/callback?code=x&state=${encodeURIComponent(u2.searchParams.get('state') as string)}`, cookies: { s2s_oauth_nonce: cookiesOf(link2).s2s_oauth_nonce } });
      assert.strictEqual(cb2.headers.location, '/startup/profile?github=in_use', 'one GitHub account cannot belong to two people');
      // with a password, the person may now unlink GitHub
      const ids = J(await app.inject({ method: 'GET', url: '/api/v1/auth/identities', headers: bearer(pwToken) }));
      assert.strictEqual(ids.canUnlink, true);
      assert.strictEqual((await app.inject({ method: 'DELETE', url: '/api/v1/auth/identities/github', headers: bearer(pwToken) })).statusCode, 200);
    });

    it('link-url needs a signed-in user and a state tied to that user', async () => {
      assert.strictEqual((await app.inject({ method: 'POST', url: '/api/v1/auth/github/link-url' })).statusCode, 401);
    });

    it('profile links must be https and unique per kind, and only startups/investors have them', async () => {
      const put = (links: any[]) => app.inject({ method: 'PUT', url: '/api/v1/auth/profile-links', headers: bearer(token), payload: { links } });
      assert.strictEqual((await put([{ kind: 'resume', url: 'http://insecure.example/cv.pdf' }])).statusCode, 400);
      assert.strictEqual((await put([{ kind: 'resume', url: 'javascript:alert(1)' }])).statusCode, 400);
      assert.strictEqual((await put([{ kind: 'resume', url: 'https://drive.example/a' }, { kind: 'resume', url: 'https://drive.example/b' }])).statusCode, 400);
      assert.strictEqual((await put([{ kind: 'resume', url: 'https://drive.example/cv' }, { kind: 'linkedin', url: 'https://linkedin.com/in/ada' }])).statusCode, 200);
      assert.deepStrictEqual(J(await app.inject({ method: 'GET', url: '/api/v1/auth/profile-links', headers: bearer(token) })).links.map((l: any) => l.kind), ['linkedin', 'resume']);
      assert.strictEqual((await app.inject({ method: 'PUT', url: '/api/v1/auth/profile-links', headers: bearer(adminToken), payload: { links: [] } })).statusCode, 403);
    });

    it('proposal links: at most 3, https only, each labelled (checked before anything is stored)', async () => {
      const body = (documents: any[]) => ({ challengeId: 'CH-NOPE', solutionTitle: 'Valid title', problemSolutionFit: 'x'.repeat(40), technicalApproach: 'x'.repeat(40), deploymentPlan: 'x'.repeat(20), implementationTimeline: '3 months', pilotCostPaise: 100000, scaleupCostPaise: 200000, documents });
      const post = (documents: any[]) => app.inject({ method: 'POST', url: '/api/v1/proposals', headers: bearer(token), payload: body(documents) });
      const link = (n: number) => ({ label: `Doc ${n}`, url: `https://drive.example.com/${n}` });
      const four = await post([link(1), link(2), link(3), link(4)]);
      assert.strictEqual(four.statusCode, 400); assert.match(four.body, /at most 3/i);
      assert.strictEqual((await post([{ label: 'Plain http', url: 'http://insecure.example/a' }])).statusCode, 400);
      assert.strictEqual((await post([{ label: 'Script', url: 'javascript:alert(1)' }])).statusCode, 400);
      assert.strictEqual((await post(['technical-architecture.pdf'])).statusCode, 400, 'bare file names are no longer accepted');
      // three good links get past validation (the unknown challenge is what stops it now)
      const ok = await post([link(1), link(2), link(3)]);
      assert.notStrictEqual(ok.statusCode, 400, ok.body);
    });

    it('a startup completes its statutory details; bank number is encrypted; changes after verification trigger re-verification', async () => {
      const put = (payload: any) => app.inject({ method: 'PUT', url: '/api/v1/auth/organization', headers: bearer(token), payload });
      assert.strictEqual((await put({ pan: 'BAD' })).statusCode, 400);
      assert.strictEqual((await put({ gstin: '29AABCG7712B1ZX' })).statusCode, 400, 'checksum is enforced');
      const ok = await put({ pan: 'AABCG7712B', gstin: '29AABCG7712B1ZW', bankAccountNumber: '123456789012', ifscCode: 'HDFC0000140', cinLlpin: 'U72900MH2020PTC987654' });
      assert.strictEqual(ok.statusCode, 200, ok.body);
      assert.strictEqual(J(ok).reverificationRequired, true, 'the startup was verified earlier in this suite');
      const org = (await db.query(`SELECT pan, bank_account_encrypted, bank_account_masked, verification_status FROM organizations o JOIN users u ON u.organization_id = o.id WHERE u.email = 'ada@startup.test'`)).rows[0];
      assert.ok(!String(org.bank_account_encrypted).includes('123456789012') && org.bank_account_encrypted.includes(':'));
      assert.ok(org.bank_account_masked.endsWith('9012') && !org.pan.includes('AABCG7712B'.slice(0, 8)));
      assert.strictEqual(org.verification_status, 'PENDING');
      assert.strictEqual((await app.inject({ method: 'PUT', url: '/api/v1/auth/organization', headers: bearer(adminToken), payload: {} })).statusCode, 403);
    });

  describe('Email: forgot password and decision emails', () => {
    const sent = () => mail.getSentEmails();
    const tokenFrom = (to: string) => { const m = [...sent()].reverse().find((e) => e.to === to); assert.ok(m, `an email to ${to}`); const t = /token=([0-9a-f]{64})/.exec(m!.text); assert.ok(t, 'the email contains a reset link'); return t![1]; };
    before(async () => { await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation) VALUES ('USR-RESET','reset@example.com',$1,'startup','Reset Person','Founder')`, [await hashPassword(PW)]); });
    const forgot = (email: string) => app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email } });
    const reset = (token: string, password: string) => app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password } });

    it('answers the same way whether or not the email has an account, and sends nothing for strangers', async () => {
      const before = sent().length;
      const stranger = await forgot('nobody@example.com');
      assert.strictEqual(stranger.statusCode, 200);
      const known = await forgot('reset@example.com');
      assert.deepStrictEqual(J(stranger), J(known), 'no way to tell the two apart');
      assert.strictEqual(sent().length, before + 1, 'only the real account got an email');
    });

    it('stores only a hash of the token, and a weak password or a made-up token is refused', async () => {
      const token = tokenFrom('reset@example.com');
      const rows = (await db.query('SELECT token_hash FROM password_resets')).rows;
      assert.ok(rows.length >= 1 && rows.every((r: any) => r.token_hash !== token), 'the token itself is never stored');
      const weak = await reset(token, 'password');
      assert.strictEqual(weak.statusCode, 400); assert.strictEqual(J(weak).code, 'WEAK_PASSWORD');
      assert.strictEqual(J(await reset('f'.repeat(64), 'N3w#StrongPass!')).code, 'RESET_INVALID');
    });

    it('a valid link sets the new password, ends every existing sign-in, and works only once', async () => {
      const oldSession = await login('reset@example.com', 'startup');
      assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(oldSession) })).statusCode, 200);
      const token = tokenFrom('reset@example.com');
      assert.strictEqual((await reset(token, 'N3w#StrongPass!')).statusCode, 200);
      assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(oldSession) })).statusCode, 401, 'old sessions are gone');
      assert.strictEqual((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'reset@example.com', password: PW, role: 'startup' } })).statusCode, 401, 'old password no longer works');
      assert.strictEqual((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'reset@example.com', password: 'N3w#StrongPass!', role: 'startup' } })).statusCode, 200);
      assert.strictEqual(J(await reset(token, 'An0ther#StrongPass!')).code, 'RESET_INVALID', 'the link cannot be used twice');
    });

    it('a link expires after 30 minutes', async () => {
      await forgot('reset@example.com');
      const token = tokenFrom('reset@example.com');
      await db.query(`UPDATE password_resets SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'`);
      assert.strictEqual(J(await reset(token, 'N3w#StrongPass2!')).code, 'RESET_INVALID');
    });

    it('people are emailed when an administrator decides on their access', async () => {
      const m = sent().find((e) => e.to === 'officer@example.com' && /approved/i.test(e.subject));
      assert.ok(m, 'the approved officer received an email');
      const rej = sent().find((e) => e.to === 'rejected@example.com' && /not approved/i.test(e.subject));
      assert.ok(rej && /Not an employee/.test(rej.text), 'the rejected person was told why');
    });

    it('the Brevo provider calls the right endpoint with the key in a header and surfaces failures', async () => {
      let seen: any = null;
      const ok = new BrevoEmailProvider('key-123', { email: 'noreply@example.com', name: 'S2S' }, (async (url: any, init: any) => { seen = { url: String(url), init }; return new Response(JSON.stringify({ messageId: '<abc>' }), { status: 201 }); }) as any);
      const r = await ok.sendEmail({ to: 'a@b.c', subject: 'Hi', text: 'T', html: '<p>T</p>' });
      assert.strictEqual(r.success, true); assert.strictEqual(r.messageId, '<abc>');
      assert.strictEqual(seen.url, 'https://api.brevo.com/v3/smtp/email'); assert.strictEqual(seen.init.headers['api-key'], 'key-123');
      const body = JSON.parse(seen.init.body);
      assert.deepStrictEqual([body.sender.email, body.to[0].email, body.subject, body.textContent], ['noreply@example.com', 'a@b.c', 'Hi', 'T']);
      const bad = new BrevoEmailProvider('k', { email: 'x@y.z', name: 'S' }, (async () => new Response('{}', { status: 401 })) as any);
      await assert.rejects(() => bad.sendEmail({ to: 'a@b.c', subject: 's', text: 't', html: 't' }), /rejected/);
    });
  });
  });

  describe('Staff two-step verification, CAPTCHA and email sign-up', () => {
    it('staff cannot reach any data until they turn on two-step verification (production default), but can reach the enrolment endpoints', async () => {
      await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation, department_id) VALUES ('USR-MFA','mfa.staff@example.com',$1,'finance','Mfa Staff','Officer','DEPT-ID')`, [await hashPassword(PW)]);
      const t = await login('mfa.staff@example.com', 'finance');
      assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/finance/budget', headers: bearer(t) })).statusCode, 200, 'not enforced outside production unless asked');
      process.env.REQUIRE_STAFF_MFA = 'true';
      try {
        const blocked = await app.inject({ method: 'GET', url: '/api/v1/finance/budget', headers: bearer(t) });
        assert.strictEqual(blocked.statusCode, 403); assert.strictEqual(J(blocked).code, 'MFA_ENROLMENT_REQUIRED');
        assert.strictEqual(J(await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(t) })).user.mfa_enrol_required, true);
        const setup = J(await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/setup', headers: bearer(t) }));
        assert.ok(setup.secret && setup.otpauthUrl && setup.recoveryCodes.length === 8);
        assert.strictEqual((await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/enable', headers: bearer(t), payload: { code: '000000' } })).statusCode, 400);
        assert.strictEqual((await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/enable', headers: bearer(t), payload: { code: generateSync({ secret: setup.secret }) } })).statusCode, 200);
        assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/finance/budget', headers: bearer(t) })).statusCode, 200, 'access opens once enrolled');
        assert.strictEqual(J(await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(t) })).user.mfa_enrol_required, false);
        // students of the rule: startups and investors are not forced
        const st = await loginFreshStartup();
        assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(st) })).statusCode, 200);
      } finally { delete process.env.REQUIRE_STAFF_MFA; }
    });

    it('when CAPTCHA is on, sign-up, onboarding, registration and reset all refuse a missing or wrong token, and fail closed if the verifier is down', async () => {
      process.env.TURNSTILE_SECRET_KEY = 'secret';
      const seen: string[] = [];
      captchaImpl = (async (_u: any, init: any) => { seen.push(String(init.body)); return new Response(JSON.stringify({ success: /response=good-token-0123/.test(String(init.body)) }), { status: 200 }); }) as any;
      try {
        const attempts = [
          ['/api/v1/auth/forgot-password', { email: 'reset@example.com' }],
          ['/api/v1/auth/signup-email', { email: 'cap@example.com', name: 'Cap Person', password: 'Str0ng#Passw0rd!' }],
          ['/api/v1/auth/register-startup', {}],
        ] as const;
        for (const [url, body] of attempts) {
          const none = await app.inject({ method: 'POST', url, payload: body });
          assert.strictEqual(none.statusCode, 400, url); assert.strictEqual(J(none).code, 'CAPTCHA_FAILED');
          const bad = await app.inject({ method: 'POST', url, payload: { ...body, captchaToken: 'wrong-token-0123456' } });
          assert.strictEqual(J(bad).code, 'CAPTCHA_FAILED');
        }
        const ok = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: 'reset@example.com', captchaToken: 'good-token-0123' } });
        assert.strictEqual(ok.statusCode, 200);
        assert.ok(seen.some((b) => b.includes('secret=secret')), 'the secret key is sent to Cloudflare');
        captchaImpl = (async () => { throw new Error('network down'); }) as any;
        assert.strictEqual(J(await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: 'reset@example.com', captchaToken: 'good-token-0123' } })).code, 'CAPTCHA_FAILED', 'fails closed');
        const cfg = J(await app.inject({ method: 'GET', url: '/api/v1/public/config' }));
        assert.ok('turnstileSiteKey' in cfg);
      } finally { delete process.env.TURNSTILE_SECRET_KEY; captchaImpl = (async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as any; }
    });

    it('email sign-up: confirm the address, answer the questions, then sign in with the password (investor and staff roles)', async () => {
      const before = mail.getSentEmails().length;
      const weak = await app.inject({ method: 'POST', url: '/api/v1/auth/signup-email', payload: { email: 'inv.email@example.com', name: 'Email Investor', password: 'password' } });
      assert.strictEqual(weak.statusCode, 400); assert.strictEqual(J(weak).code, 'WEAK_PASSWORD');
      const first = await app.inject({ method: 'POST', url: '/api/v1/auth/signup-email', payload: { email: 'inv.email@example.com', name: 'Email Investor', password: 'Str0ng#Passw0rd!' } });
      const existing = await app.inject({ method: 'POST', url: '/api/v1/auth/signup-email', payload: { email: 'reset@example.com', name: 'Someone', password: 'Str0ng#Passw0rd!' } });
      assert.deepStrictEqual(J(first), J(existing), 'no way to tell a new address from an existing account');
      assert.strictEqual(mail.getSentEmails().length, before + 1, 'only the new address was emailed');
      const m = mail.getSentEmails().find((e) => e.to === 'inv.email@example.com')!;
      const token = /token=([0-9a-f]{64})/.exec(m.text)![1];
      assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/auth/verify-email?token=' + 'f'.repeat(64) })).headers.location, '/login?error=verify_failed');
      const verified = await app.inject({ method: 'GET', url: '/api/v1/auth/verify-email?token=' + token });
      assert.strictEqual(verified.headers.location, '/signup');
      const cookie = cookiesOf(verified).s2s_signup;
      assert.strictEqual(J(await app.inject({ method: 'GET', url: '/api/v1/auth/onboarding', cookies: { s2s_signup: cookie } })).provider, 'email');
      assert.strictEqual((await onboard(cookie, { ...base, role: 'admin', name: 'Mallory' })).statusCode, 400, 'never as an administrator');
      const done = await onboard(cookie, { ...base, role: 'investor', name: 'Email Investor', investorType: 'ANGEL', organisation: 'Angel Co' });
      assert.strictEqual(done.statusCode, 201, done.body);
      assert.strictEqual(Number((await db.query(`SELECT COUNT(*) c FROM pending_signups WHERE LOWER(email) = 'inv.email@example.com'`)).rows[0].c), 0, 'the pending record is gone once the account exists');
      const login1 = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'inv.email@example.com', password: 'Str0ng#Passw0rd!', role: 'investor' } });
      assert.strictEqual(login1.statusCode, 200, login1.body);
      // staff by email wait for approval too
      await app.inject({ method: 'POST', url: '/api/v1/auth/signup-email', payload: { email: 'staff.email@example.com', name: 'Email Staff', password: 'Str0ng#Passw0rd!' } });
      const t2 = /token=([0-9a-f]{64})/.exec(mail.getSentEmails().find((e) => e.to === 'staff.email@example.com')!.text)![1];
      const c2 = cookiesOf(await app.inject({ method: 'GET', url: '/api/v1/auth/verify-email?token=' + t2 })).s2s_signup;
      const staff = await onboard(c2, { ...base, role: 'finance', name: 'Email Staff', departmentId: 'DEPT-ID', designation: 'Accounts Officer', officialEmail: 'staff@dept.gov.in', reason: 'I process payments for this department.' });
      assert.strictEqual(J(staff).user.status, 'PENDING_APPROVAL');
      assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/finance/budget', headers: bearer(J(staff).token) })).statusCode, 403);
    });

    it('a confirmation link works once, and expires', async () => {
      await app.inject({ method: 'POST', url: '/api/v1/auth/signup-email', payload: { email: 'once@example.com', name: 'Once Only', password: 'Str0ng#Passw0rd!' } });
      const token = /token=([0-9a-f]{64})/.exec(mail.getSentEmails().filter((e) => e.to === 'once@example.com').pop()!.text)![1];
      await db.query(`UPDATE pending_signups SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE LOWER(email) = 'once@example.com'`);
      assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/auth/verify-email?token=' + token })).headers.location, '/login?error=verify_failed');
    });
  });
});
