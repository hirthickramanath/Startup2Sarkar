import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DatabaseAdapter } from '../db';
import { AuditService } from '../audit';
import { AuthenticatedRequest, createAuthMiddleware, requireRole } from '../security';
import { getPilotReportData, pilotReportToCsv, pilotReportToPdf } from '../reports';

const submitKpiEvidenceSchema = z.object({
  reportedValue: z.string().min(1),
  evidenceFileId: z.string().optional(),
  evidenceNotes: z.string().min(5)
});

const verifyKpiSchema = z.object({
  verificationStatus: z.enum(['VERIFIED', 'PARTIALLY_VERIFIED', 'REJECTED', 'REQUIRES_EVIDENCE']),
  inspectorNotes: z.string().min(5)
});

const createInspectionSchema = z.object({
  checklistResults: z.record(z.string(), z.enum(['PASS', 'FAIL', 'NEEDS_REVIEW'])),
  findings: z.string().min(10),
  gpsLatitude: z.number().optional(),
  gpsLongitude: z.number().optional(),
  gpsAddress: z.string().optional(),
  observationPhotos: z.array(z.string()).default([]),
  validationStatus: z.enum(['VERIFIED', 'PARTIALLY_VERIFIED', 'REQUIRES_FURTHER_EVIDENCE', 'NOT_VERIFIED']),
  scaleupEvidenceNotes: z.string().optional()
});


type PilotAccess = { pilot: any } | { status: number; error: string };

/** Single source of truth for "may this user touch this pilot?" — used by every pilot endpoint. */
async function getAuthorizedPilot(db: DatabaseAdapter, user: AuthenticatedRequest['user'], id: string, mode: 'read' | 'inspect' | 'startup-write' | 'gov-write'): Promise<PilotAccess> {
  const res = await db.query('SELECT * FROM pilots WHERE id = $1', [id]);
  const pilot = res.rows[0];
  if (!pilot) return { status: 404, error: 'Pilot not found' };
  const deny: PilotAccess = { status: 403, error: 'Forbidden: you are not authorised for this pilot' };
  switch (user.role) {
    case 'admin': return { pilot };
    case 'startup': return pilot.organization_id === user.organizationId && (mode === 'read' || mode === 'startup-write') ? { pilot } : deny;
    case 'government': return (!user.departmentId || pilot.department_id === user.departmentId) && (mode === 'read' || mode === 'gov-write') ? { pilot } : deny;
    case 'inspector': return pilot.assigned_inspector_id === user.userId && (mode === 'read' || mode === 'inspect') ? { pilot } : deny;
    case 'finance': return mode === 'read' ? { pilot } : deny;
    default: return deny;
  }
}

