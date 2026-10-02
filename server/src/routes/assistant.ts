import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DatabaseAdapter, getSetting } from '../db';
import { AuditService } from '../audit';
import { AiProvider, AssistantFacts, formatInr } from '../ai';
import { AuthenticatedRequest, createAuthMiddleware, sha256 } from '../security';
import { loadTaxSettings } from '../tax';
import { getMarketSnapshot } from '../market';

const chatSchema = z.object({
  message: z.string().min(1).max(1500),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) })).max(12).optional(),
  page: z.object({
    route: z.string().max(200).optional(),
    entityType: z.enum(['payment', 'pilot', 'challenge']).optional(),
    entityId: z.string().max(80).optional()
  }).optional()
});

const n = (v: any) => Number(v ?? 0);

/** Builds the role-scoped facts the assistant is allowed to talk about. Nothing outside this object is ever sent to a model. */
export async function buildAssistantFacts(
  db: DatabaseAdapter,
  user: AuthenticatedRequest['user'],
  page?: z.infer<typeof chatSchema>['page']
): Promise<AssistantFacts> {
  const tax = await loadTaxSettings(db);
  const market = await getMarketSnapshot();
  const facts: AssistantFacts = {
    role: user.role,
    userName: user.name,
    organization: null,
    page: { route: page?.route, entity: null },
    counts: {},
    lists: {},
    money: {},
    settings: {
      tdsRateBps: tax.tdsRateBps,
      gstTdsRateBps: tax.gstTdsRateBps,
      gstTdsThresholdRupees: Number(tax.gstTdsThresholdPaise / 100n)
    },
    market
  };
  const { counts, lists, money } = facts;
  const dept = user.departmentId || null;
  const org = user.organizationId || null;

  const one = async (sql: string, params: any[] = []) => (await db.query(sql, params)).rows[0] || {};
  const many = async (sql: string, params: any[] = []) => (await db.query(sql, params)).rows;

  if (user.role === 'government') {
    const dFilter = dept ? 'WHERE department_id = $1' : '';
    const dp = dept ? [dept] : [];
    const ch = await one(`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE status='DRAFT') draft, COUNT(*) FILTER (WHERE status<>'DRAFT') published FROM challenges ${dFilter}`, dp);
    counts.challenges_total = n(ch.total); counts.challenges_draft = n(ch.draft); counts.challenges_published = n(ch.published);
    lists.challenges = (await many(`SELECT id, title, status FROM challenges ${dFilter} ORDER BY created_at DESC LIMIT 5`, dp)).map((r) => ({ id: r.id, title: String(r.title).slice(0, 60), status: r.status }));
    const pr = await one(`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE p.status IN ('SUBMITTED','UNDER_REVIEW','AI_EVALUATED')) awaiting FROM proposals p JOIN challenges c ON c.id=p.challenge_id ${dept ? 'WHERE c.department_id=$1' : ''}`, dp);
    counts.proposals_total = n(pr.total); counts.proposals_awaiting_review = n(pr.awaiting);
    lists.proposals = (await many(`SELECT p.id, p.startup_name, p.status FROM proposals p JOIN challenges c ON c.id=p.challenge_id ${dept ? 'WHERE c.department_id=$1' : ''} ORDER BY p.created_at DESC LIMIT 5`, dp)).map((r) => ({ id: r.id, startup: r.startup_name, status: r.status }));
    const pl = await one(`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE status='UNDER_INSPECTION') insp, COUNT(*) FILTER (WHERE status='FINANCE_PENDING') fin, COUNT(*) FILTER (WHERE status='STALLED') stalled FROM pilots ${dFilter}`, dp);
    counts.pilots_total = n(pl.total); counts.pilots_under_inspection = n(pl.insp); counts.pilots_finance_pending = n(pl.fin); counts.pilots_stalled = n(pl.stalled);
    lists.pilots = (await many(`SELECT id, name, status FROM pilots ${dFilter} ORDER BY created_at DESC LIMIT 5`, dp)).map((r) => ({ id: r.id, name: String(r.name).slice(0, 50), status: r.status }));
    lists.budgets = (await many(`SELECT name, budget_allocated_paise a, budget_committed_paise c, budget_disbursed_paise d FROM departments ${dept ? 'WHERE id=$1' : ''} ORDER BY name LIMIT 6`, dp))
      .map((r) => ({ department: r.name, allocated: formatInr(r.a), committed: formatInr(r.c), available: formatInr(BigInt(r.a) - BigInt(r.c) - BigInt(r.d)) }));
  }

  if (user.role === 'startup') {
    if (org) {
      const o = await one('SELECT name, verification_status FROM organizations WHERE id = $1', [org]);
      if (o.name) facts.organization = { name: o.name, verification: o.verification_status };
    }
    const open = await one(`SELECT COUNT(*) c FROM challenges WHERE status IN ('PUBLISHED','PROPOSALS_RECEIVED') AND deadline > CURRENT_TIMESTAMP`);
    counts.challenges_open = n(open.c);
    lists.challenges = (await many(`SELECT id, title, department_name FROM challenges WHERE status IN ('PUBLISHED','PROPOSALS_RECEIVED') AND deadline > CURRENT_TIMESTAMP ORDER BY deadline ASC LIMIT 5`))
      .map((r) => ({ id: r.id, title: String(r.title).slice(0, 60), department: r.department_name }));
    if (org) {
      const pr = await one(`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE status='DRAFT') draft FROM proposals WHERE organization_id=$1`, [org]);
      counts.proposals_total = n(pr.total); counts.proposals_draft = n(pr.draft);
      lists.proposals = (await many(`SELECT id, solution_title, status FROM proposals WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 5`, [org])).map((r) => ({ id: r.id, title: String(r.solution_title).slice(0, 50), status: r.status }));
      const pl = await one('SELECT COUNT(*) c FROM pilots WHERE organization_id=$1', [org]);
      counts.pilots_total = n(pl.c);
      lists.pilots = (await many(`SELECT id, name, status FROM pilots WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 5`, [org])).map((r) => ({ id: r.id, name: String(r.name).slice(0, 50), status: r.status }));
      const cl = await one(`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE status='ON_HOLD') hold, COALESCE(SUM(net_payable_paise) FILTER (WHERE status='PAID'),0) paid FROM finance_payment_claims WHERE organization_id=$1`, [org]);
      counts.claims_total = n(cl.total); counts.claims_on_hold = n(cl.hold); money.claims_paid_net = formatInr(cl.paid);
      lists.claims = (await many(`SELECT id, status, net_payable_paise FROM finance_payment_claims WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 5`, [org])).map((r) => ({ id: r.id, status: r.status, net: formatInr(r.net_payable_paise) }));
    }
  }

  if (user.role === 'inspector') {
    const pl = await many(`SELECT id, name, status FROM pilots WHERE assigned_inspector_id=$1 ORDER BY created_at DESC LIMIT 8`, [user.userId]);
    const total = await one('SELECT COUNT(*) c FROM pilots WHERE assigned_inspector_id=$1', [user.userId]);
    counts.pilots_assigned = n(total.c); counts.pilots_total = n(total.c);
    lists.pilots = pl.map((r) => ({ id: r.id, name: String(r.name).slice(0, 50), status: r.status }));
    const kp = await one(`SELECT COUNT(*) c FROM kpi_submissions k JOIN pilots p ON p.id=k.pilot_id WHERE p.assigned_inspector_id=$1 AND k.verification_status='PENDING'`, [user.userId]);
    counts.kpis_unverified = n(kp.c);
  }

  if (user.role === 'finance' || user.role === 'admin') {
    const cl = await one(`SELECT COUNT(*) total,
        COUNT(*) FILTER (WHERE status IN ('SUBMITTED','UNDER_REVIEW','VERIFICATION_PENDING','FINANCE_REVIEW')) pending,
        COALESCE(SUM(net_payable_paise) FILTER (WHERE status IN ('SUBMITTED','UNDER_REVIEW','VERIFICATION_PENDING','FINANCE_REVIEW')),0) pending_net,
        COALESCE(SUM(net_payable_paise) FILTER (WHERE status='PAID'),0) paid
       FROM finance_payment_claims`);
    counts.claims_total = n(cl.total); counts.claims_pending = n(cl.pending);
    money.claims_pending_net = formatInr(cl.pending_net); money.claims_paid_net = formatInr(cl.paid);
    lists.claims = (await many(`SELECT id, status, net_payable_paise FROM finance_payment_claims ORDER BY created_at DESC LIMIT 5`)).map((r) => ({ id: r.id, status: r.status, net: formatInr(r.net_payable_paise) }));
    const an = await one(`SELECT COUNT(*) c FROM finance_anomalies WHERE status IN ('DETECTED','INVESTIGATING')`);
    counts.anomalies_open = n(an.c);
    lists.anomalies = (await many(`SELECT id, anomaly_type, severity FROM finance_anomalies WHERE status IN ('DETECTED','INVESTIGATING') ORDER BY created_at DESC LIMIT 5`)).map((r) => ({ id: r.id, type: r.anomaly_type, severity: r.severity }));
    const st = await one(`SELECT COUNT(*) c FROM stalled_pilots WHERE status <> 'RESOLVED'`);
    counts.pilots_stalled = n(st.c);
    lists.budgets = (await many(`SELECT name, budget_allocated_paise a, budget_committed_paise c, budget_disbursed_paise d FROM departments ORDER BY name LIMIT 8`))
      .map((r) => ({ department: r.name, allocated: formatInr(r.a), committed: formatInr(r.c), disbursed: formatInr(r.d), available: formatInr(BigInt(r.a) - BigInt(r.c) - BigInt(r.d)) }));
  }

  if (user.role === 'admin') {
    const us = await one(`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE is_active=FALSE) inactive FROM users`);
    counts.users_total = n(us.total); counts.users_inactive = n(us.inactive);
    const sp = await many(`SELECT id, name, sector FROM organizations WHERE verification_status='PENDING' ORDER BY created_at DESC LIMIT 5`);
    counts.startups_pending = n((await one(`SELECT COUNT(*) c FROM organizations WHERE verification_status='PENDING'`)).c);
    lists.startups_pending = sp.map((r) => ({ id: r.id, name: r.name, sector: r.sector }));
    counts.challenges_total = n((await one('SELECT COUNT(*) c FROM challenges')).c);
    counts.pilots_total = n((await one('SELECT COUNT(*) c FROM pilots')).c);
    counts.audit_entries = n((await one('SELECT COUNT(*) c FROM audit_logs')).c);
  }

  // Page-aware entity context — each lookup re-checks the caller's authority (no IDOR through the assistant)
  if (page?.entityType && page.entityId) {
    if (page.entityType === 'payment' && ['finance', 'admin', 'startup'].includes(user.role)) {
      const r = await one(`SELECT id, status, invoice_number, gross_amount_paise g, tds_paise t, gst_paise gs, penalty_deduction_paise pn, net_payable_paise np, hold_reason, organization_id FROM finance_payment_claims WHERE id=$1`, [page.entityId]);
      if (r.id && (user.role !== 'startup' || r.organization_id === org)) {
        facts.page!.entity = { id: r.id, status: r.status, invoice_number: r.invoice_number, gross: formatInr(r.g), tds: formatInr(r.t), gst_tds: formatInr(r.gs), penalty: formatInr(r.pn), net_payable: formatInr(r.np), hold_reason: r.hold_reason || '' };
      }
    } else if (page.entityType === 'pilot') {
      const r = await one(`SELECT id, name, status, department_id, organization_id, assigned_inspector_id, contract_value_paise cv, location FROM pilots WHERE id=$1`, [page.entityId]);
      const allowed = r.id && (user.role === 'admin' || user.role === 'finance' ||
        (user.role === 'government' && (!dept || r.department_id === dept)) ||
        (user.role === 'startup' && r.organization_id === org) ||
        (user.role === 'inspector' && r.assigned_inspector_id === user.userId));
      if (allowed) facts.page!.entity = { id: r.id, name: r.name, status: r.status, location: r.location, contract_value: formatInr(r.cv) };
    } else if (page.entityType === 'challenge') {
      const r = await one(`SELECT id, title, status, department_name, budget_paise b, deadline FROM challenges WHERE id=$1`, [page.entityId]);
      if (r.id && (user.role !== 'startup' || ['PUBLISHED', 'PROPOSALS_RECEIVED'].includes(r.status))) {
        facts.page!.entity = { id: r.id, title: r.title, status: r.status, department: r.department_name, budget: formatInr(r.b), deadline: String(r.deadline).slice(0, 10) };
      }
    }
  }
  return facts;
}

