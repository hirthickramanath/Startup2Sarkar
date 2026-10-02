import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DatabaseAdapter, getSetting } from '../db';
import { AuditService } from '../audit';
import { AiProvider } from '../ai';
import { AuthenticatedRequest, createAuthMiddleware, requireRole } from '../security';

const createChallengeSchema = z.object({
  title: z.string().min(5),
  departmentId: z.string(),
  problemStatement: z.string().min(20),
  problemCategory: z.string().min(2),
  targetBeneficiaries: z.string().optional(),
  desiredOutcome: z.string().min(10),
  requiredCapabilities: z.array(z.string()).default([]),
  constraints: z.string().optional(),
  pilotDurationMonths: z.number().int().min(1).max(24).default(3),
  budgetPaise: z.number().int().min(0).default(0),
  kpis: z.array(z.object({
    name: z.string(),
    baseline: z.string(),
    target: z.string(),
    unit: z.string().optional(),
    measurementMethod: z.string().optional()
  })).default([]),
  evaluationCriteria: z.array(z.object({
    criterion: z.string(),
    weight: z.number()
  })).default([]),
  requiredDocuments: z.array(z.string()).default([]),
  riskConsiderations: z.array(z.object({
    risk: z.string(),
    severity: z.string(),
    mitigation: z.string()
  })).default([]),
  deadline: z.string()
});

