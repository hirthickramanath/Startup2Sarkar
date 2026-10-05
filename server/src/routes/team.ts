import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DatabaseAdapter } from '../db';
import { AuditService } from '../audit';
import { EmailProvider } from '../adapters';
import { AuthenticatedRequest, createAuthMiddleware, requireRole, isOrgOwner } from '../security';

/** Several people per startup: the owner invites teammates; teammates share the startup's work but not its sensitive settings. */
export const MAX_TEAM = 10;

export async function teamRoutes(app: FastifyInstance, opts: { db: DatabaseAdapter; auditService: AuditService; emailProvider: EmailProvider }) {
  const { db, auditService, emailProvider } = opts;
  const authenticate = createAuthMiddleware(db);
  const meta = (r: FastifyRequest) => ({ ipAddress: r.ip || '127.0.0.1', userAgent: (r.headers['user-agent'] as string) || 'Unknown' });
  const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
  const baseUrl = (r: FastifyRequest) => (process.env.PUBLIC_URL || `${r.protocol}://${r.hostname}`).replace(/\/+$/, '');
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  const pre = [authenticate, requireRole('startup')];

  app.get('/', { preHandler: pre }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const orgId = authReq.user.organizationId;
    const members = (await db.query(`SELECT id, name, email, org_role, created_at FROM users WHERE organization_id = $1 AND role = 'startup' AND is_active = TRUE ORDER BY created_at`, [orgId])).rows;
    const invites = (await db.query(`SELECT id, email, expires_at, created_at FROM team_invites WHERE organization_id = $1 AND status = 'PENDING' AND expires_at > CURRENT_TIMESTAMP ORDER BY created_at DESC`, [orgId])).rows;
    return reply.send({
      canManage: await isOrgOwner(db, authReq.user.userId), max: MAX_TEAM,
      members: members.map((m: any) => ({ id: m.id, name: m.name, email: m.email, orgRole: m.org_role === 'MEMBER' ? 'MEMBER' : 'OWNER', isYou: m.id === authReq.user.userId, joinedAt: m.created_at })),
      invites: invites.map((i: any) => ({ id: i.id, email: i.email, expiresAt: i.expires_at, createdAt: i.created_at }))
    });
  });

  app.post('/invites', { preHandler: pre, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    if (!(await isOrgOwner(db, authReq.user.userId))) return reply.status(403).send({ error: 'Only the account owner can invite teammates.', code: 'OWNER_ONLY' });
    const parsed = z.object({ email: z.string().trim().email().max(200) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Enter your teammate\'s email address.' });
    const email = parsed.data.email.toLowerCase();
    const orgId = authReq.user.organizationId;
    const count = Number((await db.query(`SELECT (SELECT COUNT(*) FROM users WHERE organization_id = $1 AND role = 'startup' AND is_active = TRUE) + (SELECT COUNT(*) FROM team_invites WHERE organization_id = $1 AND status = 'PENDING' AND expires_at > CURRENT_TIMESTAMP) AS c`, [orgId])).rows[0].c);
    if (count >= MAX_TEAM) return reply.status(409).send({ error: `A startup can have up to ${MAX_TEAM} people including pending invitations.`, code: 'TEAM_FULL' });
    if ((await db.query('SELECT 1 FROM users WHERE LOWER(email) = $1', [email])).rows.length) return reply.status(409).send({ error: 'That email already has an account. Ask your teammate to use a different address.', code: 'EMAIL_IN_USE' });
    if ((await db.query(`SELECT 1 FROM team_invites WHERE organization_id = $1 AND LOWER(email) = $2 AND status = 'PENDING' AND expires_at > CURRENT_TIMESTAMP`, [orgId, email])).rows.length) return reply.status(409).send({ error: 'That address already has a pending invitation.', code: 'ALREADY_INVITED' });
    await db.query(`UPDATE team_invites SET status = 'REVOKED' WHERE organization_id = $1 AND LOWER(email) = $2 AND status = 'PENDING'`, [orgId, email]); // clears an expired one
    const token = crypto.randomBytes(32).toString('hex');
    const id = `INV-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    await db.query('INSERT INTO team_invites (id, organization_id, email, token_hash, invited_by_user_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6)', [id, orgId, email, sha(token), authReq.user.userId, new Date(Date.now() + 7 * 86400000)]);
    const orgName = (await db.query('SELECT name FROM organizations WHERE id = $1', [orgId])).rows[0]?.name || 'a startup';
    const link = `${baseUrl(request)}/join?token=${token}`;
    let emailed = true;
    try {
      await emailProvider.sendEmail({
        to: email, subject: `${authReq.user.name} invited you to ${orgName} on Startup2Sarkar`,
        text: `${authReq.user.name} invited you to join ${orgName} on Startup2Sarkar.\n\nAccept within 7 days:\n${link}\n\nIf you do not know this person, ignore this email.`,
        html: `<p>${esc(authReq.user.name)} invited you to join <b>${esc(orgName)}</b> on Startup2Sarkar.</p><p><a href="${link}">Accept the invitation</a> (valid for 7 days).</p><p>If you do not know this person, ignore this email.</p>`
      });
    } catch (e: any) { emailed = false; request.log.error({ err: e?.message }, 'team invite email failed'); }
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'startup', action: 'TEAM_INVITED', entityType: 'ORGANIZATION', entityId: orgId as string, details: { inviteId: id }, ...meta(request) });
    // The owner gets the link too, so an invitation still works when email is not set up yet
    return reply.status(201).send({ success: true, id, emailed, inviteLink: link });
  });

  app.delete('/invites/:id', { preHandler: pre }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    if (!(await isOrgOwner(db, authReq.user.userId))) return reply.status(403).send({ error: 'Only the account owner can manage the team.', code: 'OWNER_ONLY' });
    const inv = (await db.query(`SELECT id FROM team_invites WHERE id = $1 AND organization_id = $2 AND status = 'PENDING'`, [(request.params as any).id, authReq.user.organizationId])).rows[0];
    if (!inv) return reply.status(404).send({ error: 'Invitation not found' });
    await db.query(`UPDATE team_invites SET status = 'REVOKED' WHERE id = $1`, [inv.id]);
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'startup', action: 'TEAM_INVITE_REVOKED', entityType: 'ORGANIZATION', entityId: authReq.user.organizationId as string, details: { inviteId: inv.id }, ...meta(request) });
    return reply.send({ success: true });
  });

  app.delete('/members/:id', { preHandler: pre }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    if (!(await isOrgOwner(db, authReq.user.userId))) return reply.status(403).send({ error: 'Only the account owner can manage the team.', code: 'OWNER_ONLY' });
    const target = (await db.query(`SELECT id, name, org_role FROM users WHERE id = $1 AND organization_id = $2 AND role = 'startup' AND is_active = TRUE`, [(request.params as any).id, authReq.user.organizationId])).rows[0];
    if (!target) return reply.status(404).send({ error: 'Team member not found' });
    if (target.id === authReq.user.userId || target.org_role !== 'MEMBER') return reply.status(409).send({ error: 'The account owner cannot be removed.', code: 'CANNOT_REMOVE_OWNER' });
    await db.transaction(async (tx) => {
      await tx.query('UPDATE users SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [target.id]);
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [target.id]); // signed out everywhere, immediately
    });
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'startup', action: 'TEAM_MEMBER_REMOVED', entityType: 'ORGANIZATION', entityId: authReq.user.organizationId as string, details: { removedUserId: target.id }, ...meta(request) });
    return reply.send({ success: true });
  });
}
