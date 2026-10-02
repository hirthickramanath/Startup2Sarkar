import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DatabaseAdapter } from '../db';
import { AuditService } from '../audit';
import { StorageProvider } from '../adapters';
import { AuthenticatedRequest, createAuthMiddleware } from '../security';


// ───────────── domain/files/routes ─────────────
export async function fileRoutes(
  app: FastifyInstance,
  opts: {
    db: DatabaseAdapter;
    auditService: AuditService;
    storageProvider: StorageProvider;
  }
) {
  const { db, auditService, storageProvider } = opts;
  const authenticate = createAuthMiddleware(db);

  // 1. Upload File
  app.post('/upload', { preHandler: [authenticate], bodyLimit: 36 * 1024 * 1024 }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const body = request.body as {
      filename: string;
      mimeType: string;
      base64Data: string;
      entityType: string;
      entityId: string;
      isPublic?: boolean;
    };

    if (!body.filename || !body.mimeType || !body.base64Data) {
      return reply.status(400).send({ error: 'filename, mimeType, and base64Data are required.' });
    }

    try {
      const buffer = Buffer.from(body.base64Data, 'base64');
      const fileMeta = await storageProvider.saveFile({
        originalName: body.filename,
        mimeType: body.mimeType,
        buffer,
        uploadedByUserId: authReq.user.userId,
        entityType: body.entityType || 'evidence',
        entityId: body.entityId || 'general',
        isPublic: body.isPublic || false
      });

      // Record in database
      await db.query(
        `INSERT INTO files (
          id, original_name, mime_type, size_bytes, sha256_hash,
          storage_path, uploaded_by_user_id, entity_type, entity_id, is_public
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          fileMeta.id, fileMeta.originalName, fileMeta.mimeType,
          fileMeta.sizeBytes, fileMeta.sha256Hash, fileMeta.storagePath,
          fileMeta.uploadedByUserId, fileMeta.entityType, fileMeta.entityId,
          fileMeta.isPublic
        ]
      );

      await auditService.logEvent({
        actorId: authReq.user.userId,
        actorName: authReq.user.name,
        actorRole: authReq.user.role,
        action: 'FILE_UPLOADED',
        entityType: 'FILE',
        entityId: fileMeta.id,
        details: { filename: fileMeta.originalName, mimeType: fileMeta.mimeType, size: fileMeta.sizeBytes },
        ipAddress: request.ip || '127.0.0.1',
        userAgent: request.headers['user-agent'] || 'Unknown'
      });

      return reply.status(201).send({ success: true, file: fileMeta });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'File processing failed' });
    }
  });

  // 2. Download / View File
  app.get('/:id/download', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const fileRes = await db.query('SELECT * FROM files WHERE id = $1', [id]);
    if (fileRes.rows.length === 0) {
      return reply.status(404).send({ error: 'File not found' });
    }
    const file = fileRes.rows[0];

    const buffer = await storageProvider.getFileBuffer(file.storage_path);
    reply.header('Content-Type', file.mime_type);
    reply.header('Content-Disposition', `inline; filename="${file.original_name}"`);
    return reply.send(buffer);
  });
}


// ───────────── domain/notifications/routes ─────────────
export async function notificationRoutes(app: FastifyInstance, opts: { db: DatabaseAdapter }) {
  const { db } = opts;
  const authenticate = createAuthMiddleware(db);

  // 1. Get User Notifications
  app.get('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;

    const res = await db.query(
      `SELECT * FROM notifications
       WHERE (user_id = $1 OR role = $2)
       ORDER BY created_at DESC
       LIMIT 50`,
      [authReq.user.userId, authReq.user.role]
    );

    const unreadCountRes = await db.query(
      `SELECT COUNT(*) as unread FROM notifications
       WHERE (user_id = $1 OR role = $2) AND is_read = FALSE`,
      [authReq.user.userId, authReq.user.role]
    );

    return reply.send({
      notifications: res.rows,
      unreadCount: parseInt(unreadCountRes.rows[0].unread, 10)
    });
  });

  // 2. Mark Notification as Read (PUT kept for API compatibility; the web client uses POST)
  const markRead = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;

    await db.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE id = $1 AND (user_id = $2 OR role = $3)`,
      [id, authReq.user.userId, authReq.user.role]
    );

    return reply.send({ success: true });
  };
  app.put('/:id/read', { preHandler: [authenticate] }, markRead);
  app.post('/:id/read', { preHandler: [authenticate] }, markRead);

  // 3. Mark all as read
  app.post('/read-all', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    await db.query('UPDATE notifications SET is_read = TRUE WHERE (user_id = $1 OR role = $2) AND is_read = FALSE', [authReq.user.userId, authReq.user.role]);
    return reply.send({ success: true });
  });
}


