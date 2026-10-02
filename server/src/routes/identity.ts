import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DatabaseAdapter } from '../db';
import { AuditService } from '../audit';
import {
  AuthenticatedRequest, JwksFetcher, RoleName, createAuthMiddleware, encryptField, hashPassword, isValidCinOrLlpin,
  isValidDpiitNumber, isValidGstin, isValidIfsc, isValidPan, maskBankAccount, maskPan, signBlob, signToken,
  verifyBlob, verifyGoogleIdToken
} from '../security';

/**
 * Social sign-in (Google, GitHub), account linking, new-person onboarding and access requests.
 *
 * Principles:
 *  - A sign-in provider proves WHO someone is, never WHAT authority they have. Startups and investors may
 *    self-register; government, finance and inspector accounts need an administrator's approval.
 *  - Nothing is created until the person finishes onboarding: a half-finished sign-up lives only in a short-lived
 *    signed cookie, so there are no orphan accounts and no placeholder roles.
 *  - OAuth tokens from GitHub are used once to read the profile and are never stored.
 */

export interface IdentityOptions {
  db: DatabaseAdapter;
  auditService: AuditService;
  jwksFetcher?: JwksFetcher;
  /** Test hook: replace the network client used to talk to GitHub */
  githubFetch?: typeof fetch;
}

type Provider = 'google' | 'github';
interface SocialIdentity {
  provider: Provider;
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  picture?: string;
  profileUrl?: string;
  login?: string;
}

const IS_PROD = process.env.NODE_ENV === 'production';
const PRIVILEGED: RoleName[] = ['government', 'inspector', 'finance', 'admin'];
const SIGNUP_COOKIE = 's2s_signup';
const NONCE_COOKIE = 's2s_oauth_nonce';

const https = z.string().trim().url().max(300).refine((u) => /^https:\/\//i.test(u), 'Links must start with https://');

const commonOnboarding = {
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[0-9+\-\s]{7,20}$/, 'Enter a valid phone number'),
  acceptTerms: z.literal(true, { message: 'You must accept the terms to continue' })
};

const onboardingSchema = z.discriminatedUnion('role', [
  z.object({
    ...commonOnboarding,
    role: z.literal('startup'),
    startupName: z.string().trim().min(2).max(120),
    sector: z.string().trim().min(2).max(80),
    dpiitNumber: z.string().trim().min(5).max(40)
  }),
  z.object({
    ...commonOnboarding,
    role: z.literal('investor'),
    investorType: z.enum(['ANGEL', 'VENTURE_CAPITAL', 'CSR_FUNDER', 'CORPORATE', 'FAMILY_OFFICE', 'BANK_OR_NBFC', 'OTHER']),
    organisation: z.string().trim().min(2).max(120),
    website: https.optional().or(z.literal('')),
    linkedinUrl: https.optional().or(z.literal('')),
    sectors: z.array(z.string().trim().min(2).max(60)).max(8).default([])
  }),
  z.object({
    ...commonOnboarding,
    role: z.enum(['government', 'finance', 'inspector']),
    departmentId: z.string().min(3).max(60),
    designation: z.string().trim().min(2).max(120),
    officialEmail: z.string().trim().email().max(200),
    employeeId: z.string().trim().max(60).optional().or(z.literal('')),
    reason: z.string().trim().min(20).max(600)
  })
]);

const profileLinksSchema = z.object({
  links: z.array(z.object({
    kind: z.enum(['resume', 'linkedin', 'github', 'instagram', 'x', 'website', 'pitch_deck', 'demo_video', 'other']),
    url: https
  })).max(9)
});

