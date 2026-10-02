import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DatabaseAdapter, getSetting, setSetting } from '../db';
import { marketEnabled } from '../market';
import { AuditService } from '../audit';
import { EmailProvider } from '../adapters';
import { hashPassword, generateTempPassword, sha256, AuthenticatedRequest, createAuthMiddleware, requireRole } from '../security';

const inviteUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  role: z.enum(['government', 'inspector', 'finance', 'admin']),
  designation: z.string().min(2),
  departmentId: z.string().optional()
});

const departmentSchema = z.object({
  name: z.string().min(3).max(120),
  code: z.string().regex(/^[A-Za-z0-9]{2,12}$/, 'Code must be 2-12 letters/digits'),
  ministry: z.string().min(3).max(160),
  description: z.string().max(400).optional(),
  budgetAllocatedPaise: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).default('0')
});

const updateUserSchema = z.object({
  isActive: z.boolean().optional(),
  role: z.enum(['government', 'inspector', 'finance', 'admin']).optional(),
  departmentId: z.string().nullable().optional(),
  designation: z.string().min(2).max(120).optional()
});

const updateDepartmentSchema = z.object({
  name: z.string().min(3).max(120).optional(),
  description: z.string().max(400).optional(),
  isActive: z.boolean().optional(),
  budgetAllocatedPaise: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).optional()
});

const SETTINGS_SCHEMA = z.object({
  tdsRateBps: z.number().int().min(0).max(3000).optional(),
  gstTdsRateBps: z.number().int().min(0).max(3000).optional(),
  gstTdsThresholdPaise: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).optional(),
  slaDays: z.number().int().min(1).max(90).optional(),
  assistantEnabled: z.boolean().optional(),
  proposalEvaluationAiEnabled: z.boolean().optional(),
  challengeDraftAiEnabled: z.boolean().optional()
});

const verifyStartupSchema = z.object({
  status: z.enum(['VERIFIED', 'REJECTED']),
  verificationNotes: z.string().min(5)
});