export async function challengeRoutes(
  app: FastifyInstance,
  opts: { db: DatabaseAdapter; auditService: AuditService; aiProvider: AiProvider }
) {
  const { db, auditService, aiProvider } = opts;
  const authenticate = createAuthMiddleware(db);

  // 1. AI Challenge Generation Assistant (Spec Section 7)
  app.post('/ai-generate', { preHandler: [authenticate, requireRole('government', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { problemDescription } = request.body as { problemDescription: string };
    if (!problemDescription || problemDescription.trim().length < 10) {
      return reply.status(400).send({ error: 'Please describe the operational problem in at least 10 characters.' });
    }

    if (!(await getSetting<boolean>(db, 'ai.challenge_draft.enabled', true))) {
      return reply.status(403).send({ error: 'AI challenge drafting has been disabled by the administrator. Fill the fields manually.', code: 'AI_DISABLED' });
    }
    const generated = await aiProvider.generateChallenge(problemDescription);

    const authReq = request as AuthenticatedRequest;
    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: authReq.user.role,
      action: 'AI_CHALLENGE_GENERATION_INVOKED',
      entityType: 'AI_SERVICE',
      entityId: 'challenge-creator',
      details: { promptSummary: problemDescription.slice(0, 80) },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.send({ challenge: generated });
  });

  // 2. Create Challenge (Draft)
  app.post('/', { preHandler: [authenticate, requireRole('government', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = createChallengeSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const data = parseResult.data;
    const authReq = request as AuthenticatedRequest;

    // Verify department exists
    const deptRes = await db.query('SELECT name FROM departments WHERE id = $1', [data.departmentId]);
    if (deptRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Specified Department not found' });
    }
    const deptName = deptRes.rows[0].name;

    const challengeId = `CH-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;

    await db.query(
      `INSERT INTO challenges (
        id, title, department_id, department_name, problem_statement, problem_category,
        target_beneficiaries, desired_outcome, required_capabilities, constraints,
        pilot_duration_months, budget_paise, kpis, evaluation_criteria, required_documents,
        risk_considerations, deadline, status, created_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'DRAFT', $18)`,
      [
        challengeId,
        data.title,
        data.departmentId,
        deptName,
        data.problemStatement,
        data.problemCategory,
        data.targetBeneficiaries || null,
        data.desiredOutcome,
        JSON.stringify(data.requiredCapabilities),
        data.constraints || null,
        data.pilotDurationMonths,
        data.budgetPaise,
        JSON.stringify(data.kpis),
        JSON.stringify(data.evaluationCriteria),
        JSON.stringify(data.requiredDocuments),
        JSON.stringify(data.riskConsiderations),
        new Date(data.deadline).toISOString(),
        authReq.user.userId
      ]
    );

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: authReq.user.role,
      action: 'CHALLENGE_CREATED_DRAFT',
      entityType: 'CHALLENGE',
      entityId: challengeId,
      details: { title: data.title, departmentId: data.departmentId },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.status(201).send({
      success: true,
      challengeId,
      message: 'Challenge draft saved successfully.'
    });
  });

  // 3. List Challenges with server-side filters, search, and pagination
  app.get('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const query = request.query as any;

    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '10', 10)));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Drafts are private to the owning department (and admins). Everyone else only sees published-onward challenges.
    if (authReq.user.role === 'government' && authReq.user.departmentId) {
      conditions.push(`(status <> 'DRAFT' OR department_id = $${paramIndex++})`);
      params.push(authReq.user.departmentId);
    } else if (authReq.user.role !== 'admin' && authReq.user.role !== 'government') {
      conditions.push(`status <> 'DRAFT'`);
    }

    if (query.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(query.status);
    }

    if (query.departmentId) {
      conditions.push(`department_id = $${paramIndex++}`);
      params.push(query.departmentId);
    }

    if (query.category) {
      conditions.push(`problem_category = $${paramIndex++}`);
      params.push(query.category);
    }

    if (query.search) {
      conditions.push(`(title ILIKE $${paramIndex} OR problem_statement ILIKE $${paramIndex} OR id ILIKE $${paramIndex})`);
      params.push(`%${query.search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await db.query(`SELECT COUNT(*) as total FROM challenges ${whereClause}`, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    const listQuery = `
      SELECT c.*,
             (SELECT COUNT(*) FROM proposals p WHERE p.challenge_id = c.id) as proposal_count
      FROM challenges c
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    params.push(limit, offset);

    const challengesRes = await db.query(listQuery, params);

    return reply.send({
      data: challengesRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  });

  // 4. Challenge Detail View
  app.get('/:id', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const res = await db.query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM proposals p WHERE p.challenge_id = c.id) as proposal_count
       FROM challenges c
       WHERE c.id = $1`,
      [id]
    );

    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'Challenge not found' });
    }
    const ch = res.rows[0];
    const u = (request as AuthenticatedRequest).user;
    const isDraftLike = ['DRAFT'].includes(ch.status);
    const ownDept = u.role === 'admin' || (u.role === 'government' && (!u.departmentId || u.departmentId === ch.department_id));
    if (isDraftLike && !ownDept) return reply.status(404).send({ error: 'Challenge not found' });

    return reply.send({ challenge: ch });
  });

  // 5. Publish Challenge (Explicit Confirmation Required)
  app.post('/:id/publish', { preHandler: [authenticate, requireRole('government', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;

    const existing = await db.query('SELECT status, title FROM challenges WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return reply.status(404).send({ error: 'Challenge not found' });
    }

    if (existing.rows[0].status !== 'DRAFT') {
      return reply.status(400).send({ error: `Cannot publish challenge in status ${existing.rows[0].status}` });
    }

    await db.query(`UPDATE challenges SET status = 'PUBLISHED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: authReq.user.role,
      action: 'CHALLENGE_PUBLISHED',
      entityType: 'CHALLENGE',
      entityId: id,
      details: { title: existing.rows[0].title },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.send({ success: true, message: 'Innovation challenge successfully published to the startup ecosystem.' });
  });

  // Close a challenge to new proposals (government of the owning department, or admin)
  // Extend the deadline of a live challenge
  app.post('/:id/extend-deadline', { preHandler: [authenticate, requireRole('government', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ deadline: z.string().refine((d) => !Number.isNaN(Date.parse(d)), 'Invalid date'), reason: z.string().trim().min(10).max(500) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Give a new date and a reason of at least 10 characters.' });
    const ch = (await db.query('SELECT id, status, department_id, deadline FROM challenges WHERE id = $1', [id])).rows[0];
    if (!ch) return reply.status(404).send({ error: 'Challenge not found' });
    if (authReq.user.role === 'government' && authReq.user.departmentId && ch.department_id !== authReq.user.departmentId) return reply.status(403).send({ error: 'Forbidden: this challenge belongs to another department' });
    if (!['PUBLISHED', 'PROPOSALS_RECEIVED'].includes(ch.status)) return reply.status(409).send({ error: `The deadline of a challenge in status '${ch.status}' cannot be extended.` });
    const next = new Date(parsed.data.deadline);
    if (next.getTime() <= Date.now() || next.getTime() <= new Date(ch.deadline).getTime()) return reply.status(400).send({ error: 'The new deadline must be in the future and later than the current one.' });
    await db.query('UPDATE challenges SET deadline = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [next.toISOString(), id]);
    await db.query(`INSERT INTO challenge_addenda (id, challenge_id, title, body, created_by_user_id) VALUES ($1,$2,'Deadline extended',$3,$4)`, [`ADD-${Date.now()}-${Math.floor(Math.random() * 1000)}`, id, `The deadline is now ${next.toISOString().slice(0, 10)}. ${parsed.data.reason}`, authReq.user.userId]);
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'CHALLENGE_DEADLINE_EXTENDED', entityType: 'CHALLENGE', entityId: id, details: { newDeadline: next.toISOString(), reason: parsed.data.reason }, ipAddress: request.ip || '127.0.0.1', userAgent: request.headers['user-agent'] || 'Unknown' });
    return reply.send({ success: true });
  });

  // Addenda: official clarifications every bidder can read
  app.post('/:id/addenda', { preHandler: [authenticate, requireRole('government', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(10).max(2000) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Add a title and a message of at least 10 characters.' });
    const ch = (await db.query('SELECT id, status, department_id FROM challenges WHERE id = $1', [id])).rows[0];
    if (!ch) return reply.status(404).send({ error: 'Challenge not found' });
    if (authReq.user.role === 'government' && authReq.user.departmentId && ch.department_id !== authReq.user.departmentId) return reply.status(403).send({ error: 'Forbidden: this challenge belongs to another department' });
    if (ch.status === 'DRAFT') return reply.status(409).send({ error: 'Publish the challenge before posting addenda.' });
    const addId = `ADD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await db.query('INSERT INTO challenge_addenda (id, challenge_id, title, body, created_by_user_id) VALUES ($1,$2,$3,$4,$5)', [addId, id, parsed.data.title, parsed.data.body, authReq.user.userId]);
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'CHALLENGE_ADDENDUM_POSTED', entityType: 'CHALLENGE', entityId: id, details: { addendumId: addId, title: parsed.data.title }, ipAddress: request.ip || '127.0.0.1', userAgent: request.headers['user-agent'] || 'Unknown' });
    return reply.status(201).send({ success: true, id: addId });
  });

  app.get('/:id/addenda', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const ch = (await db.query('SELECT status FROM challenges WHERE id = $1', [id])).rows[0];
    if (!ch || (ch.status === 'DRAFT' && (request as AuthenticatedRequest).user.role !== 'government' && (request as AuthenticatedRequest).user.role !== 'admin')) return reply.status(404).send({ error: 'Challenge not found' });
    const rows = (await db.query('SELECT id, title, body, created_at FROM challenge_addenda WHERE challenge_id = $1 ORDER BY created_at DESC', [id])).rows;
    return reply.send({ addenda: rows });
  });

  app.post('/:id/close', { preHandler: [authenticate, requireRole('government', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;
    const ch = (await db.query('SELECT id, status, department_id FROM challenges WHERE id = $1', [id])).rows[0];
    if (!ch) return reply.status(404).send({ error: 'Challenge not found' });
    if (authReq.user.role === 'government' && authReq.user.departmentId && ch.department_id !== authReq.user.departmentId) {
      return reply.status(403).send({ error: 'Forbidden: this challenge belongs to another department' });
    }
    if (!['PUBLISHED', 'PROPOSALS_RECEIVED', 'AI_EVALUATION', 'SHORTLISTED'].includes(ch.status)) {
      return reply.status(409).send({ error: `A challenge in status '${ch.status}' cannot be closed.` });
    }
    await db.query(`UPDATE challenges SET status = 'CLOSED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
    await auditService.logEvent({
      actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'CHALLENGE_CLOSED',
      entityType: 'CHALLENGE', entityId: id, ipAddress: request.ip || '127.0.0.1', userAgent: request.headers['user-agent'] || 'Unknown'
    });
    return reply.send({ success: true });
  });
}