export async function identityRoutes(app: FastifyInstance, opts: IdentityOptions) {
  const { db, auditService } = opts;
  const authenticate = createAuthMiddleware(db);
  const ghFetch = opts.githubFetch ?? fetch;
  const AUTH_RATE = { config: { rateLimit: { max: parseInt(process.env.AUTH_RATE_MAX || '10', 10), timeWindow: '1 minute' } } };

  const meta = (request: FastifyRequest) => ({
    ipAddress: request.ip || '127.0.0.1',
    userAgent: (request.headers['user-agent'] as string) || 'Unknown'
  });
  const id = (prefix: string) => `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const cookieOpts = (maxAge: number) => ({ path: '/', httpOnly: true, secure: IS_PROD, sameSite: 'lax' as const, maxAge });

  const userView = (u: any) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, designation: u.designation,
    departmentId: u.department_id, organizationId: u.organization_id, mfaEnabled: u.mfa_enabled,
    mustChangePassword: false, mfaEnrollmentRequired: PRIVILEGED.includes(u.role) && !u.mfa_enabled && u.status === 'ACTIVE'
  });

  async function startSession(user: any, request: FastifyRequest, reply: FastifyReply, action: string, provider: Provider) {
    const sessionId = `SESS-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000);
    const m = meta(request);
    await db.query('INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5)', [sessionId, user.id, m.ipAddress, m.userAgent, expiresAt]);
    const token = signToken({ userId: user.id, email: user.email, role: user.role, name: user.name, departmentId: user.department_id, organizationId: user.organization_id, sessionId });
    reply.setCookie('s2s_session', token, { path: '/', httpOnly: true, secure: IS_PROD, sameSite: 'strict', maxAge: 8 * 3600 });
    await auditService.logEvent({ actorId: user.id, actorName: user.name, actorRole: user.role, action, entityType: 'AUTH', entityId: sessionId, details: { role: user.role, provider }, ...m });
    return { success: true, user: userView(user), token };
  }

  /** Decide what happens after a provider has proven an identity. */
  async function resolveSocialLogin(ident: SocialIdentity, request: FastifyRequest, reply: FastifyReply, gatewayRole?: RoleName) {
    const generic = { kind: 'error' as const, status: 401, code: 'AUTH_FAILED', message: 'Invalid credentials or unauthorized login gateway for this operational identity' };

    let user = (await db.query(
      `SELECT u.* FROM auth_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = $1 AND i.provider_user_id = $2`,
      [ident.provider, ident.sub]
    )).rows[0];

    if (!user && ident.email && ident.emailVerified) {
      // A verified email that already belongs to an account is proof of control of that address: link it.
      user = (await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [ident.email])).rows[0];
      if (user) {
        if (!user.is_active) return generic;
        const taken = await db.query('SELECT 1 FROM auth_identities WHERE user_id = $1 AND provider = $2', [user.id, ident.provider]);
        if (taken.rows.length > 0) return generic; // that account is already tied to a DIFFERENT provider account
        await db.query(
          `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, email, email_verified, display_name, profile_url) VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7)`,
          [id('IDN'), user.id, ident.provider, ident.sub, ident.email, ident.name, ident.profileUrl || null]
        );
        await auditService.logEvent({ actorId: user.id, actorName: user.name, actorRole: user.role, action: 'AUTH_IDENTITY_LINKED', entityType: 'USER', entityId: user.id, details: { provider: ident.provider, by: 'verified-email' }, ...meta(request) });
      }
    }

    if (user) {
      if (!user.is_active) return generic;
      if (gatewayRole && user.role !== gatewayRole) {
        await auditService.logEvent({ actorId: user.id, actorName: user.name, actorRole: user.role, action: 'AUTH_SOCIAL_REJECTED', entityType: 'AUTH', entityId: user.id, details: { gateway: gatewayRole }, ...meta(request) });
        return generic;
      }
      if (user.mfa_enabled && user.mfa_secret) {
        const tempToken = signToken({ userId: user.id, email: user.email, role: user.role, name: user.name, departmentId: user.department_id, organizationId: user.organization_id, sessionId: `TEMP-MFA-${Date.now()}` }, 300);
        return { kind: 'mfa' as const, tempToken };
      }
      const payload = await startSession(user, request, reply, `AUTH_${ident.provider.toUpperCase()}_LOGIN`, ident.provider);
      return { kind: 'session' as const, payload };
    }

    // Brand-new person
    if (!ident.email || !ident.emailVerified) {
      return { kind: 'error' as const, status: 400, code: 'NO_VERIFIED_EMAIL', message: `Your ${ident.provider === 'github' ? 'GitHub' : 'Google'} account has no verified email address. Verify one there, or sign in another way.` };
    }
    const signup = signBlob({ p: ident.provider, s: ident.sub, e: ident.email, n: ident.name, a: ident.picture || null, u: ident.profileUrl || null, l: ident.login || null }, 1800);
    reply.setCookie(SIGNUP_COOKIE, signup, cookieOpts(1800));
    return { kind: 'onboarding' as const };
  }

  // ───────────────────────── Google ─────────────────────────
  app.post('/google', AUTH_RATE, async (request, reply) => {
    const parsed = z.object({
      credential: z.string().min(20).max(4096),
      role: z.enum(['government', 'startup', 'inspector', 'finance', 'admin', 'investor']).optional()
    }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid sign-in payload' });
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return reply.status(503).send({ error: 'Google sign-in is not configured on this server', code: 'GOOGLE_NOT_CONFIGURED' });

    let g;
    try { g = await verifyGoogleIdToken(parsed.data.credential, clientId, opts.jwksFetcher); }
    catch { return reply.status(503).send({ error: 'Could not reach Google to verify the sign-in. Try again shortly.', code: 'GOOGLE_UNAVAILABLE' }); }
    if (!g) return reply.status(401).send({ error: 'Invalid credentials or unauthorized login gateway for this operational identity', code: 'AUTH_FAILED' });

    const result = await resolveSocialLogin(
      { provider: 'google', sub: g.sub, email: g.email, emailVerified: g.emailVerified, name: g.name, picture: g.picture },
      request, reply, parsed.data.role
    );
    if (result.kind === 'error') return reply.status(result.status).send({ error: result.message, code: result.code });
    if (result.kind === 'mfa') return reply.send({ requireMfa: true, tempToken: result.tempToken, message: 'Enter your 6-digit authenticator code' });
    if (result.kind === 'onboarding') return reply.send({ needsOnboarding: true });
    return reply.send(result.payload);
  });

  app.post('/google/link', { preHandler: [authenticate], ...AUTH_RATE }, async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ credential: z.string().min(20).max(4096) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid payload' });
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return reply.status(503).send({ error: 'Google sign-in is not configured on this server', code: 'GOOGLE_NOT_CONFIGURED' });
    let g;
    try { g = await verifyGoogleIdToken(parsed.data.credential, clientId, opts.jwksFetcher); }
    catch { return reply.status(503).send({ error: 'Could not reach Google. Try again shortly.', code: 'GOOGLE_UNAVAILABLE' }); }
    if (!g) return reply.status(401).send({ error: 'Google could not confirm that sign-in', code: 'AUTH_FAILED' });
    const out = await linkIdentity(authReq.user.userId, { provider: 'google', sub: g.sub, email: g.email, emailVerified: true, name: g.name, picture: g.picture }, request);
    return reply.status(out.status).send(out.body);
  });

  async function linkIdentity(userId: string, ident: SocialIdentity, request: FastifyRequest) {
    const owner = (await db.query('SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_user_id = $2', [ident.provider, ident.sub])).rows[0];
    if (owner && owner.user_id !== userId) return { status: 409, body: { error: `That ${ident.provider} account is already linked to a different user.`, code: 'IDENTITY_IN_USE' } };
    if (owner) return { status: 200, body: { success: true, alreadyLinked: true } };
    const existing = (await db.query('SELECT 1 FROM auth_identities WHERE user_id = $1 AND provider = $2', [userId, ident.provider])).rows;
    if (existing.length > 0) return { status: 409, body: { error: `You already have a different ${ident.provider} account linked. Unlink it first.`, code: 'PROVIDER_ALREADY_LINKED' } };
    await db.query(
      `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, email, email_verified, display_name, profile_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id('IDN'), userId, ident.provider, ident.sub, ident.email, ident.emailVerified, ident.name, ident.profileUrl || null]
    );
    const u = (await db.query('SELECT id, name, role FROM users WHERE id = $1', [userId])).rows[0];
    await auditService.logEvent({ actorId: userId, actorName: u.name, actorRole: u.role, action: 'AUTH_IDENTITY_LINKED', entityType: 'USER', entityId: userId, details: { provider: ident.provider, by: 'signed-in-user' }, ...meta(request) });
    return { status: 200, body: { success: true } };
  }

  // ───────────────────────── GitHub (authorization-code flow, server side) ─────────────────────────
  const githubReady = () => !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  const baseUrl = (request: FastifyRequest) => (process.env.PUBLIC_URL || `${request.protocol}://${request.hostname}`).replace(/\/+$/, '');

  function githubAuthorizeUrl(request: FastifyRequest, reply: FastifyReply, intent: 'login' | 'link', uid?: string) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = signBlob({ n: nonce, intent, uid: uid || null }, 600);
    reply.setCookie(NONCE_COOKIE, nonce, cookieOpts(600));
    const qs = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID as string,
      redirect_uri: `${baseUrl(request)}/api/v1/auth/github/callback`,
      scope: 'read:user user:email',
      state,
      allow_signup: 'true'
    });
    return `https://github.com/login/oauth/authorize?${qs.toString()}`;
  }

  app.get('/github/login', AUTH_RATE, async (request, reply) => {
    if (!githubReady()) return reply.redirect('/login?error=github_not_configured');
    return reply.redirect(githubAuthorizeUrl(request, reply, 'login'));
  });

  app.post('/github/link-url', { preHandler: [authenticate], ...AUTH_RATE }, async (request, reply) => {
    if (!githubReady()) return reply.status(503).send({ error: 'GitHub sign-in is not configured on this server', code: 'GITHUB_NOT_CONFIGURED' });
    const authReq = request as AuthenticatedRequest;
    return reply.send({ url: githubAuthorizeUrl(request, reply, 'link', authReq.user.userId) });
  });

  async function readGithubIdentity(code: string, request: FastifyRequest): Promise<SocialIdentity | null> {
    const tokenRes = await ghFetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Startup2Sarkar' },
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${baseUrl(request)}/api/v1/auth/github/callback` }),
      signal: AbortSignal.timeout(8000)
    });
    const tokenJson: any = await tokenRes.json().catch(() => ({}));
    const accessToken = tokenJson?.access_token;
    if (!accessToken || typeof accessToken !== 'string') return null;
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}`, 'User-Agent': 'Startup2Sarkar' };
    const [uRes, eRes] = await Promise.all([
      ghFetch('https://api.github.com/user', { headers, signal: AbortSignal.timeout(8000) }),
      ghFetch('https://api.github.com/user/emails', { headers, signal: AbortSignal.timeout(8000) })
    ]);
    if (!uRes.ok) return null;
    const gu: any = await uRes.json();
    const emails: any[] = eRes.ok ? ((await eRes.json().catch(() => [])) as any[]) : [];
    // Only an email GitHub itself marks as verified is trusted (primary first)
    const verified = emails.filter((e) => e && e.verified === true && typeof e.email === 'string');
    const chosen = verified.find((e) => e.primary) || verified[0];
    if (!gu?.id) return null;
    return {
      provider: 'github',
      sub: String(gu.id),
      email: chosen ? String(chosen.email).toLowerCase() : null,
      emailVerified: !!chosen,
      name: String(gu.name || gu.login || 'GitHub user').slice(0, 120),
      picture: gu.avatar_url,
      profileUrl: typeof gu.html_url === 'string' ? gu.html_url : undefined,
      login: gu.login
    };
    // (the access token goes out of scope here and is never stored)
  }

  app.get('/github/callback', AUTH_RATE, async (request, reply) => {
    const q = request.query as { code?: string; state?: string; error?: string };
    const state = verifyBlob<{ n: string; intent: 'login' | 'link'; uid: string | null }>(q.state);
    const nonce = (request.cookies || {})[NONCE_COOKIE];
    reply.clearCookie(NONCE_COOKIE, { path: '/' });
    if (!state || !nonce || state.n !== nonce) return reply.redirect('/login?error=github_state');
    if (q.error || !q.code) return reply.redirect('/login?error=github_denied');

    let ident: SocialIdentity | null = null;
    try { ident = await readGithubIdentity(q.code, request); } catch { ident = null; }
    if (!ident) return reply.redirect('/login?error=github_failed');

    if (state.intent === 'link') {
      const uid = state.uid;
      if (!uid) return reply.redirect('/login?error=github_state');
      const u = (await db.query('SELECT role, status FROM users WHERE id = $1 AND is_active = TRUE', [uid])).rows[0];
      if (!u) return reply.redirect('/login?error=github_state');
      const out = await linkIdentity(uid, ident, request);
      const profile = ['startup', 'investor'].includes(u.role) ? `/${u.role}/profile` : `/${u.role}/dashboard`;
      return reply.redirect(`${profile}?github=${out.status === 200 ? 'linked' : out.body.code === 'IDENTITY_IN_USE' ? 'in_use' : 'error'}`);
    }

    const result = await resolveSocialLogin(ident, request, reply);
    if (result.kind === 'error') return reply.redirect(`/login?error=${result.code.toLowerCase()}`);
    if (result.kind === 'mfa') return reply.redirect(`/login#mfa=${encodeURIComponent(result.tempToken)}`);
    if (result.kind === 'onboarding') return reply.redirect('/signup');
    return reply.redirect('/');
  });

  // ───────────────────────── Linked accounts ─────────────────────────
  app.get('/identities', { preHandler: [authenticate] }, async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const rows = (await db.query('SELECT provider, email, display_name, profile_url, created_at FROM auth_identities WHERE user_id = $1 ORDER BY created_at', [authReq.user.userId])).rows;
    const u = (await db.query('SELECT has_password FROM users WHERE id = $1', [authReq.user.userId])).rows[0];
    const methods = rows.length + (u?.has_password ? 1 : 0);
    return reply.send({
      identities: rows.map((r: any) => ({ provider: r.provider, email: r.email, displayName: r.display_name, profileUrl: r.profile_url, linkedAt: r.created_at })),
      hasPassword: !!u?.has_password,
      canUnlink: methods > 1,
      githubAvailable: githubReady(),
      googleAvailable: !!process.env.GOOGLE_CLIENT_ID
    });
  });

  app.delete('/identities/:provider', { preHandler: [authenticate] }, async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const provider = (request.params as { provider: string }).provider;
    if (provider !== 'google' && provider !== 'github') return reply.status(400).send({ error: 'Unknown provider' });
    const rows = (await db.query('SELECT provider FROM auth_identities WHERE user_id = $1', [authReq.user.userId])).rows;
    if (!rows.some((r: any) => r.provider === provider)) return reply.status(404).send({ error: 'That account is not linked' });
    const u = (await db.query('SELECT has_password FROM users WHERE id = $1', [authReq.user.userId])).rows[0];
    if (rows.length - 1 + (u?.has_password ? 1 : 0) < 1) {
      return reply.status(409).send({ error: 'You must keep at least one way to sign in. Link another account before unlinking this one.', code: 'LAST_SIGN_IN_METHOD' });
    }
    await db.query('DELETE FROM auth_identities WHERE user_id = $1 AND provider = $2', [authReq.user.userId, provider]);
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'AUTH_IDENTITY_UNLINKED', entityType: 'USER', entityId: authReq.user.userId, details: { provider }, ...meta(request) });
    return reply.send({ success: true });
  });

  // ───────────────────────── Onboarding (new people) ─────────────────────────
  app.get('/onboarding', async (request, reply) => {
    const s = verifyBlob<any>((request.cookies || {})[SIGNUP_COOKIE]);
    if (!s) return reply.status(404).send({ error: 'No sign-up in progress. Sign in with Google or GitHub to start.', code: 'NO_SIGNUP' });
    const depts = (await db.query('SELECT id, name FROM departments WHERE is_active = TRUE ORDER BY name')).rows;
    return reply.send({ provider: s.p, email: s.e, name: s.n, avatar: s.a, githubLogin: s.l, departments: depts });
  });

  app.post('/onboarding', AUTH_RATE, async (request, reply) => {
    const s = verifyBlob<any>((request.cookies || {})[SIGNUP_COOKIE]);
    if (!s) return reply.status(401).send({ error: 'Your sign-up session expired. Please sign in with Google or GitHub again.', code: 'NO_SIGNUP' });
    const parsed = onboardingSchema.safeParse(request.body);
    if (!parsed.success) {
      const flat = parsed.error.issues.map((i) => `${i.path.join('.') || 'form'}: ${i.message}`);
      return reply.status(400).send({ error: 'Please check the highlighted answers', details: flat });
    }
    const d = parsed.data;
    const email = String(s.e).toLowerCase();

    if ((await db.query('SELECT 1 FROM users WHERE LOWER(email) = $1', [email])).rows.length > 0) {
      return reply.status(409).send({ error: 'An account with this email already exists. Sign in instead.', code: 'EMAIL_EXISTS' });
    }
    if ((await db.query('SELECT 1 FROM auth_identities WHERE provider = $1 AND provider_user_id = $2', [s.p, s.s])).rows.length > 0) {
      return reply.status(409).send({ error: 'This sign-in is already registered. Sign in instead.', code: 'IDENTITY_EXISTS' });
    }

    const userId = id('USR');
    const unusable = await hashPassword(crypto.randomBytes(32).toString('base64') + 'aA1!');
    const m = meta(request);
    let status: 'ACTIVE' | 'PENDING_APPROVAL' = 'ACTIVE';
    let orgId: string | null = null;
    let deptId: string | null = null;

    if (d.role === 'startup') {
      const dp = d.dpiitNumber.toUpperCase();
      if (!isValidDpiitNumber(dp)) return reply.status(400).send({ error: 'That DPIIT recognition number is not in a valid format', details: ['dpiitNumber: invalid format'] });
      if ((await db.query('SELECT 1 FROM organizations WHERE dpiit_number = $1', [dp])).rows.length > 0) {
        return reply.status(409).send({ error: 'A startup with this DPIIT number is already registered', code: 'DPIIT_EXISTS' });
      }
      orgId = id('ORG');
    } else if (d.role === 'government' || d.role === 'finance' || d.role === 'inspector') {
      const dept = (await db.query('SELECT id FROM departments WHERE id = $1 AND is_active = TRUE', [d.departmentId])).rows[0];
      if (!dept) return reply.status(400).send({ error: 'Choose a department from the list', details: ['departmentId: unknown department'] });
      deptId = dept.id;
      status = 'PENDING_APPROVAL';
    }

    await db.transaction(async (tx) => {
      if (d.role === 'startup' && orgId) {
        await tx.query(
          `INSERT INTO organizations (id, name, dpiit_number, founder_name, founder_email, founder_phone, sector, verification_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')`,
          [orgId, d.startupName, d.dpiitNumber.toUpperCase(), d.name, email, d.phone, d.sector]
        );
      }
      await tx.query(
        `INSERT INTO users (id, email, password_hash, role, name, designation, department_id, organization_id, google_sub, auth_provider, has_password, phone, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11, $12)`,
        [userId, email, unusable, d.role, d.name,
         d.role === 'startup' ? 'Founder' : d.role === 'investor' ? 'Investor' : (d as any).designation,
         deptId, orgId, s.p === 'google' ? s.s : null, s.p, d.phone, status]
      );
      await tx.query(
        `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, email, email_verified, display_name, profile_url) VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7)`,
        [id('IDN'), userId, s.p, s.s, email, s.n, s.u || null]
      );
      if (d.role === 'investor') {
        await tx.query(
          `INSERT INTO investor_profiles (user_id, investor_type, organisation, website, linkedin_url, sectors) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [userId, d.investorType, d.organisation, d.website || null, d.linkedinUrl || null, JSON.stringify(d.sectors)]
        );
      }
      if (d.role === 'government' || d.role === 'finance' || d.role === 'inspector') {
        await tx.query(
          `INSERT INTO access_requests (id, user_id, requested_role, department_id, designation, official_email, phone, employee_id, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id('REQ'), userId, d.role, deptId, d.designation, d.officialEmail.toLowerCase(), d.phone, d.employeeId || null, d.reason]
        );
      }
      if (s.p === 'github' && s.u) {
        await tx.query(`INSERT INTO profile_links (id, user_id, kind, url) VALUES ($1,$2,'github',$3) ON CONFLICT DO NOTHING`, [id('LNK'), userId, s.u]);
      }
      const note = d.role === 'startup' ? ['New startup registered', `${d.startupName} is waiting for verification.`, '/admin/users']
        : d.role === 'investor' ? ['New investor registered', `${d.name} (${d.organisation}) is waiting for verification.`, '/admin/access-requests']
        : ['New access request', `${d.name} asked for ${d.role} access.`, '/admin/access-requests'];
      await tx.query(`INSERT INTO notifications (id, role, title, message, priority, action_link) VALUES ($1,'admin',$2,$3,'INFO',$4)`, [id('NTF'), note[0], note[1], note[2]]);
    });

    reply.clearCookie(SIGNUP_COOKIE, { path: '/' });
    const user = (await db.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
    await auditService.logEvent({
      actorId: userId, actorName: d.name, actorRole: d.role,
      action: status === 'PENDING_APPROVAL' ? 'ACCESS_REQUEST_SUBMITTED' : 'AUTH_SOCIAL_SIGNUP',
      entityType: 'USER', entityId: userId, details: { provider: s.p, role: d.role }, ...m
    });
    const payload = await startSession(user, request, reply, 'AUTH_SOCIAL_SIGNUP_SESSION', s.p);
    return reply.status(201).send({ ...payload, isNewAccount: true, nextStep: status === 'PENDING_APPROVAL' ? 'AWAIT_APPROVAL' : d.role === 'startup' ? 'AWAIT_VERIFICATION' : d.role === 'investor' ? 'AWAIT_VERIFICATION' : 'DONE' });
  });

  app.get('/access-request', { preHandler: [authenticate] }, async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const row = (await db.query(
      `SELECT r.id, r.requested_role, r.designation, r.official_email, r.reason, r.status, r.review_note, r.created_at, r.reviewed_at, d.name AS department_name
       FROM access_requests r LEFT JOIN departments d ON d.id = r.department_id WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 1`,
      [authReq.user.userId]
    )).rows[0];
    return reply.send({ request: row || null });
  });

  // ───────────────────────── Profile links ─────────────────────────
  app.get('/profile-links', { preHandler: [authenticate] }, async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const rows = (await db.query('SELECT kind, url FROM profile_links WHERE user_id = $1 ORDER BY kind', [authReq.user.userId])).rows;
    return reply.send({ links: rows });
  });

  app.put('/profile-links', { preHandler: [authenticate] }, async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    if (!['startup', 'investor'].includes(authReq.user.role)) return reply.status(403).send({ error: 'Profile links are for startups and investors', code: 'INSUFFICIENT_ROLE_PERMISSIONS' });
    const parsed = profileLinksSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Every link must be a full https:// address', details: parsed.error.issues.map((i) => i.message) });
    const kinds = new Set(parsed.data.links.map((l) => l.kind));
    if (kinds.size !== parsed.data.links.length) return reply.status(400).send({ error: 'Each kind of link can be added only once' });
    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM profile_links WHERE user_id = $1', [authReq.user.userId]);
      for (const l of parsed.data.links) {
        await tx.query('INSERT INTO profile_links (id, user_id, kind, url) VALUES ($1,$2,$3,$4)', [id('LNK'), authReq.user.userId, l.kind, l.url]);
      }
    });
    return reply.send({ success: true });
  });

  // ───────────────────────── Startup registration details (completed after sign-up) ─────────────────────────
  const orgUpdateSchema = z.object({
    cinLlpin: z.string().trim().min(5).max(30).optional(),
    pan: z.string().trim().length(10).optional(),
    gstin: z.string().trim().length(15).optional(),
    bankAccountNumber: z.string().trim().regex(/^[0-9]{9,18}$/, 'Bank account number must be 9–18 digits').optional(),
    ifscCode: z.string().trim().length(11).optional(),
    website: https.optional().or(z.literal('')),
    founderPhone: z.string().trim().regex(/^[0-9+\-\s]{7,20}$/).optional(),
    sector: z.string().trim().min(2).max(80).optional(),
    stage: z.string().trim().min(2).max(40).optional()
  });

  app.put('/organization', { preHandler: [authenticate] }, async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    if (authReq.user.role !== 'startup' || !authReq.user.organizationId) return reply.status(403).send({ error: 'Only a startup can update its registration', code: 'INSUFFICIENT_ROLE_PERMISSIONS' });
    const parsed = orgUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Please check the highlighted answers', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    const d = parsed.data;
    const errors: string[] = [];
    if (d.pan && !isValidPan(d.pan.toUpperCase())) errors.push('pan: invalid PAN format');
    if (d.gstin && !isValidGstin(d.gstin.toUpperCase())) errors.push('gstin: invalid GSTIN (format or checksum)');
    if (d.cinLlpin && !isValidCinOrLlpin(d.cinLlpin.toUpperCase())) errors.push('cinLlpin: invalid CIN / LLPIN format');
    if (d.ifscCode && !isValidIfsc(d.ifscCode.toUpperCase())) errors.push('ifscCode: invalid IFSC');
    if (errors.length) return reply.status(400).send({ error: 'Please check the highlighted answers', details: errors });
    if (d.cinLlpin) {
      const dup = await db.query('SELECT 1 FROM organizations WHERE cin_llpin = $1 AND id <> $2', [d.cinLlpin.toUpperCase(), authReq.user.organizationId]);
      if (dup.rows.length) return reply.status(409).send({ error: 'Another startup is already registered with this CIN / LLPIN', code: 'CIN_EXISTS' });
    }

    const org = (await db.query('SELECT verification_status FROM organizations WHERE id = $1', [authReq.user.organizationId])).rows[0];
    const sensitive = !!(d.cinLlpin || d.pan || d.gstin || d.bankAccountNumber || d.ifscCode);
    await db.query(
      `UPDATE organizations SET
         cin_llpin = COALESCE($1, cin_llpin), pan = COALESCE($2, pan), gstin = COALESCE($3, gstin),
         bank_account_encrypted = COALESCE($4, bank_account_encrypted), bank_account_masked = COALESCE($5, bank_account_masked),
         ifsc_code = COALESCE($6, ifsc_code), website = COALESCE($7, website), founder_phone = COALESCE($8, founder_phone),
         sector = COALESCE($9, sector), stage = COALESCE($10, stage), updated_at = CURRENT_TIMESTAMP
       WHERE id = $11`,
      [d.cinLlpin ? d.cinLlpin.toUpperCase() : null, d.pan ? maskPan(d.pan.toUpperCase()) : null, d.gstin ? d.gstin.toUpperCase() : null,
       d.bankAccountNumber ? encryptField(d.bankAccountNumber) : null, d.bankAccountNumber ? maskBankAccount(d.bankAccountNumber) : null,
       d.ifscCode ? d.ifscCode.toUpperCase() : null, d.website === '' ? null : d.website ?? null, d.founderPhone ?? null,
       d.sector ?? null, d.stage ?? null, authReq.user.organizationId]
    );
    // Changing statutory or bank details on a verified startup sends it back for re-verification (protects payouts)
    let reverify = false;
    if (sensitive && org?.verification_status === 'VERIFIED') {
      reverify = true;
      await db.query(`UPDATE organizations SET verification_status = 'PENDING', verification_notes = 'Re-verification required after a change of statutory or bank details.' WHERE id = $1`, [authReq.user.organizationId]);
      await db.query(`INSERT INTO notifications (id, role, title, message, priority, action_link) VALUES ($1,'admin','Startup needs re-verification','A verified startup changed its statutory or bank details.','WARNING','/admin/users')`, [id('NTF')]);
    }
    await auditService.logEvent({
      actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'startup', action: 'ORGANIZATION_DETAILS_UPDATED',
      entityType: 'ORGANIZATION', entityId: authReq.user.organizationId, details: { fields: Object.keys(d), reverify }, ...meta(request)
    });
    return reply.send({ success: true, reverificationRequired: reverify });
  });
}