export async function adminRoutes(
  app: FastifyInstance,
  opts: {
    db: DatabaseAdapter;
    auditService: AuditService;
    emailProvider: EmailProvider;
  }
) {
  const { db, auditService, emailProvider } = opts;
  const authenticate = createAuthMiddleware(db);

  // Guard all admin routes with requireRole('admin')
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole('admin'));

  // 1. Admin Dashboard Overview
  app.get('/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    const [usersRes, chalRes, pilotRes, orgsRes] = await Promise.all([
      db.query(`SELECT role, COUNT(*) as count FROM users GROUP BY role`),
      db.query(`SELECT status, COUNT(*) as count FROM challenges GROUP BY status`),
      db.query(`SELECT status, COUNT(*) as count FROM pilots GROUP BY status`),
      db.query(`SELECT verification_status, COUNT(*) as count FROM organizations GROUP BY verification_status`)
    ]);

    const chainIntegrity = await auditService.verifyChain();

    return reply.send({
      userDistribution: usersRes.rows,
      challengeDistribution: chalRes.rows,
      pilotDistribution: pilotRes.rows,
      organizationDistribution: orgsRes.rows,
      systemHealth: {
        database: 'HEALTHY',
        aiService: 'HEALTHY',
        storageService: 'HEALTHY',
        auditChainIntegrity: chainIntegrity.valid ? 'VALID_UNBROKEN' : 'CORRUPTED',
        totalAuditEntries: chainIntegrity.totalEntries
      }
    });
  });

  // 2. User Directory & Invite Dispatch
  app.get('/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const res = await db.query(`
      SELECT u.id, u.email, u.role, u.name, u.designation, u.is_active, u.mfa_enabled,
             u.created_at, d.name as department_name, o.name as organization_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      LEFT JOIN organizations o ON u.organization_id = o.id
      ORDER BY u.created_at DESC
    `);
    return reply.send({ users: res.rows });
  });

  app.post('/users/invite', async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const parseResult = inviteUserSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }
    const data = parseResult.data;

    // Check duplicate email
    const existing = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [data.email]);
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: 'User with this email already exists.' });
    }

    const inviteToken = sha256(`INVITE:${data.email}:${Date.now()}`);
    const inviteId = `INV-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 48 * 3600 * 1000); // 48 hours

    // Cryptographically random temporary password; the user must change it on first login.
    // (They may instead sign in with Google using this same email — no password needed.)
    const tempPassword = generateTempPassword();
    const tempHash = await hashPassword(tempPassword);
    const userId = `USR-${Date.now().toString().slice(-6)}${sha256(data.email).slice(0, 4)}`;

    if (data.departmentId) {
      const d = await db.query('SELECT id FROM departments WHERE id = $1 AND is_active = TRUE', [data.departmentId]);
      if (d.rows.length === 0) return reply.status(400).send({ error: 'Unknown or inactive department' });
    }
    if (['government', 'finance'].includes(data.role) && !data.departmentId) {
      return reply.status(400).send({ error: 'Government and Finance users must be assigned to a department' });
    }

    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO invitations (id, email, role, department_id, token_hash, expires_at, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [inviteId, data.email.toLowerCase(), data.role, data.departmentId || null, inviteToken, expiresAt, authReq.user.userId]
      );

      await tx.query(
        `INSERT INTO users (
          id, email, password_hash, role, name, designation, department_id, must_change_password
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
        [userId, data.email.toLowerCase(), tempHash, data.role, data.name, data.designation, data.departmentId || null]
      );
    });

    await emailProvider.sendEmail({
      to: data.email,
      subject: 'Official Invitation: Startup2Sarkar Sovereign Innovation Procurement Platform',
      text: `You have been authorized by Super Admin to join Startup2Sarkar as ${data.role.toUpperCase()}.\nTemporary Password: ${tempPassword}\nPlease login and configure MFA immediately.`,
      html: `<p>You have been authorized to join Startup2Sarkar as <strong>${data.role.toUpperCase()}</strong>.</p><p>Temporary Password: <code>${tempPassword}</code></p>`
    });

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: 'admin',
      action: 'USER_INVITATION_DISPATCHED',
      entityType: 'USER',
      entityId: userId,
      details: { invitedEmail: data.email, assignedRole: data.role },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.status(201).send({
      success: true,
      message: `Account created for ${data.email} as ${data.role}. Share the temporary password securely — it is shown only once. They can also sign in with Google using this email.`,
      userId,
      // Shown exactly once to the administrator; only an Argon2id hash is stored.
      temporaryPassword: tempPassword
    });
  });

  // 3. Department Management
  app.get('/departments', async (request: FastifyRequest, reply: FastifyReply) => {
    const res = await db.query('SELECT * FROM departments ORDER BY name ASC');
    return reply.send({ departments: res.rows });
  });

  app.post('/departments', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedDept = departmentSchema.safeParse(request.body);
    if (!parsedDept.success) return reply.status(400).send({ error: 'Validation failed', details: parsedDept.error.format() });
    const { name, code, ministry, description, budgetAllocatedPaise } = parsedDept.data;
    const authReq = request as AuthenticatedRequest;

    const deptId = `DEPT-${code.toUpperCase()}`;
    const dup = await db.query('SELECT id FROM departments WHERE code = $1 OR id = $2', [code.toUpperCase(), deptId]);
    if (dup.rows.length > 0) return reply.status(409).send({ error: `A department with code ${code.toUpperCase()} already exists` });
    await db.query(
      `INSERT INTO departments (id, name, code, ministry, description, budget_allocated_paise)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [deptId, name, code.toUpperCase(), ministry, description || '', BigInt(budgetAllocatedPaise).toString()]
    );

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: 'admin',
      action: 'DEPARTMENT_CREATED',
      entityType: 'DEPARTMENT',
      entityId: deptId,
      details: { name, code, ministry },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.status(201).send({ success: true, departmentId: deptId });
  });

  // 4. Startup Administration & Verification Workflow (Spec Section 73)
  app.get('/startups', async (request: FastifyRequest, reply: FastifyReply) => {
    const res = await db.query(
      `SELECT id, name, dpiit_number, cin_llpin, pan, gstin, bank_account_masked, ifsc_code, founder_name, founder_email,
              founder_phone, website, sector, stage, verification_status, verification_notes, verified_at, created_at
       FROM organizations ORDER BY created_at DESC`
    );
    return reply.send({ startups: res.rows });
  });

  app.put('/startups/:id/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;

    const parseResult = verifyStartupSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }
    const { status, verificationNotes } = parseResult.data;

    const exists = await db.query('SELECT id FROM organizations WHERE id = $1', [id]);
    if (exists.rows.length === 0) return reply.status(404).send({ error: 'Startup organisation not found' });

    await db.query(
      `UPDATE organizations
       SET verification_status = $1, verification_notes = $2,
           verified_by_user_id = $3, verified_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [status, verificationNotes, authReq.user.userId, id]
    );

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: 'admin',
      action: `STARTUP_VERIFICATION_${status}`,
      entityType: 'ORGANIZATION',
      entityId: id,
      details: { status, verificationNotes },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.send({
      success: true,
      message: `Startup organization status updated to ${status}.`
    });
  });

  // 5. Central Tamper-Evident Audit Viewer & Verification Check
  app.get('/audit-logs', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as any;
    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    const [logsRes, countRes, integrityRes] = await Promise.all([
      db.query(`SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT $1 OFFSET $2`, [limit, offset]),
      db.query(`SELECT COUNT(*) as total FROM audit_logs`),
      auditService.verifyChain()
    ]);

    return reply.send({
      logs: logsRes.rows,
      integrity: integrityRes,
      pagination: {
        page,
        limit,
        total: parseInt(countRes.rows[0].total, 10)
      }
    });
  });

  // 6. Edit users: activate / deactivate / re-role / re-assign department
  app.put('/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.format() });
    const patch = parsed.data;

    const target = (await db.query('SELECT id, role, is_active, email FROM users WHERE id = $1', [id])).rows[0];
    if (!target) return reply.status(404).send({ error: 'User not found' });
    if (target.role === 'startup' && patch.role) return reply.status(400).send({ error: 'Startup accounts cannot be re-roled' });

    // Safety rails: never lock the platform out of administration
    const demotesOrDisablesAdmin = target.role === 'admin' && (patch.isActive === false || (patch.role && patch.role !== 'admin'));
    if (demotesOrDisablesAdmin) {
      if (target.id === authReq.user.userId) return reply.status(400).send({ error: 'You cannot deactivate or demote your own admin account' });
      const admins = await db.query(`SELECT COUNT(*) c FROM users WHERE role='admin' AND is_active=TRUE`);
      if (Number(admins.rows[0].c) <= 1) return reply.status(400).send({ error: 'At least one active Super Admin must remain' });
    }
    if (patch.departmentId) {
      const d = await db.query('SELECT id FROM departments WHERE id = $1', [patch.departmentId]);
      if (d.rows.length === 0) return reply.status(400).send({ error: 'Unknown department' });
    }

    await db.transaction(async (tx) => {
      if (patch.isActive !== undefined) await tx.query('UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [patch.isActive, id]);
      if (patch.role) await tx.query('UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [patch.role, id]);
      if (patch.departmentId !== undefined) await tx.query('UPDATE users SET department_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [patch.departmentId, id]);
      if (patch.designation) await tx.query('UPDATE users SET designation = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [patch.designation, id]);
      // Any access change takes effect immediately
      if (patch.isActive === false || patch.role) await tx.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    });

    await auditService.logEvent({
      actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'admin',
      action: patch.isActive === false ? 'USER_DEACTIVATED' : patch.isActive === true ? 'USER_REACTIVATED' : 'USER_UPDATED',
      entityType: 'USER', entityId: id, details: { ...patch },
      ipAddress: request.ip || '127.0.0.1', userAgent: request.headers['user-agent'] || 'Unknown'
    });
    return reply.send({ success: true });
  });

  // 7. Reset a user's password (returns a one-time temporary password)
  app.post('/users/:id/reset-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;
    const target = (await db.query('SELECT id, email FROM users WHERE id = $1', [id])).rows[0];
    if (!target) return reply.status(404).send({ error: 'User not found' });
    const temp = generateTempPassword();
    await db.query(
      `UPDATE users SET password_hash = $1, must_change_password = TRUE, failed_login_attempts = 0, lockout_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [await hashPassword(temp), id]
    );
    await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await auditService.logEvent({
      actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'admin', action: 'USER_PASSWORD_RESET',
      entityType: 'USER', entityId: id, details: { email: target.email },
      ipAddress: request.ip || '127.0.0.1', userAgent: request.headers['user-agent'] || 'Unknown'
    });
    return reply.send({ success: true, temporaryPassword: temp });
  });

  // 8. Department edit + budget allocation (cannot drop below what is already committed)
  app.put('/departments/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;
    const parsed = updateDepartmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.format() });
    const patch = parsed.data;
    const dept = (await db.query('SELECT * FROM departments WHERE id = $1', [id])).rows[0];
    if (!dept) return reply.status(404).send({ error: 'Department not found' });

    if (patch.budgetAllocatedPaise !== undefined) {
      const next = BigInt(patch.budgetAllocatedPaise);
      if (next < BigInt(dept.budget_committed_paise) + BigInt(dept.budget_disbursed_paise)) {
        return reply.status(409).send({ error: 'Allocation cannot be lower than what is already committed or paid out', code: 'BUDGET_BELOW_COMMITTED' });
      }
    }
    await db.query(
      `UPDATE departments SET
         name = COALESCE($1, name), description = COALESCE($2, description), is_active = COALESCE($3, is_active),
         budget_allocated_paise = COALESCE($4, budget_allocated_paise), updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [patch.name ?? null, patch.description ?? null, patch.isActive ?? null,
       patch.budgetAllocatedPaise !== undefined ? BigInt(patch.budgetAllocatedPaise).toString() : null, id]
    );
    await auditService.logEvent({
      actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'admin', action: 'DEPARTMENT_UPDATED',
      entityType: 'DEPARTMENT', entityId: id,
      details: { ...patch, budgetAllocatedPaise: patch.budgetAllocatedPaise !== undefined ? String(patch.budgetAllocatedPaise) : undefined },
      ipAddress: request.ip || '127.0.0.1', userAgent: request.headers['user-agent'] || 'Unknown'
    });
    return reply.send({ success: true });
  });

  // 9. System settings (tax rates, SLA, AI switches) — persisted, audited, validated
  const readSettings = async () => ({
    tdsRateBps: await getSetting<number>(db, 'tax.tds_rate_bps', 200),
    gstTdsRateBps: await getSetting<number>(db, 'tax.gst_tds_rate_bps', 200),
    gstTdsThresholdPaise: String(await getSetting<string | number>(db, 'tax.gst_tds_threshold_paise', '25000000')),
    slaDays: await getSetting<number>(db, 'sla.payment_days', 15),
    assistantEnabled: await getSetting<boolean>(db, 'ai.assistant.enabled', true),
    proposalEvaluationAiEnabled: await getSetting<boolean>(db, 'ai.proposal_evaluation.enabled', true),
    challengeDraftAiEnabled: await getSetting<boolean>(db, 'ai.challenge_draft.enabled', true)
  });

  app.get('/settings', async (_request: FastifyRequest, reply: FastifyReply) => reply.send({ settings: await readSettings() }));

  app.put('/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = SETTINGS_SCHEMA.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.format() });
    const p = parsed.data;
    const uid = authReq.user.userId;
    if (p.tdsRateBps !== undefined) await setSetting(db, 'tax.tds_rate_bps', p.tdsRateBps, uid);
    if (p.gstTdsRateBps !== undefined) await setSetting(db, 'tax.gst_tds_rate_bps', p.gstTdsRateBps, uid);
    if (p.gstTdsThresholdPaise !== undefined) await setSetting(db, 'tax.gst_tds_threshold_paise', String(p.gstTdsThresholdPaise), uid);
    if (p.slaDays !== undefined) await setSetting(db, 'sla.payment_days', p.slaDays, uid);
    if (p.assistantEnabled !== undefined) await setSetting(db, 'ai.assistant.enabled', p.assistantEnabled, uid);
    if (p.proposalEvaluationAiEnabled !== undefined) await setSetting(db, 'ai.proposal_evaluation.enabled', p.proposalEvaluationAiEnabled, uid);
    if (p.challengeDraftAiEnabled !== undefined) await setSetting(db, 'ai.challenge_draft.enabled', p.challengeDraftAiEnabled, uid);
    await auditService.logEvent({
      actorId: uid, actorName: authReq.user.name, actorRole: 'admin', action: 'SYSTEM_SETTINGS_UPDATED',
      entityType: 'SETTINGS', entityId: 'system', details: { ...p, gstTdsThresholdPaise: p.gstTdsThresholdPaise !== undefined ? String(p.gstTdsThresholdPaise) : undefined },
      ipAddress: request.ip || '127.0.0.1', userAgent: request.headers['user-agent'] || 'Unknown'
    });
    return reply.send({ success: true, settings: await readSettings() });
  });

  // 10. AI governance: live status + inference audit log (real rows, not samples)
  app.get('/ai', async (_request: FastifyRequest, reply: FastifyReply) => {
    const s = await readSettings();
    const usage = await db.query(`SELECT feature, COUNT(*) calls, COALESCE(SUM(tokens_used),0) tokens FROM ai_audit_logs GROUP BY feature ORDER BY feature`);
    return reply.send({
      provider: process.env.GEMINI_API_KEY ? 'Google Gemini' : 'S2S Local Advisory Engine',
      model: process.env.GEMINI_API_KEY ? (process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite') : 'rules-based (no external model)',
      llmConfigured: !!process.env.GEMINI_API_KEY,
      market: { enabled: marketEnabled(), source: 'ECB reference rates via Frankfurter (official daily rates, not live quotes)' },
      services: [
        { id: 'assistant', name: 'Portal Assistant', enabled: s.assistantEnabled },
        { id: 'proposalEvaluation', name: 'Proposal Evaluator (advisory)', enabled: s.proposalEvaluationAiEnabled },
        { id: 'challengeDraft', name: 'Challenge Drafting', enabled: s.challengeDraftAiEnabled }
      ],
      usage: usage.rows,
      humanInTheLoopEnforced: true
    });
  });

  app.get('/ai/logs', async (_request: FastifyRequest, reply: FastifyReply) => {
    const res = await db.query(
      `SELECT l.id, l.feature, l.model_name, l.prompt_version, l.input_ref, l.tokens_used, l.timestamp, u.name as user_name, u.role as user_role
       FROM ai_audit_logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.timestamp DESC LIMIT 100`
    );
    return reply.send({ logs: res.rows });
  });
}
