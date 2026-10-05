import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DatabaseAdapter } from '../db';
import { AuditService } from '../audit';
import { AuthenticatedRequest, createAuthMiddleware, requireRole, isOrgOwner } from '../security';

/**
 * Messages between a startup's team and the department running its pilot.
 * Deliberately limited to PILOTS (after an award). Before an award, questions go through the public Q&A on the challenge,
 * so no bidder can have a private line to the department while proposals are being evaluated.
 */
export async function messageRoutes(app: FastifyInstance, opts: { db: DatabaseAdapter; auditService: AuditService }) {
  const { db, auditService } = opts;
  const authenticate = createAuthMiddleware(db);
  const pre = [authenticate, requireRole('startup', 'government')];
  const meta = (r: FastifyRequest) => ({ ipAddress: r.ip || '127.0.0.1', userAgent: (r.headers['user-agent'] as string) || 'Unknown' });
  const newId = (p: string) => `${p}-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const sideOf = (u: AuthenticatedRequest['user']) => (u.role === 'startup' ? 'STARTUP' : 'DEPARTMENT');
  const canSee = (u: AuthenticatedRequest['user'], t: any) => (u.role === 'startup' ? !!u.organizationId && t.organization_id === u.organizationId : !!u.departmentId && t.department_id === u.departmentId);

  const notifyOtherSide = async (thread: any, from: 'STARTUP' | 'DEPARTMENT', senderId: string, text: string) => {
    const who = from === 'STARTUP' ? `u.role = 'government' AND u.department_id = $4` : `u.role = 'startup' AND u.organization_id = $4`;
    await db.query(
      `INSERT INTO notifications (id, user_id, title, message, priority, action_link) SELECT 'NTF-' || $1::text || '-' || u.id, u.id, 'New message', $2::text, 'INFO', $3::text FROM users u WHERE ${who} AND u.is_active = TRUE AND u.id <> $5`,
      [newId('MSG'), `${thread.subject}: ${text.slice(0, 100)}`, `/messages?thread=${thread.id}`, from === 'STARTUP' ? thread.department_id : thread.organization_id, senderId]
    );
  };

  const listSql = `
    SELECT t.*, p.name AS pilot_name, o.name AS startup_name, d.name AS department_name,
           (SELECT m.body FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
           (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.sender_user_id <> $1
              AND m.created_at > COALESCE((SELECT r.last_read_at FROM thread_reads r WHERE r.thread_id = t.id AND r.user_id = $1), TIMESTAMPTZ 'epoch')) AS unread
    FROM message_threads t JOIN pilots p ON p.id = t.pilot_id JOIN organizations o ON o.id = t.organization_id JOIN departments d ON d.id = t.department_id`;

  app.get('/threads', { preHandler: pre }, async (request: FastifyRequest, reply: FastifyReply) => {
    const u = (request as AuthenticatedRequest).user;
    const scope = u.role === 'startup' ? 't.organization_id = $2' : 't.department_id = $2';
    const rows = (await db.query(`${listSql} WHERE ${scope} ORDER BY t.last_message_at DESC LIMIT 100`, [u.userId, (u.role === 'startup' ? u.organizationId : u.departmentId) || '__none__'])).rows;
    return reply.send({ threads: rows.map((t: any) => ({ id: t.id, subject: t.subject, status: t.status, pilotId: t.pilot_id, pilotName: t.pilot_name, startupName: t.startup_name, department: t.department_name, lastMessage: String(t.last_body || '').slice(0, 140), lastMessageAt: t.last_message_at, unread: Number(t.unread) })) });
  });

  app.get('/unread', { preHandler: pre }, async (request: FastifyRequest, reply: FastifyReply) => {
    const u = (request as AuthenticatedRequest).user;
    const scope = u.role === 'startup' ? 't.organization_id = $2' : 't.department_id = $2';
    const rows = (await db.query(`${listSql} WHERE ${scope}`, [u.userId, (u.role === 'startup' ? u.organizationId : u.departmentId) || '__none__'])).rows;
    return reply.send({ unread: rows.reduce((a: number, t: any) => a + Number(t.unread), 0) });
  });

  app.post('/threads', { preHandler: pre, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const u = (request as AuthenticatedRequest).user;
    const parsed = z.object({ pilotId: z.string().min(3), subject: z.string().trim().min(3).max(120), body: z.string().trim().min(1).max(2000) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Choose a pilot, give the conversation a subject, and write a message (up to 2,000 characters).' });
    const pilot = (await db.query('SELECT id, name, organization_id, department_id FROM pilots WHERE id = $1', [parsed.data.pilotId])).rows[0];
    const ok = pilot && (u.role === 'startup' ? pilot.organization_id === u.organizationId : !!u.departmentId && pilot.department_id === u.departmentId);
    if (!ok) return reply.status(404).send({ error: 'Pilot not found' });
    const thread = { id: newId('THR'), subject: parsed.data.subject, organization_id: pilot.organization_id, department_id: pilot.department_id };
    await db.transaction(async (tx) => {
      await tx.query('INSERT INTO message_threads (id, pilot_id, organization_id, department_id, subject, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)', [thread.id, pilot.id, pilot.organization_id, pilot.department_id, thread.subject, u.userId]);
      await tx.query('INSERT INTO messages (id, thread_id, sender_user_id, sender_name, sender_side, body) VALUES ($1,$2,$3,$4,$5,$6)', [newId('MS'), thread.id, u.userId, u.name, sideOf(u), parsed.data.body]);
      await tx.query('INSERT INTO thread_reads (thread_id, user_id) VALUES ($1,$2)', [thread.id, u.userId]);
    });
    await notifyOtherSide(thread, sideOf(u), u.userId, parsed.data.body);
    await auditService.logEvent({ actorId: u.userId, actorName: u.name, actorRole: u.role, action: 'MESSAGE_THREAD_STARTED', entityType: 'PILOT', entityId: pilot.id, details: { threadId: thread.id }, ...meta(request) }); // never the message text
    return reply.status(201).send({ success: true, id: thread.id });
  });

  app.get('/threads/:id', { preHandler: pre }, async (request: FastifyRequest, reply: FastifyReply) => {
    const u = (request as AuthenticatedRequest).user;
    const t = (await db.query(`${listSql} WHERE t.id = $2`, [u.userId, (request.params as any).id])).rows[0];
    if (!t || !canSee(u, t)) return reply.status(404).send({ error: 'Conversation not found' });
    const msgs = (await db.query('SELECT id, sender_user_id, sender_name, sender_side, body, created_at FROM messages WHERE thread_id = $1 ORDER BY created_at ASC LIMIT 500', [t.id])).rows;
    await db.query(`INSERT INTO thread_reads (thread_id, user_id, last_read_at) VALUES ($1,$2,CURRENT_TIMESTAMP) ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = CURRENT_TIMESTAMP`, [t.id, u.userId]);
    return reply.send({
      thread: { id: t.id, subject: t.subject, status: t.status, pilotId: t.pilot_id, pilotName: t.pilot_name, startupName: t.startup_name, department: t.department_name },
      messages: msgs.map((m: any) => ({ id: m.id, sender: m.sender_name, side: m.sender_side, mine: m.sender_user_id === u.userId, body: m.body, at: m.created_at }))
    });
  });

  app.post('/threads/:id/messages', { preHandler: pre, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const u = (request as AuthenticatedRequest).user;
    const parsed = z.object({ body: z.string().trim().min(1).max(2000) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Write a message of up to 2,000 characters.' });
    const t = (await db.query('SELECT * FROM message_threads WHERE id = $1', [(request.params as any).id])).rows[0];
    if (!t || !canSee(u, t)) return reply.status(404).send({ error: 'Conversation not found' });
    if (t.status !== 'OPEN') return reply.status(409).send({ error: 'This conversation is closed. Reopen it to continue.', code: 'THREAD_CLOSED' });
    const id = newId('MS');
    await db.query('INSERT INTO messages (id, thread_id, sender_user_id, sender_name, sender_side, body) VALUES ($1,$2,$3,$4,$5,$6)', [id, t.id, u.userId, u.name, sideOf(u), parsed.data.body]);
    await db.query('UPDATE message_threads SET last_message_at = CURRENT_TIMESTAMP WHERE id = $1', [t.id]);
    await db.query(`INSERT INTO thread_reads (thread_id, user_id, last_read_at) VALUES ($1,$2,CURRENT_TIMESTAMP) ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = CURRENT_TIMESTAMP`, [t.id, u.userId]);
    await notifyOtherSide(t, sideOf(u), u.userId, parsed.data.body);
    return reply.status(201).send({ success: true, id });
  });

  const setStatus = (status: 'OPEN' | 'CLOSED') => async (request: FastifyRequest, reply: FastifyReply) => {
    const u = (request as AuthenticatedRequest).user;
    const t = (await db.query('SELECT * FROM message_threads WHERE id = $1', [(request.params as any).id])).rows[0];
    if (!t || !canSee(u, t)) return reply.status(404).send({ error: 'Conversation not found' });
    if (u.role === 'startup' && !(await isOrgOwner(db, u.userId))) return reply.status(403).send({ error: 'Only the account owner can close or reopen a conversation.', code: 'OWNER_ONLY' });
    await db.query('UPDATE message_threads SET status = $1 WHERE id = $2', [status, t.id]);
    await auditService.logEvent({ actorId: u.userId, actorName: u.name, actorRole: u.role, action: status === 'CLOSED' ? 'MESSAGE_THREAD_CLOSED' : 'MESSAGE_THREAD_REOPENED', entityType: 'PILOT', entityId: t.pilot_id, details: { threadId: t.id }, ...meta(request) });
    return reply.send({ success: true });
  };
  app.post('/threads/:id/close', { preHandler: pre }, setStatus('CLOSED'));
  app.post('/threads/:id/reopen', { preHandler: pre }, setStatus('OPEN'));
}
