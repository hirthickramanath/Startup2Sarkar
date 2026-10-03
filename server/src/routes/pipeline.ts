import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DatabaseAdapter } from '../db';
import { AuditService } from '../audit';
import { AuthenticatedRequest, createAuthMiddleware, requireRole } from '../security';

/** Scale-up recommendations after a pilot, and appeals against a rejected proposal. */
export async function pipelineRoutes(app: FastifyInstance, opts: { db: DatabaseAdapter; auditService: AuditService }) {
  const { db, auditService } = opts;
  const authenticate = createAuthMiddleware(db);
  const meta = (r: FastifyRequest) => ({ ipAddress: r.ip || '127.0.0.1', userAgent: (r.headers['user-agent'] as string) || 'Unknown' });
  const newId = (p: string) => `${p}-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const notifyOrg = (orgId: string, key: string, title: string, message: string, link: string) => db.query(
    `INSERT INTO notifications (id, user_id, title, message, priority, action_link) SELECT 'NTF-' || $1::text || '-' || u.id, u.id, $2::text, $3::text, 'INFO', $4::text FROM users u WHERE u.organization_id = $5`, [key, title, message, link, orgId]);
  const notifyDept = (deptId: string, key: string, title: string, message: string, link: string) => db.query(
    `INSERT INTO notifications (id, user_id, title, message, priority, action_link) SELECT 'NTF-' || $1::text || '-' || u.id, u.id, $2::text, $3::text, 'INFO', $4::text FROM users u WHERE u.role = 'government' AND u.department_id = $5`, [key, title, message, link, deptId]);

  // ───────────── Scale-up ─────────────
  const scaleView = (r: any) => ({ id: r.id, pilotId: r.pilot_id, pilotName: r.pilot_name, startupName: r.startup_name, department: r.department_name, status: r.status, rationale: r.rationale, proposedValuePaise: String(r.proposed_value_paise), decisionNote: r.decision_note, createdAt: r.created_at, decidedAt: r.decided_at, recommendedBy: r.recommended_by_user_id });

  app.post('/scaleup', { preHandler: [authenticate, requireRole('government', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ pilotId: z.string().min(3), rationale: z.string().trim().min(30).max(2000), proposedValuePaise: z.number().int().min(0).max(100000000000).default(0) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Name the pilot and explain, in at least 30 characters, why it should scale up.' });
    const pilot = (await db.query('SELECT id, name, status, department_id, organization_id FROM pilots WHERE id = $1', [parsed.data.pilotId])).rows[0];
    if (!pilot) return reply.status(404).send({ error: 'Pilot not found' });
    if (authReq.user.role === 'government' && authReq.user.departmentId && pilot.department_id !== authReq.user.departmentId) return reply.status(403).send({ error: 'Forbidden: this pilot belongs to another department' });
    if (!['VALIDATED', 'COMPLETED', 'FINANCE_PENDING'].includes(pilot.status)) return reply.status(409).send({ error: `A scale-up can be recommended only after a pilot is validated (this one is ${pilot.status}).` });
    if ((await db.query('SELECT 1 FROM scaleup_plans WHERE pilot_id = $1', [pilot.id])).rows.length) return reply.status(409).send({ error: 'A scale-up was already recommended for this pilot.' });
    const id = newId('SCL');
    await db.query(`INSERT INTO scaleup_plans (id, pilot_id, organization_id, department_id, rationale, proposed_value_paise, recommended_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, pilot.id, pilot.organization_id, pilot.department_id, parsed.data.rationale, parsed.data.proposedValuePaise, authReq.user.userId]);
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'SCALEUP_RECOMMENDED', entityType: 'PILOT', entityId: pilot.id, details: { planId: id, proposedValuePaise: String(parsed.data.proposedValuePaise) }, ...meta(request) });
    return reply.status(201).send({ success: true, id });
  });

  app.get('/scaleup', { preHandler: [authenticate, requireRole('government', 'admin', 'startup')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const where: string[] = []; const params: any[] = [];
    if (authReq.user.role === 'startup') { where.push(`s.organization_id = $${params.length + 1}`); params.push(authReq.user.organizationId); }
    if (authReq.user.role === 'government' && authReq.user.departmentId) { where.push(`s.department_id = $${params.length + 1}`); params.push(authReq.user.departmentId); }
    const rows = (await db.query(`SELECT s.*, p.name AS pilot_name, o.name AS startup_name, d.name AS department_name FROM scaleup_plans s JOIN pilots p ON p.id = s.pilot_id JOIN organizations o ON o.id = s.organization_id JOIN departments d ON d.id = s.department_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.created_at DESC`, params)).rows;
    return reply.send({ plans: rows.map(scaleView) });
  });

  app.post('/scaleup/:id/decide', { preHandler: [authenticate, requireRole('government', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ decision: z.enum(['APPROVED', 'DECLINED']), note: z.string().trim().min(10).max(1000) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Approve or decline, with a note of at least 10 characters.' });
    const plan = (await db.query('SELECT * FROM scaleup_plans WHERE id = $1', [(request.params as any).id])).rows[0];
    if (!plan) return reply.status(404).send({ error: 'Scale-up recommendation not found' });
    if (authReq.user.role === 'government' && authReq.user.departmentId && plan.department_id !== authReq.user.departmentId) return reply.status(403).send({ error: 'Forbidden: this belongs to another department' });
    if (plan.recommended_by_user_id === authReq.user.userId) return reply.status(403).send({ error: 'Two-person rule: someone other than the person who recommended it must decide.', code: 'TWO_PERSON_RULE' });
    if (plan.status !== 'RECOMMENDED') return reply.status(409).send({ error: 'This recommendation has already been decided.' });
    await db.query(`UPDATE scaleup_plans SET status = $1, decision_note = $2, decided_by_user_id = $3, decided_at = CURRENT_TIMESTAMP WHERE id = $4`, [parsed.data.decision, parsed.data.note, authReq.user.userId, plan.id]);
    await notifyOrg(plan.organization_id, plan.id, parsed.data.decision === 'APPROVED' ? 'Scale-up approved' : 'Scale-up not approved', parsed.data.note.slice(0, 160), '/startup/proposals');
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: `SCALEUP_${parsed.data.decision}`, entityType: 'PILOT', entityId: plan.pilot_id, details: { planId: plan.id }, ...meta(request) });
    return reply.send({ success: true });
  });

  // ───────────── Appeals ─────────────
  const appealView = (r: any) => ({ id: r.id, proposalId: r.proposal_id, solutionTitle: r.solution_title, startupName: r.startup_name, challengeTitle: r.challenge_title, reason: r.reason, status: r.status, decisionNote: r.decision_note, createdAt: r.created_at, decidedAt: r.decided_at });

  app.post('/appeals', { preHandler: [authenticate, requireRole('startup')], config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ proposalId: z.string().min(3), reason: z.string().trim().min(30).max(1500) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Explain your appeal in at least 30 characters.' });
    const p = (await db.query(`SELECT id, status, organization_id, challenge_id, (CURRENT_TIMESTAMP - updated_at) < INTERVAL '15 days' AS recent FROM proposals WHERE id = $1`, [parsed.data.proposalId])).rows[0];
    if (!p || p.organization_id !== authReq.user.organizationId) return reply.status(404).send({ error: 'Proposal not found' });
    if (!['NOT_SHORTLISTED', 'REJECTED'].includes(p.status)) return reply.status(409).send({ error: 'Only a proposal that was not shortlisted or was rejected can be appealed.' });
    if (!p.recent) return reply.status(409).send({ error: 'The 15-day window to appeal this decision has closed.', code: 'APPEAL_WINDOW_CLOSED' });
    if ((await db.query('SELECT 1 FROM proposal_appeals WHERE proposal_id = $1', [p.id])).rows.length) return reply.status(409).send({ error: 'This proposal has already been appealed. Each decision can be appealed once.' });
    const id = newId('APL');
    await db.query('INSERT INTO proposal_appeals (id, proposal_id, organization_id, reason) VALUES ($1,$2,$3,$4)', [id, p.id, p.organization_id, parsed.data.reason]);
    await db.query(`INSERT INTO notifications (id, role, title, message, priority, action_link) VALUES ($1,'admin','New appeal','A startup appealed a proposal decision and is waiting for review.','WARNING','/admin/appeals')`, [`NTF-${id}`]);
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'startup', action: 'APPEAL_FILED', entityType: 'PROPOSAL', entityId: p.id, details: { appealId: id }, ...meta(request) });
    return reply.status(201).send({ success: true, id });
  });

  app.get('/appeals', { preHandler: [authenticate, requireRole('startup', 'admin', 'government')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const where: string[] = []; const params: any[] = [];
    if (authReq.user.role === 'startup') { where.push(`a.organization_id = $${params.length + 1}`); params.push(authReq.user.organizationId); }
    if (authReq.user.role === 'government' && authReq.user.departmentId) { where.push(`c.department_id = $${params.length + 1}`); params.push(authReq.user.departmentId); }
    const rows = (await db.query(`SELECT a.*, p.solution_title, p.startup_name, c.title AS challenge_title FROM proposal_appeals a JOIN proposals p ON p.id = a.proposal_id JOIN challenges c ON c.id = p.challenge_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC`, params)).rows;
    return reply.send({ appeals: rows.map(appealView) });
  });

  app.post('/appeals/:id/decide', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ decision: z.enum(['UPHELD', 'DISMISSED']), note: z.string().trim().min(10).max(1000) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Uphold or dismiss the appeal, with a note of at least 10 characters.' });
    const a = (await db.query(`SELECT a.*, c.department_id FROM proposal_appeals a JOIN proposals p ON p.id = a.proposal_id JOIN challenges c ON c.id = p.challenge_id WHERE a.id = $1`, [(request.params as any).id])).rows[0];
    if (!a) return reply.status(404).send({ error: 'Appeal not found' });
    if (a.status !== 'OPEN') return reply.status(409).send({ error: 'This appeal was already decided.' });
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE proposal_appeals SET status = $1, decision_note = $2, decided_by_user_id = $3, decided_at = CURRENT_TIMESTAMP WHERE id = $4`, [parsed.data.decision, parsed.data.note, authReq.user.userId, a.id]);
      // An upheld appeal returns the proposal to review so the department must look at it again
      if (parsed.data.decision === 'UPHELD') await tx.query(`UPDATE proposals SET status = 'UNDER_REVIEW', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [a.proposal_id]);
    });
    await notifyOrg(a.organization_id, a.id, parsed.data.decision === 'UPHELD' ? 'Appeal upheld' : 'Appeal dismissed', parsed.data.note.slice(0, 160), '/startup/proposals');
    if (parsed.data.decision === 'UPHELD') await notifyDept(a.department_id, a.id, 'Appeal upheld: proposal back in review', 'An administrator upheld an appeal. Please review the proposal again.', '/government/proposals');
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'admin', action: `APPEAL_${parsed.data.decision}`, entityType: 'PROPOSAL', entityId: a.proposal_id, details: { appealId: a.id }, ...meta(request) });
    return reply.send({ success: true });
  });
}
