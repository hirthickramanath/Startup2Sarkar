import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DatabaseAdapter } from '../db';
import { AuditService } from '../audit';
import { AuthenticatedRequest, createAuthMiddleware, requireRole } from '../security';

/**
 * Investor network. Deliberately small and walled off:
 *  - An investor can only reach /network/* (every other API refuses the role).
 *  - Investors see only startups that VERIFIED and OPTED IN, and only the public showcase fields.
 *  - Introductions are readable by the two sides only. There is no administrator endpoint for them.
 *  - Contact details are revealed to the other side only after the startup accepts.
 */

const https = z.string().trim().url().max(300).refine((u) => /^https:\/\//i.test(u), 'Links must start with https://');
const id = (prefix: string) => `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

const profileSchema = z.object({
  investorType: z.enum(['ANGEL', 'VENTURE_CAPITAL', 'CSR_FUNDER', 'CORPORATE', 'FAMILY_OFFICE', 'BANK_OR_NBFC', 'OTHER']).optional(),
  organisation: z.string().trim().min(2).max(120).optional(),
  website: https.optional().or(z.literal('')),
  linkedinUrl: https.optional().or(z.literal('')),
  sectors: z.array(z.string().trim().min(2).max(60)).max(8).optional()
});

const WEEKLY_INTRO_LIMIT = 10;

export async function networkRoutes(app: FastifyInstance, opts: { db: DatabaseAdapter; auditService: AuditService }) {
  const { db, auditService } = opts;
  const authenticate = createAuthMiddleware(db);
  const meta = (request: FastifyRequest) => ({ ipAddress: request.ip || '127.0.0.1', userAgent: (request.headers['user-agent'] as string) || 'Unknown' });

  const loadInvestor = async (userId: string) => (await db.query(
    `SELECT p.*, u.name, u.email FROM investor_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1`, [userId]
  )).rows[0];

  /** Verified investors only: everything that exposes other people's data goes through this check. */
  async function requireVerifiedInvestor(request: FastifyRequest, reply: FastifyReply) {
    const authReq = request as AuthenticatedRequest;
    const p = await loadInvestor(authReq.user.userId);
    if (!p) { reply.status(403).send({ error: 'Investor profile not found', code: 'INSUFFICIENT_ROLE_PERMISSIONS' }); return null; }
    if (p.verification_status !== 'VERIFIED') {
      reply.status(403).send({ error: 'The startup directory opens once an administrator verifies your investor profile.', code: 'INVESTOR_NOT_VERIFIED', verification: p.verification_status });
      return null;
    }
    return p;
  }

  // ── Investor: own profile ──
  app.get('/me', { preHandler: [authenticate, requireRole('investor')] }, async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const p = await loadInvestor(authReq.user.userId);
    if (!p) return reply.status(404).send({ error: 'Investor profile not found' });
    const links = (await db.query('SELECT kind, url FROM profile_links WHERE user_id = $1', [authReq.user.userId])).rows;
    return reply.send({
      profile: {
        name: p.name, email: p.email, investorType: p.investor_type, organisation: p.organisation, website: p.website,
        linkedinUrl: p.linkedin_url, sectors: typeof p.sectors === 'string' ? JSON.parse(p.sectors) : p.sectors,
        verificationStatus: p.verification_status, verificationNotes: p.verification_notes
      },
      links
    });
  });

  app.put('/me', { preHandler: [authenticate, requireRole('investor')] }, async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Please check the highlighted answers', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    const d = parsed.data;
    await db.query(
      `UPDATE investor_profiles SET investor_type = COALESCE($1, investor_type), organisation = COALESCE($2, organisation),
         website = CASE WHEN $3::text IS NULL THEN website WHEN $3 = '' THEN NULL ELSE $3 END,
         linkedin_url = CASE WHEN $4::text IS NULL THEN linkedin_url WHEN $4 = '' THEN NULL ELSE $4 END,
         sectors = COALESCE($5::jsonb, sectors), updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $6`,
      [d.investorType ?? null, d.organisation ?? null, d.website ?? null, d.linkedinUrl ?? null, d.sectors ? JSON.stringify(d.sectors) : null, authReq.user.userId]
    );
    return reply.send({ success: true });
  });

  // ── Investor: startup showcase ──
  app.get('/startups', { preHandler: [authenticate, requireRole('investor')] }, async (request, reply) => {
    const inv = await requireVerifiedInvestor(request, reply);
    if (!inv) return;
    const q = request.query as { sector?: string; q?: string };
    const conditions = [`o.showcase_opt_in = TRUE`, `o.verification_status = 'VERIFIED'`];
    const params: any[] = [];
    if (q.sector) { params.push(q.sector); conditions.push(`LOWER(o.sector) = LOWER($${params.length})`); }
    if (q.q) { params.push(`%${q.q.slice(0, 60).toLowerCase()}%`); conditions.push(`(LOWER(o.name) LIKE $${params.length} OR LOWER(COALESCE(o.showcase_summary,'')) LIKE $${params.length})`); }
    const rows = (await db.query(
      `SELECT o.id, o.name, o.sector, o.stage, o.website, o.showcase_summary,
              (SELECT COUNT(*) FROM pilots p WHERE p.organization_id = o.id AND p.status IN ('VALIDATED','FINANCE_PENDING','COMPLETED')) AS verified_pilots
       FROM organizations o WHERE ${conditions.join(' AND ')} ORDER BY o.name LIMIT 100`, params
    )).rows;
    const ids = rows.map((r: any) => r.id);
    const links = ids.length === 0 ? [] : (await db.query(
      `SELECT u.organization_id AS org, pl.kind, pl.url FROM profile_links pl JOIN users u ON u.id = pl.user_id
       WHERE u.organization_id = ANY($1::text[]) AND pl.kind IN ('website','pitch_deck','demo_video','github','linkedin')`, [ids]
    )).rows;
    const mine = (await db.query(`SELECT organization_id, status FROM investor_intros WHERE investor_user_id = $1`, [(request as AuthenticatedRequest).user.userId])).rows;
    return reply.send({
      startups: rows.map((r: any) => ({
        id: r.id, name: r.name, sector: r.sector, stage: r.stage, website: r.website, summary: r.showcase_summary,
        verifiedPilots: Number(r.verified_pilots),
        links: links.filter((l: any) => l.org === r.id).map((l: any) => ({ kind: l.kind, url: l.url })),
        introStatus: mine.find((m: any) => m.organization_id === r.id)?.status || null
      }))
    });
  });

  // ── Investor: request an introduction ──
  app.post('/intros', { preHandler: [authenticate, requireRole('investor')], config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const inv = await requireVerifiedInvestor(request, reply);
    if (!inv) return;
    const parsed = z.object({ organizationId: z.string().min(3).max(60), message: z.string().trim().min(20).max(1000) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Write a message of at least 20 characters explaining your interest.' });
    const org = (await db.query(`SELECT id, name FROM organizations WHERE id = $1 AND showcase_opt_in = TRUE AND verification_status = 'VERIFIED'`, [parsed.data.organizationId])).rows[0];
    if (!org) return reply.status(404).send({ error: 'That startup is not available in the directory' });
    const open = await db.query(`SELECT 1 FROM investor_intros WHERE investor_user_id = $1 AND organization_id = $2 AND status = 'PENDING'`, [authReq.user.userId, org.id]);
    if (open.rows.length) return reply.status(409).send({ error: 'You already have a pending request to this startup.', code: 'INTRO_PENDING' });
    const week = await db.query(`SELECT COUNT(*) AS c FROM investor_intros WHERE investor_user_id = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'`, [authReq.user.userId]);
    if (Number(week.rows[0].c) >= WEEKLY_INTRO_LIMIT) return reply.status(429).send({ error: `You can send up to ${WEEKLY_INTRO_LIMIT} introduction requests a week.`, code: 'INTRO_LIMIT' });

    const introId = id('INT');
    await db.query(`INSERT INTO investor_intros (id, investor_user_id, organization_id, message) VALUES ($1,$2,$3,$4)`, [introId, authReq.user.userId, org.id, parsed.data.message]);
    await db.query(
      `INSERT INTO notifications (id, user_id, title, message, priority, action_link)
       SELECT $1::text || '-' || u.id, u.id, 'An investor wants to connect', $2::text, 'INFO', '/startup/profile' FROM users u WHERE u.organization_id = $3`,
      [id('NTF'), `${inv.organisation} asked for an introduction.`, org.id]
    );
    // The audit trail records THAT it happened, never the message text.
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'investor', action: 'INVESTOR_INTRO_REQUESTED', entityType: 'ORGANIZATION', entityId: org.id, details: { introId }, ...meta(request) });
    return reply.status(201).send({ success: true, introId });
  });

  app.get('/intros', { preHandler: [authenticate, requireRole('investor')] }, async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const rows = (await db.query(
      `SELECT i.id, i.status, i.message, i.created_at, i.responded_at, o.name AS startup_name, o.founder_email, o.founder_phone
       FROM investor_intros i JOIN organizations o ON o.id = i.organization_id WHERE i.investor_user_id = $1 ORDER BY i.created_at DESC LIMIT 100`,
      [authReq.user.userId]
    )).rows;
    return reply.send({
      intros: rows.map((r: any) => ({
        id: r.id, status: r.status, message: r.message, createdAt: r.created_at, respondedAt: r.responded_at, startupName: r.startup_name,
        contact: r.status === 'ACCEPTED' ? { email: r.founder_email, phone: r.founder_phone } : null
      }))
    });
  });

  // ── Startup: showcase settings and inbox ──
  app.put('/showcase', { preHandler: [authenticate, requireRole('startup')] }, async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ optIn: z.boolean(), summary: z.string().trim().max(400).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid showcase settings' });
    if (parsed.data.optIn && (parsed.data.summary || '').length < 20) {
      return reply.status(400).send({ error: 'Write a short public summary (at least 20 characters) before appearing in the investor directory.' });
    }
    await db.query(
      `UPDATE organizations SET showcase_opt_in = $1, showcase_summary = COALESCE($2, showcase_summary), updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [parsed.data.optIn, parsed.data.summary ?? null, authReq.user.organizationId]
    );
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'startup', action: parsed.data.optIn ? 'SHOWCASE_OPT_IN' : 'SHOWCASE_OPT_OUT', entityType: 'ORGANIZATION', entityId: authReq.user.organizationId || 'n/a', ...meta(request) });
    return reply.send({ success: true });
  });

  app.get('/incoming', { preHandler: [authenticate, requireRole('startup')] }, async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const rows = (await db.query(
      `SELECT i.id, i.status, i.message, i.created_at, p.organisation, p.investor_type, p.website, p.linkedin_url, u.name AS investor_name, u.email AS investor_email
       FROM investor_intros i
       JOIN users u ON u.id = i.investor_user_id
       JOIN investor_profiles p ON p.user_id = i.investor_user_id
       WHERE i.organization_id = $1 ORDER BY i.created_at DESC LIMIT 100`, [authReq.user.organizationId]
    )).rows;
    return reply.send({
      intros: rows.map((r: any) => ({
        id: r.id, status: r.status, message: r.message, createdAt: r.created_at, organisation: r.organisation, investorType: r.investor_type,
        website: r.website, linkedinUrl: r.linkedin_url, investorName: r.investor_name,
        investorEmail: r.status === 'ACCEPTED' ? r.investor_email : null
      }))
    });
  });

  app.post('/incoming/:id/respond', { preHandler: [authenticate, requireRole('startup')] }, async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ accept: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Say whether you accept or decline' });
    const intro = (await db.query('SELECT id, status, investor_user_id FROM investor_intros WHERE id = $1 AND organization_id = $2', [(request.params as any).id, authReq.user.organizationId])).rows[0];
    if (!intro) return reply.status(404).send({ error: 'Request not found' });
    if (intro.status !== 'PENDING') return reply.status(409).send({ error: 'You already responded to this request' });
    await db.query(`UPDATE investor_intros SET status = $1, responded_at = CURRENT_TIMESTAMP WHERE id = $2`, [parsed.data.accept ? 'ACCEPTED' : 'DECLINED', intro.id]);
    await db.query(
      `INSERT INTO notifications (id, user_id, title, message, priority, action_link) VALUES ($1,$2,$3,$4,'INFO','/investor/intros')`,
      [id('NTF'), intro.investor_user_id, parsed.data.accept ? 'Introduction accepted' : 'Introduction declined', parsed.data.accept ? 'A startup accepted. Their contact details are now visible.' : 'A startup declined your request.']
    );
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'startup', action: parsed.data.accept ? 'INVESTOR_INTRO_ACCEPTED' : 'INVESTOR_INTRO_DECLINED', entityType: 'ORGANIZATION', entityId: authReq.user.organizationId || 'n/a', details: { introId: intro.id }, ...meta(request) });
    return reply.send({ success: true });
  });
}