export async function assistantRoutes(
  app: FastifyInstance,
  opts: { db: DatabaseAdapter; auditService: AuditService; aiProvider: AiProvider & { llmConfigured?: boolean; modelLabel?: string } }
) {
  const { db, aiProvider } = opts;
  const authenticate = createAuthMiddleware(db);

  app.get('/status', { preHandler: [authenticate] }, async (_req, reply) => {
    const enabled = await getSetting<boolean>(db, 'ai.assistant.enabled', true);
    return reply.send({ enabled, mode: aiProvider.llmConfigured && enabled ? 'llm' : 'local', model: aiProvider.llmConfigured && enabled ? aiProvider.modelLabel : 'S2S Local Advisory Engine' });
  });

  app.post('/chat', { preHandler: [authenticate], config: { rateLimit: { max: 25, timeWindow: '1 minute' } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid message', details: parsed.error.format() });
    const { message, history, page } = parsed.data;

    const llmEnabled = await getSetting<boolean>(db, 'ai.assistant.enabled', true);
    const facts = await buildAssistantFacts(db, authReq.user, page);
    const started = Date.now();
    const result = await aiProvider.chat({
      user: { id: authReq.user.userId, name: authReq.user.name, role: authReq.user.role },
      message,
      history: history ?? [],
      facts,
      llmEnabled
    });

    // AI audit log — store a hash of the question (data minimisation), never the raw text
    await db.query(
      `INSERT INTO ai_audit_logs (id, user_id, feature, model_name, prompt_version, input_ref, tokens_used, raw_output)
       VALUES ($1, $2, 'assistant.chat', $3, $4, $5, $6, $7)`,
      [`AIA-${Date.now()}-${Math.floor(Math.random() * 10000)}`, authReq.user.userId, result.model, `${result.mode}${result.degraded ? '-degraded' : ''}`,
       `q:${sha256(message).slice(0, 16)}`, result.tokens, JSON.stringify({ ms: Date.now() - started, chars: result.reply.length })]
    ).catch(() => undefined);

    return reply.send({ reply: result.reply, suggestions: result.suggestions.slice(0, 4), basis: result.basis, model: result.model, mode: result.mode, degraded: !!result.degraded });
  });
}