// ───────────── domain/public/routes ─────────────
export async function publicRoutes(app: FastifyInstance, opts: { db: DatabaseAdapter }) {
  const { db } = opts;

  // Public Transparency Portal (No Login Required, Strict Field Allow-list)
  app.get('/transparency', async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Aggregate Statistics Only
    const [statsRes, openChallengesRes] = await Promise.all([
      db.query(`
        SELECT
          (SELECT COUNT(*) FROM challenges WHERE status = 'PUBLISHED') as open_challenges_count,
          (SELECT COUNT(*) FROM pilots WHERE status = 'VALIDATED' OR status = 'COMPLETED') as completed_pilots_count,
          (SELECT COUNT(*) FROM organizations WHERE verification_status = 'VERIFIED') as verified_startups_count,
          (SELECT COALESCE(SUM(budget_disbursed_paise), 0) FROM departments) as total_disbursed_paise
      `),
      // 2. Strict Allow-list of Public Fields for Open Challenges (No internal remarks, no evaluators, no proposals)
      db.query(`
        SELECT id, title, department_name, problem_category, desired_outcome,
               pilot_duration_months, deadline, created_at
        FROM challenges
        WHERE status = 'PUBLISHED'
        ORDER BY created_at DESC
        LIMIT 20
      `)
    ]);

    const stats = statsRes.rows[0];
    const disbursedPaise = BigInt(stats.total_disbursed_paise);

    return reply.send({
      transparency: {
        openChallengesCount: parseInt(stats.open_challenges_count, 10),
        completedPilotsCount: parseInt(stats.completed_pilots_count, 10),
        verifiedStartupsCount: parseInt(stats.verified_startups_count, 10),
        totalPublicProcurementDisbursedRupees: Number(disbursedPaise / 100n)
      },
      openChallenges: openChallengesRes.rows
    });
  });

  // Runtime config the browser needs before login (no secrets: a Google OAuth *client id* is public by design)
  app.get('/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      appName: 'Startup2Sarkar',
      googleClientId: process.env.GOOGLE_CLIENT_ID || null,
      aiMode: process.env.GEMINI_API_KEY ? 'llm' : 'local'
    });
  });

  // Department directory (names only) — needed by the challenge form and filters
  app.get('/departments', async (_request: FastifyRequest, reply: FastifyReply) => {
    const res = await db.query('SELECT id, name, code, ministry FROM departments WHERE is_active = TRUE ORDER BY name');
    return reply.send({ departments: res.rows });
  });

  // Public challenges
  app.get('/challenges', async (request: FastifyRequest, reply: FastifyReply) => {
    const res = await db.query(`
      SELECT id, title, department_name, problem_category, desired_outcome,
             pilot_duration_months, deadline, created_at, budget_paise
      FROM challenges
      WHERE status = 'PUBLISHED'
      ORDER BY created_at DESC
    `);
    return reply.send({ challenges: res.rows });
  });

  // Public stats
  app.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const statsRes = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM challenges WHERE status = 'PUBLISHED') as open_challenges_count,
        (SELECT COUNT(*) FROM pilots WHERE status = 'VALIDATED' OR status = 'COMPLETED') as completed_pilots_count,
        (SELECT COUNT(*) FROM organizations WHERE verification_status = 'VERIFIED') as verified_startups_count,
        (SELECT COALESCE(SUM(budget_disbursed_paise), 0) FROM departments) as total_disbursed_paise
    `);
    const stats = statsRes.rows[0];
    const disbursedPaise = BigInt(stats.total_disbursed_paise);
    return reply.send({
      openChallengesCount: parseInt(stats.open_challenges_count, 10),
      completedPilotsCount: parseInt(stats.completed_pilots_count, 10),
      verifiedStartupsCount: parseInt(stats.verified_startups_count, 10),
      totalDisbursedPaise: stats.total_disbursed_paise,
      totalDisbursedRupees: Number(disbursedPaise / 100n)
    });
  });
}


// ───────────── domain/search/routes ─────────────
export async function searchRoutes(app: FastifyInstance, opts: { db: DatabaseAdapter }) {
  const { db } = opts;
  const authenticate = createAuthMiddleware(db);

  // Global search: every query is scoped to what the caller's role may see, and links point at that role's own screens.
  app.get('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const u = (request as AuthenticatedRequest).user;
    const { q } = request.query as { q?: string };
    if (!q || q.trim().length < 2) return reply.send({ results: [] });
    const term = `%${q.trim().replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    const results: any[] = [];
    const role = u.role;
    const base = `/${role === 'admin' ? 'government' : role}`;
    const add = async (sql: string, params: any[]) => { results.push(...(await db.query(sql, params)).rows); };

    // Challenges (not for inspectors/finance — they work from pilots and claims)
    if (['government', 'startup', 'admin'].includes(role)) {
      const params: any[] = [term];
      let scope = '';
      if (role === 'startup') scope = ` AND status <> 'DRAFT'`;
      if (role === 'government' && u.departmentId) { scope = ` AND (status <> 'DRAFT' OR department_id = $2)`; params.push(u.departmentId); }
      await add(`SELECT id, title, 'challenge' AS type, department_name AS subtitle, status, ('${base}/challenges/' || id) AS link
                 FROM challenges WHERE (title ILIKE $1 OR problem_statement ILIKE $1 OR id ILIKE $1)${scope} ORDER BY created_at DESC LIMIT 5`, params);
    }

    // Proposals
    if (['government', 'startup', 'admin'].includes(role)) {
      const params: any[] = [term];
      let scope = '';
      if (role === 'startup') { scope = ' AND p.organization_id = $2'; params.push(u.organizationId); }
      if (role === 'government' && u.departmentId) { scope = ' AND c.department_id = $2'; params.push(u.departmentId); }
      const link = role === 'startup' ? `'/startup/proposals'` : `('/government/challenges/' || p.challenge_id || '/proposals')`;
      await add(`SELECT p.id, p.solution_title AS title, 'proposal' AS type, p.startup_name AS subtitle, p.status, ${link} AS link
                 FROM proposals p JOIN challenges c ON c.id = p.challenge_id
                 WHERE (p.solution_title ILIKE $1 OR p.startup_name ILIKE $1 OR p.id ILIKE $1)${scope} ORDER BY p.created_at DESC LIMIT 5`, params);
    }

    // Pilots
    {
      const params: any[] = [term];
      let scope = '';
      if (role === 'startup') { scope = ' AND organization_id = $2'; params.push(u.organizationId); }
      else if (role === 'inspector') { scope = ' AND assigned_inspector_id = $2'; params.push(u.userId); }
      else if (role === 'government' && u.departmentId) { scope = ' AND department_id = $2'; params.push(u.departmentId); }
      const root = role === 'finance' ? '/government' : base;
      await add(`SELECT id, name AS title, 'pilot' AS type, startup_name AS subtitle, status, ('${role === 'finance' ? '/finance/reports' : root + '/pilots/'}' ${role === 'finance' ? '' : '|| id'}) AS link
                 FROM pilots WHERE (name ILIKE $1 OR startup_name ILIKE $1 OR id ILIKE $1)${scope} ORDER BY created_at DESC LIMIT 5`, params);
    }

    // Payment claims
    if (['finance', 'admin', 'startup', 'government'].includes(role)) {
      const params: any[] = [term];
      let scope = '';
      if (role === 'startup') { scope = ' AND organization_id = $2'; params.push(u.organizationId); }
      else if (role === 'government' && u.departmentId) { scope = ' AND department_id = $2'; params.push(u.departmentId); }
      const link = role === 'startup' ? `'/startup/payments'` : role === 'government' ? `'/government/pilots/' || pilot_id` : `'/finance/payments/' || id`;
      await add(`SELECT id, ('Claim ' || id || ' — invoice ' || invoice_number) AS title, 'payment' AS type, ('Net ₹' || (net_payable_paise / 100)) AS subtitle, status, (${link}) AS link
                 FROM finance_payment_claims WHERE (id ILIKE $1 OR invoice_number ILIKE $1)${scope} ORDER BY created_at DESC LIMIT 5`, params);
    }

    // Startups (admin directory)
    if (role === 'admin') {
      await add(`SELECT id, name AS title, 'startup' AS type, founder_name AS subtitle, verification_status AS status, '/admin/users' AS link
                 FROM organizations WHERE (name ILIKE $1 OR dpiit_number ILIKE $1 OR id ILIKE $1) LIMIT 5`, [term]);
    }
    return reply.send({ results });
  });
}

// ───────────── Department-scoped audit trail (government officers) ─────────────
export async function auditViewRoutes(app: FastifyInstance, opts: { db: DatabaseAdapter }) {
  const { db } = opts;
  const authenticate = createAuthMiddleware(db);

  app.get('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const u = (request as AuthenticatedRequest).user;
    if (u.role !== 'government' && u.role !== 'admin') return reply.status(403).send({ error: 'Forbidden' });
    if (u.role === 'admin' || !u.departmentId) {
      const all = await db.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 100');
      return reply.send({ logs: all.rows });
    }
    const res = await db.query(
      `SELECT a.* FROM audit_logs a
       WHERE a.actor_id IN (SELECT id FROM users WHERE department_id = $1)
          OR a.entity_id IN (
               SELECT id FROM challenges WHERE department_id = $1
               UNION SELECT p.id FROM proposals p JOIN challenges c ON c.id = p.challenge_id WHERE c.department_id = $1
               UNION SELECT id FROM pilots WHERE department_id = $1
               UNION SELECT id FROM finance_payment_claims WHERE department_id = $1)
       ORDER BY a.timestamp DESC LIMIT 100`,
      [u.departmentId]
    );
    return reply.send({ logs: res.rows });
  });
}
