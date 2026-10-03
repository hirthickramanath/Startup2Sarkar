import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DatabaseAdapter } from '../db';
import { AuditService } from '../audit';
import { ObjectStore } from '../objectstore';
import { AuthenticatedRequest, createAuthMiddleware, requireRole } from '../security';

/**
 * The statutory documents a startup uploads for verification: PDF only, 8 MB each, private, checked by an administrator.
 * Files are validated by content (a real PDF header, no embedded scripts), never by file extension alone.
 */
export const DOC_TYPES = ['DPIIT_CERTIFICATE', 'INCORPORATION_CERTIFICATE', 'FINANCIAL_STATEMENTS', 'BANK_PROOF'] as const;
export const DOC_LABELS: Record<string, string> = {
  DPIIT_CERTIFICATE: 'DPIIT recognition certificate', INCORPORATION_CERTIFICATE: 'Certificate of incorporation',
  FINANCIAL_STATEMENTS: 'Latest financial statements', BANK_PROOF: 'Bank proof (cancelled cheque or statement)'
};
const MAX_BYTES = 8 * 1024 * 1024;

const uploadSchema = z.object({
  docType: z.enum(DOC_TYPES),
  filename: z.string().trim().min(1).max(150),
  contentBase64: z.string().min(20)
});

export function checkPdf(buf: Buffer): string | null {
  if (buf.length < 100) return 'That file is too small to be a PDF.';
  if (buf.length > MAX_BYTES) return 'Each document can be at most 8 MB.';
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return 'Only PDF files are accepted.';
  const head = buf.toString('latin1');
  if (/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/.test(head)) return 'This PDF contains active content (scripts or attachments), which is not allowed. Export it as a plain PDF.';
  return null;
}