export async function pilotRoutes(app: FastifyInstance, opts: { db: DatabaseAdapter; auditService: AuditService }) {
  const { db, auditService } = opts;
  const authenticate = createAuthMiddleware(db);

  // 1. List Pilots (Role-Filtered)
  app.get('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    let sql = `SELECT pilots.*, iu.name AS assigned_inspector_name FROM pilots LEFT JOIN users iu ON iu.id = pilots.assigned_inspector_id`;
    const params: any[] = [];
    const conditions: string[] = [];

    if (authReq.user.role === 'startup') {
      conditions.push(`pilots.organization_id = $${params.length + 1}`);
      params.push(authReq.user.organizationId);
    } else if (authReq.user.role === 'government' && authReq.user.departmentId) {
      conditions.push(`pilots.department_id = $${params.length + 1}`);
      params.push(authReq.user.departmentId);
    } else if (authReq.user.role === 'inspector') {
      conditions.push(`pilots.assigned_inspector_id = $${params.length + 1}`);
      params.push(authReq.user.userId);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY pilots.created_at DESC';

    const res = await db.query(sql, params);
    return reply.send({ data: res.rows });
  });

  // 2. Pilot Detail Docket
  app.get('/:id', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const access = await getAuthorizedPilot(db, (request as AuthenticatedRequest).user, id, 'read');
    if (!('pilot' in access)) return reply.status(access.status).send({ error: access.error });
    const pilot = { ...access.pilot, assigned_inspector_name: (await db.query('SELECT name FROM users WHERE id = $1', [access.pilot.assigned_inspector_id])).rows[0]?.name ?? null };

    // Fetch related sub-entities
    const [milestonesRes, kpisRes, inspectionsRes, risksRes] = await Promise.all([
      db.query('SELECT * FROM pilot_milestones WHERE pilot_id = $1 ORDER BY due_date ASC', [id]),
      db.query(`SELECT k.*, (SELECT reported_value FROM kpi_submissions s WHERE s.kpi_id = k.id ORDER BY version_number DESC LIMIT 1) AS latest_reported,
                       (SELECT verification_status FROM kpi_submissions s WHERE s.kpi_id = k.id ORDER BY version_number DESC LIMIT 1) AS latest_verification,
                       (SELECT version_number FROM kpi_submissions s WHERE s.kpi_id = k.id ORDER BY version_number DESC LIMIT 1) AS latest_version
                FROM pilot_kpis k WHERE k.pilot_id = $1 ORDER BY k.created_at ASC`, [id]),
      db.query('SELECT * FROM pilot_inspections WHERE pilot_id = $1 ORDER BY created_at DESC', [id]),
      db.query('SELECT * FROM risks WHERE pilot_id = $1 ORDER BY created_at DESC', [id])
    ]);

    return reply.send({
      pilot,
      milestones: milestonesRes.rows,
      kpis: kpisRes.rows,
      inspections: inspectionsRes.rows,
      risks: risksRes.rows
    });
  });

  // 3. Submit Versioned KPI Evidence (Startup)
  app.post('/:id/kpis/:kpiId/evidence', { preHandler: [authenticate, requireRole('startup')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, kpiId } = request.params as { id: string; kpiId: string };
    const authReq = request as AuthenticatedRequest;

    const parseResult = submitKpiEvidenceSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }
    const data = parseResult.data;

    const access = await getAuthorizedPilot(db, authReq.user, id, 'startup-write');
    if (!('pilot' in access)) return reply.status(access.status).send({ error: access.error });
    if (['TERMINATED', 'FINANCE_PENDING', 'VALIDATED'].includes(access.pilot.status)) {
      return reply.status(409).send({ error: `Evidence cannot be added while the pilot is ${access.pilot.status}` });
    }
    const kpiRow = await db.query('SELECT id FROM pilot_kpis WHERE id = $1 AND pilot_id = $2', [kpiId, id]);
    if (kpiRow.rows.length === 0) return reply.status(404).send({ error: 'KPI not found on this pilot' });

    // Get current version number
    const verRes = await db.query(
      'SELECT COALESCE(MAX(version_number), 0) + 1 as next_ver FROM kpi_submissions WHERE kpi_id = $1',
      [kpiId]
    );
    const nextVer = parseInt(verRes.rows[0].next_ver, 10);
    const subId = `KPISUB-${Date.now()}-${nextVer}`;

    await db.transaction(async (tx) => {
      // Insert immutable versioned submission
      await tx.query(
        `INSERT INTO kpi_submissions (
          id, kpi_id, pilot_id, version_number, reported_value, evidence_file_id,
          evidence_notes, submitted_by_user_id, verification_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING')`,
        [subId, kpiId, id, nextVer, data.reportedValue, data.evidenceFileId || null, data.evidenceNotes, authReq.user.userId]
      );

      // Update current value on KPI record (unverified until the inspector confirms)
      await tx.query(
        `UPDATE pilot_kpis SET current_value = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [data.reportedValue, kpiId]
      );
      if (access.pilot.status === 'LAUNCHED') {
        await tx.query(`UPDATE pilots SET status = 'IN_PROGRESS', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
      }
    });

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: 'startup',
      action: 'KPI_EVIDENCE_SUBMITTED_NEW_VERSION',
      entityType: 'KPI',
      entityId: kpiId,
      details: { pilotId: id, versionNumber: nextVer, reportedValue: data.reportedValue },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.status(201).send({
      success: true,
      submissionId: subId,
      versionNumber: nextVer,
      message: `KPI evidence version ${nextVer} recorded successfully. Historical submissions preserved.`
    });
  });

  // 4. Inspector KPI Verification
  app.post('/:id/kpis/:kpiId/verify', { preHandler: [authenticate, requireRole('inspector', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, kpiId } = request.params as { id: string; kpiId: string };
    const authReq = request as AuthenticatedRequest;

    const parseResult = verifyKpiSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }
    const data = parseResult.data;

    const access = await getAuthorizedPilot(db, authReq.user, id, 'inspect');
    if (!('pilot' in access)) return reply.status(access.status).send({ error: access.error });
    const hasSub = await db.query('SELECT id FROM kpi_submissions WHERE kpi_id = $1 AND pilot_id = $2 LIMIT 1', [kpiId, id]);
    if (hasSub.rows.length === 0) return reply.status(409).send({ error: 'The startup has not submitted evidence for this KPI yet' });

    // Update latest submission
    await db.query(
      `UPDATE kpi_submissions
       SET verification_status = $1, inspector_notes = $2,
           verified_by_user_id = $3, verified_at = CURRENT_TIMESTAMP
       WHERE id = (
         SELECT id FROM kpi_submissions WHERE kpi_id = $4 ORDER BY version_number DESC LIMIT 1
       )`,
      [data.verificationStatus, data.inspectorNotes, authReq.user.userId, kpiId]
    );

    // Update KPI status
    const newKpiStatus = data.verificationStatus === 'VERIFIED' ? 'ACHIEVED' : 'AT_RISK';
    await db.query('UPDATE pilot_kpis SET status = $1 WHERE id = $2', [newKpiStatus, kpiId]);

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: authReq.user.role,
      action: 'KPI_VERIFIED_BY_INSPECTOR',
      entityType: 'KPI',
      entityId: kpiId,
      details: { verificationStatus: data.verificationStatus, inspectorNotes: data.inspectorNotes },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.send({ success: true, message: `KPI verification status updated to '${data.verificationStatus}'.` });
  });

  // 5. Inspector Physical Pilot Inspection Docket
  app.post('/:id/inspections', { preHandler: [authenticate, requireRole('inspector', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;

    const parseResult = createInspectionSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }
    const data = parseResult.data;
    const access = await getAuthorizedPilot(db, authReq.user, id, 'inspect');
    if (!('pilot' in access)) return reply.status(access.status).send({ error: access.error });
    const inspId = `INSP-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 100)}`;

    await db.query(
      `INSERT INTO pilot_inspections (
        id, pilot_id, inspector_id, scheduled_date, completed_date,
        checklist_results, findings, gps_latitude, gps_longitude, gps_address,
        observation_photos, validation_status, scaleup_evidence_notes
      ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        inspId, id, authReq.user.userId,
        JSON.stringify(data.checklistResults),
        data.findings,
        data.gpsLatitude || 28.6139, // Default to Delhi if omitted
        data.gpsLongitude || 77.2090,
        data.gpsAddress || 'Field Inspection Site',
        JSON.stringify(data.observationPhotos),
        data.validationStatus,
        data.scaleupEvidenceNotes || null
      ]
    );

    // Pilot status follows the inspector's verdict
    if (data.validationStatus === 'VERIFIED') {
      await db.query(`UPDATE pilots SET status = 'VALIDATED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
    } else if (['LAUNCHED', 'IN_PROGRESS'].includes(access.pilot.status)) {
      await db.query(`UPDATE pilots SET status = 'UNDER_INSPECTION', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
    }
    await db.query(
      `INSERT INTO notifications (id, role, title, message, priority, action_link)
       VALUES ($1, 'government', $2, $3, 'INFO', $4)`,
      [`NTF-${Date.now()}-${Math.floor(Math.random() * 1000)}`, 'Field inspection filed', `Inspector verdict for ${access.pilot.name}: ${data.validationStatus.replace(/_/g, ' ')}`, `/government/pilots/${id}`]
    );

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: authReq.user.role,
      action: 'INSPECTION_DOCKET_FILED',
      entityType: 'INSPECTION',
      entityId: inspId,
      details: { pilotId: id, validationStatus: data.validationStatus },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.status(201).send({
      success: true,
      inspectionId: inspId,
      message: 'Field inspection docket and GPS observations logged successfully.'
    });
  });

  // 6. Submit Validated Pilot to Finance (Spec Section 17)
  app.post('/:id/submit-to-finance', { preHandler: [authenticate, requireRole('government', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;

    const access = await getAuthorizedPilot(db, authReq.user, id, 'gov-write');
    if (!('pilot' in access)) return reply.status(access.status).send({ error: access.error });
    const pilot = access.pilot;

    // Check inspection verification exists
    const inspRes = await db.query(
      `SELECT id FROM pilot_inspections WHERE pilot_id = $1 AND validation_status IN ('VERIFIED', 'PARTIALLY_VERIFIED')`,
      [id]
    );

    if (inspRes.rows.length === 0) {
      return reply.status(400).send({
        error: 'Statutory Finance Barrier: Pilot cannot be submitted to Finance without an accredited Inspector Field Verification Docket.'
      });
    }

    await db.query(`UPDATE pilots SET status = 'FINANCE_PENDING', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: authReq.user.role,
      action: 'PILOT_SUBMITTED_TO_FINANCE',
      entityType: 'PILOT',
      entityId: id,
      details: { contractValuePaise: pilot.contract_value_paise },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.send({
      success: true,
      message: 'Pilot outcome and evidence dossier transmitted to Finance for treasury payment review.'
    });
  });

  // 7. Pilot Report (Spec Section 16: 12-section Final Pilot Report - JSON, CSV, PDF)
  app.get('/:id/report', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    { const access = await getAuthorizedPilot(db, (request as AuthenticatedRequest).user, id, 'read'); if (!('pilot' in access)) return reply.status(access.status).send({ error: access.error }); }
    const { format } = request.query as { format?: string };

    const reportData = await getPilotReportData(db, id);
    if (!reportData) {
      return reply.status(404).send({ error: 'Pilot not found' });
    }

    if (format === 'csv') {
      const csv = pilotReportToCsv(reportData);
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="pilot-report-${id}.csv"`)
        .send(csv);
    }

    if (format === 'pdf') {
      const pdf = pilotReportToPdf(reportData);
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="pilot-report-${id}.pdf"`)
        .send(pdf);
    }

    return reply.send({ report: reportData });
  });

  app.get('/:id/report.csv', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    { const access = await getAuthorizedPilot(db, (request as AuthenticatedRequest).user, id, 'read'); if (!('pilot' in access)) return reply.status(access.status).send({ error: access.error }); }
    const reportData = await getPilotReportData(db, id);
    if (!reportData) return reply.status(404).send({ error: 'Pilot not found' });
    const csv = pilotReportToCsv(reportData);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="pilot-report-${id}.csv"`)
      .send(csv);
  });

  app.get('/:id/report.pdf', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    { const access = await getAuthorizedPilot(db, (request as AuthenticatedRequest).user, id, 'read'); if (!('pilot' in access)) return reply.status(access.status).send({ error: access.error }); }
    const reportData = await getPilotReportData(db, id);
    if (!reportData) return reply.status(404).send({ error: 'Pilot not found' });
    const pdf = pilotReportToPdf(reportData);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="pilot-report-${id}.pdf"`)
      .send(pdf);
  });

  // 8. Inspectors available for assignment (government within dept, admin)
  app.get('/inspectors/available', { preHandler: [authenticate, requireRole('government', 'admin')] }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const res = await db.query(
      `SELECT u.id, u.name, u.designation,
              (SELECT COUNT(*) FROM pilots p WHERE p.assigned_inspector_id = u.id AND p.status NOT IN ('COMPLETED','TERMINATED')) AS active_pilots
       FROM users u WHERE u.role = 'inspector' AND u.is_active = TRUE ORDER BY u.name`
    );
    return reply.send({ inspectors: res.rows });
  });

  // 9. Assign / reassign the field inspector
  app.post('/:id/assign-inspector', { preHandler: [authenticate, requireRole('government', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ inspectorId: z.string().min(3) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'inspectorId is required' });
    const access = await getAuthorizedPilot(db, authReq.user, id, 'gov-write');
    if (!('pilot' in access)) return reply.status(access.status).send({ error: access.error });
    const insp = await db.query(`SELECT id, name FROM users WHERE id = $1 AND role = 'inspector' AND is_active = TRUE`, [parsed.data.inspectorId]);
    if (insp.rows.length === 0) return reply.status(400).send({ error: 'Selected user is not an active field inspector' });

    await db.query(`UPDATE pilots SET assigned_inspector_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [parsed.data.inspectorId, id]);
    await db.query(
      `INSERT INTO notifications (id, user_id, title, message, priority, action_link) VALUES ($1, $2, $3, $4, 'INFO', $5)`,
      [`NTF-${Date.now()}-${Math.floor(Math.random() * 1000)}`, parsed.data.inspectorId, 'New pilot assigned', `You were assigned to inspect ${access.pilot.name}.`, `/inspector/pilots/${id}`]
    );
    await auditService.logEvent({
      actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'PILOT_INSPECTOR_ASSIGNED',
      entityType: 'PILOT', entityId: id, details: { inspectorId: parsed.data.inspectorId, inspectorName: insp.rows[0].name },
      ipAddress: request.ip || '127.0.0.1', userAgent: request.headers['user-agent'] || 'Unknown'
    });
    return reply.send({ success: true, message: `${insp.rows[0].name} assigned as field inspector.` });
  });

  // 10. Startup submits a milestone deliverable
  app.post('/:id/milestones/:msId/submit', { preHandler: [authenticate, requireRole('startup')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, msId } = request.params as { id: string; msId: string };
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ notes: z.string().min(10).max(2000) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Describe the delivered work (at least 10 characters)' });
    const access = await getAuthorizedPilot(db, authReq.user, id, 'startup-write');
    if (!('pilot' in access)) return reply.status(access.status).send({ error: access.error });
    const ms = (await db.query('SELECT * FROM pilot_milestones WHERE id = $1 AND pilot_id = $2', [msId, id])).rows[0];
    if (!ms) return reply.status(404).send({ error: 'Milestone not found on this pilot' });
    if (!['PENDING', 'RETURNED'].includes(ms.status)) return reply.status(409).send({ error: `Milestone is already ${ms.status}` });

    await db.query(`UPDATE pilot_milestones SET status = 'SUBMITTED', deliverable_description = $1, submitted_at = CURRENT_TIMESTAMP WHERE id = $2`, [parsed.data.notes, msId]);
    if (access.pilot.status === 'LAUNCHED') await db.query(`UPDATE pilots SET status = 'IN_PROGRESS' WHERE id = $1`, [id]);
    if (access.pilot.assigned_inspector_id) {
      await db.query(`INSERT INTO notifications (id, user_id, title, message, priority, action_link) VALUES ($1, $2, $3, $4, 'INFO', $5)`,
        [`NTF-${Date.now()}-${Math.floor(Math.random() * 1000)}`, access.pilot.assigned_inspector_id, 'Milestone awaiting verification', `${ms.title} was submitted for ${access.pilot.name}.`, `/inspector/pilots/${id}`]);
    }
    await auditService.logEvent({
      actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'startup', action: 'MILESTONE_SUBMITTED',
      entityType: 'MILESTONE', entityId: msId, details: { pilotId: id },
      ipAddress: request.ip || '127.0.0.1', userAgent: request.headers['user-agent'] || 'Unknown'
    });
    return reply.send({ success: true, message: 'Milestone submitted for inspector verification.' });
  });

  // 11. Inspector verifies (or returns) a submitted milestone — this unlocks the payment claim
  app.post('/:id/milestones/:msId/verify', { preHandler: [authenticate, requireRole('inspector', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, msId } = request.params as { id: string; msId: string };
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ decision: z.enum(['VERIFIED', 'RETURNED']), notes: z.string().min(5).max(2000) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Provide a decision (VERIFIED or RETURNED) and notes of at least 5 characters' });
    const access = await getAuthorizedPilot(db, authReq.user, id, 'inspect');
    if (!('pilot' in access)) return reply.status(access.status).send({ error: access.error });
    const ms = (await db.query('SELECT * FROM pilot_milestones WHERE id = $1 AND pilot_id = $2', [msId, id])).rows[0];
    if (!ms) return reply.status(404).send({ error: 'Milestone not found on this pilot' });
    if (ms.status !== 'SUBMITTED' && ms.status !== 'UNDER_REVIEW') return reply.status(409).send({ error: `Only submitted milestones can be verified (current: ${ms.status})` });

    await db.query(`UPDATE pilot_milestones SET status = $1, verified_at = CASE WHEN $1 = 'VERIFIED' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = $2`, [parsed.data.decision, msId]);
    await db.query(`INSERT INTO notifications (id, user_id, title, message, priority, action_link) SELECT $1, u.id, $2, $3, 'INFO', $4 FROM users u WHERE u.organization_id = $5`,
      [`NTF-${Date.now()}-${Math.floor(Math.random() * 1000)}`, parsed.data.decision === 'VERIFIED' ? 'Milestone verified — you can raise a payment claim' : 'Milestone returned for rework', `${ms.title}: ${parsed.data.notes}`, `/startup/pilots/${id}`, access.pilot.organization_id]);
    await auditService.logEvent({
      actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: `MILESTONE_${parsed.data.decision}`,
      entityType: 'MILESTONE', entityId: msId, details: { pilotId: id, notes: parsed.data.notes },
      ipAddress: request.ip || '127.0.0.1', userAgent: request.headers['user-agent'] || 'Unknown'
    });
    return reply.send({ success: true });
  });

  // 12. Operational risk register (inspector of the pilot, or admin)
  app.post('/:id/risks', { preHandler: [authenticate, requireRole('inspector', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({
      category: z.enum(['TECHNICAL', 'OPERATIONAL', 'FINANCIAL', 'CYBERSECURITY', 'DATA', 'SCALABILITY']),
      description: z.string().min(10).max(1000),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
      mitigation: z.string().max(1000).optional(),
      owner: z.string().max(200).optional(),
      evidence: z.string().max(1000).optional()
    }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Provide a category, severity and a description of at least 10 characters', details: parsed.error.format() });
    const access = await getAuthorizedPilot(db, authReq.user, id, 'inspect');
    if (!('pilot' in access)) return reply.status(access.status).send({ error: access.error });
    const d = parsed.data;
    const riskId = `RSK-${Date.now().toString().slice(-7)}-${Math.floor(Math.random() * 100)}`;
    await db.query(
      `INSERT INTO risks (id, pilot_id, category, description, severity, evidence, mitigation, owner) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [riskId, id, d.category, d.description, d.severity, d.evidence || null, d.mitigation || null, d.owner || null]
    );
    await auditService.logEvent({
      actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'RISK_REGISTERED',
      entityType: 'RISK', entityId: riskId, details: { pilotId: id, severity: d.severity, category: d.category },
      ipAddress: request.ip || '127.0.0.1', userAgent: request.headers['user-agent'] || 'Unknown'
    });
    return reply.status(201).send({ success: true, riskId });
  });

  app.put('/:id/risks/:riskId', { preHandler: [authenticate, requireRole('inspector', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, riskId } = request.params as { id: string; riskId: string };
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ status: z.enum(['OPEN', 'MITIGATED', 'CLOSED']), mitigation: z.string().max(1000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid risk update' });
    const access = await getAuthorizedPilot(db, authReq.user, id, 'inspect');
    if (!('pilot' in access)) return reply.status(access.status).send({ error: access.error });
    const res = await db.query(`UPDATE risks SET status = $1, mitigation = COALESCE($2, mitigation), updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND pilot_id = $4 RETURNING id`, [parsed.data.status, parsed.data.mitigation ?? null, riskId, id]);
    if (res.rows.length === 0) return reply.status(404).send({ error: 'Risk not found on this pilot' });
    await auditService.logEvent({
      actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: `RISK_${parsed.data.status}`,
      entityType: 'RISK', entityId: riskId, details: { pilotId: id }, ipAddress: request.ip || '127.0.0.1', userAgent: request.headers['user-agent'] || 'Unknown'
    });
    return reply.send({ success: true });
  });
}