export async function documentRoutes(app: FastifyInstance, opts: { db: DatabaseAdapter; auditService: AuditService; objectStore: ObjectStore }) {
  const { db, auditService, objectStore } = opts;
  const authenticate = createAuthMiddleware(db);
  const meta = (r: FastifyRequest) => ({ ipAddress: r.ip || '127.0.0.1', userAgent: (r.headers['user-agent'] as string) || 'Unknown' });
  const view = (r: any) => ({ id: r.id, docType: r.doc_type, label: DOC_LABELS[r.doc_type], filename: r.filename, sizeBytes: Number(r.size_bytes), status: r.status, reviewNote: r.review_note, uploadedAt: r.created_at, reviewedAt: r.reviewed_at });

  app.post('/', { preHandler: [authenticate, requireRole('startup')], bodyLimit: 14 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = uploadSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Choose the type of document and a PDF file.' });
    if (!authReq.user.organizationId) return reply.status(403).send({ error: 'No startup is linked to this account.' });
    const buf = Buffer.from(parsed.data.contentBase64, 'base64');
    const problem = checkPdf(buf);
    if (problem) return reply.status(400).send({ error: problem, code: 'INVALID_DOCUMENT' });

    const id = `DOC-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const key = `${authReq.user.organizationId}/${parsed.data.docType}/${id}.pdf`;
    try { await objectStore.put(key, buf, 'application/pdf'); }
    catch (e: any) { request.log.error({ err: e?.message }, 'document storage failed'); return reply.status(502).send({ error: 'The file could not be stored. Please try again.', code: 'STORAGE_FAILED' }); }

    await db.transaction(async (tx) => {
      await tx.query(`UPDATE organization_documents SET status = 'SUPERSEDED' WHERE organization_id = $1 AND doc_type = $2 AND status <> 'SUPERSEDED'`, [authReq.user.organizationId, parsed.data.docType]);
      await tx.query(
        `INSERT INTO organization_documents (id, organization_id, doc_type, filename, size_bytes, sha256, storage_key, uploaded_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, authReq.user.organizationId, parsed.data.docType, parsed.data.filename.replace(/[^\w .()-]/g, '_'), buf.length, crypto.createHash('sha256').update(buf).digest('hex'), key, authReq.user.userId]
      );
      await tx.query(`INSERT INTO notifications (id, role, title, message, priority, action_link) VALUES ($1,'admin','Startup document uploaded',$2,'INFO','/admin/users')`, [`NTF-${id}`, `${DOC_LABELS[parsed.data.docType]} was uploaded for review.`]);
    });
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'startup', action: 'DOCUMENT_UPLOADED', entityType: 'ORGANIZATION', entityId: authReq.user.organizationId, details: { docType: parsed.data.docType, documentId: id, sizeBytes: buf.length }, ...meta(request) });
    return reply.status(201).send({ success: true, id });
  });

  app.get('/', { preHandler: [authenticate, requireRole('startup', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const orgId = authReq.user.role === 'admin' ? String((request.query as any).organizationId || '') : authReq.user.organizationId;
    if (!orgId) return reply.send({ documents: [], types: DOC_TYPES.map((t) => ({ type: t, label: DOC_LABELS[t] })) });
    const rows = (await db.query(`SELECT * FROM organization_documents WHERE organization_id = $1 AND status <> 'SUPERSEDED' ORDER BY created_at DESC`, [orgId])).rows;
    return reply.send({ documents: rows.map(view), types: DOC_TYPES.map((t) => ({ type: t, label: DOC_LABELS[t] })) });
  });

  app.get('/:id/download', { preHandler: [authenticate, requireRole('startup', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const row = (await db.query('SELECT * FROM organization_documents WHERE id = $1', [(request.params as any).id])).rows[0];
    if (!row || (authReq.user.role === 'startup' && row.organization_id !== authReq.user.organizationId)) return reply.status(404).send({ error: 'Document not found' });
    let data: Buffer;
    try { data = await objectStore.get(row.storage_key); } catch { return reply.status(502).send({ error: 'The file could not be read from storage.', code: 'STORAGE_FAILED' }); }
    if (crypto.createHash('sha256').update(data).digest('hex') !== row.sha256) return reply.status(500).send({ error: 'This file failed its integrity check and was not delivered.', code: 'INTEGRITY_FAILED' });
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'DOCUMENT_DOWNLOADED', entityType: 'ORGANIZATION', entityId: row.organization_id, details: { documentId: row.id }, ...meta(request) });
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="${row.filename.replace(/"/g, '')}.pdf"`).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'private, no-store').send(data);
  });

  app.put('/:id/review', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ status: z.enum(['ACCEPTED', 'REJECTED']), note: z.string().trim().max(500).optional() }).safeParse(request.body);
    if (!parsed.success || (parsed.data.status === 'REJECTED' && (parsed.data.note || '').length < 5)) return reply.status(400).send({ error: 'Accept it, or reject it with a reason of at least 5 characters.' });
    const row = (await db.query('SELECT * FROM organization_documents WHERE id = $1', [(request.params as any).id])).rows[0];
    if (!row || row.status === 'SUPERSEDED') return reply.status(404).send({ error: 'Document not found' });
    await db.query(`UPDATE organization_documents SET status = $1, review_note = $2, reviewed_by_user_id = $3, reviewed_at = CURRENT_TIMESTAMP WHERE id = $4`, [parsed.data.status, parsed.data.note ?? null, authReq.user.userId, row.id]);
    await db.query(`INSERT INTO notifications (id, user_id, title, message, priority, action_link) SELECT 'NTF-' || $1::text || '-' || u.id, u.id, $2::text, $3::text, 'INFO', '/startup/profile' FROM users u WHERE u.organization_id = $4`,
      [row.id, parsed.data.status === 'ACCEPTED' ? 'Document accepted' : 'Document needs attention', `${DOC_LABELS[row.doc_type]}: ${parsed.data.status === 'ACCEPTED' ? 'accepted.' : parsed.data.note}`, row.organization_id]);
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'admin', action: `DOCUMENT_${parsed.data.status}`, entityType: 'ORGANIZATION', entityId: row.organization_id, details: { documentId: row.id }, ...meta(request) });
    return reply.send({ success: true });
  });
}
