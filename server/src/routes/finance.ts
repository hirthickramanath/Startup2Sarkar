import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DatabaseAdapter } from '../db';
import { computeDeductions, loadTaxSettings } from '../tax';
import { AuditService } from '../audit';
import { TreasuryProvider } from '../adapters';
import { AiProvider } from '../ai';
import { AuthenticatedRequest, createAuthMiddleware, requireRole } from '../security';
import { getFinanceCaseFileData, financeCaseFileToCsv, financeCaseFileToPdf, claimsListToCsv, budgetLedgerToCsv } from '../reports';

const submitClaimSchema = z.object({
  pilotId: z.string(),
  milestoneId: z.string(),
  invoiceNumber: z.string().min(3),
  invoiceDate: z.string(),
  grossAmountPaise: z.number().int().min(100)
});

const approveClaimSchema = z.object({
  remarks: z.string().min(5)
});

const disburseClaimSchema = z.object({
  disbursementReference: z.string().min(8) // Mandatory Bank Reference / UTR number!
});

export async function financeRoutes(
  app: FastifyInstance,
  opts: {
    db: DatabaseAdapter;
    auditService: AuditService;
    treasuryProvider: TreasuryProvider;
    aiProvider: AiProvider;
  }
) {
  const { db, auditService, treasuryProvider, aiProvider } = opts;
  const authenticate = createAuthMiddleware(db);

  // 1. Finance Treasury Dashboard Overview (Integer Paise, Spec Section 46)
  app.get('/dashboard', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const budgetRes = await db.query(`
      SELECT
        COALESCE(SUM(budget_allocated_paise), 0) as total_allocated,
        COALESCE(SUM(budget_committed_paise), 0) as total_committed,
        COALESCE(SUM(budget_disbursed_paise), 0) as total_disbursed
      FROM departments
    `);

    const allocated = BigInt(budgetRes.rows[0].total_allocated);
    const committed = BigInt(budgetRes.rows[0].total_committed);
    const disbursed = BigInt(budgetRes.rows[0].total_disbursed);
    // Available = Allocated − Committed (approved, unpaid) − Disbursed (already paid). Neither is free to spend again.
    const available = allocated - committed - disbursed;

    const [claimsRes, anomaliesRes, stalledRes] = await Promise.all([
      db.query(`SELECT COUNT(*) as pending_count FROM finance_payment_claims WHERE status IN ('SUBMITTED', 'UNDER_REVIEW', 'FINANCE_REVIEW')`),
      db.query(`SELECT COUNT(*) as anomaly_count FROM finance_anomalies WHERE status = 'DETECTED'`),
      db.query(`SELECT COUNT(*) as stalled_count, COALESCE(SUM(amount_recoverable_paise), 0) as total_exposure FROM stalled_pilots WHERE status != 'RESOLVED'`)
    ]);

    return reply.send({
      treasury: {
        totalAllocatedPaise: allocated.toString(),
        totalCommittedPaise: committed.toString(),
        totalDisbursedPaise: disbursed.toString(),
        totalAvailablePaise: available.toString(),
        totalAllocatedRupees: Number(allocated / 100n),
        totalCommittedRupees: Number(committed / 100n),
        totalDisbursedRupees: Number(disbursed / 100n),
        totalAvailableRupees: Number(available / 100n)
      },
      stats: {
        pendingClaimsCount: parseInt(claimsRes.rows[0].pending_count, 10),
        activeAnomaliesCount: parseInt(anomaliesRes.rows[0].anomaly_count, 10),
        stalledPilotsCount: parseInt(stalledRes.rows[0].stalled_count, 10),
        stalledExposurePaise: stalledRes.rows[0].total_exposure.toString()
      }
    });
  });

  // 2. Department Budget Ledger (Spec Section 47)
  app.get('/budget', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const res = await db.query(`
      SELECT id, name, code, ministry,
             budget_allocated_paise, budget_committed_paise, budget_disbursed_paise,
             (budget_allocated_paise - budget_committed_paise - budget_disbursed_paise) as budget_available_paise,
             CASE
               WHEN budget_allocated_paise = 0 THEN 0
               ELSE ROUND((budget_committed_paise::numeric / budget_allocated_paise::numeric) * 100, 1)
             END as utilization_percent
      FROM departments
      ORDER BY name ASC
    `);

    return reply.send({ departments: res.rows });
  });

  // 3. Payment Claims List
  app.get('/payments', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const query = request.query as any;

    let sql = `
      SELECT fpc.*,
             p.name as pilot_name, pm.title as milestone_title,
             o.name as startup_name, d.name as department_name
      FROM finance_payment_claims fpc
      JOIN pilots p ON fpc.pilot_id = p.id
      JOIN pilot_milestones pm ON fpc.milestone_id = pm.id
      JOIN organizations o ON fpc.organization_id = o.id
      JOIN departments d ON fpc.department_id = d.id
    `;
    const params: any[] = [];
    const conditions: string[] = [];

    if (authReq.user.role === 'inspector') {
      return reply.status(403).send({ error: 'Forbidden: payment data is not available to field inspectors' });
    }
    if (authReq.user.role === 'government' && authReq.user.departmentId) {
      conditions.push(`fpc.department_id = $${params.length + 1}`);
      params.push(authReq.user.departmentId);
    }
    // Startup sees only their own claims
    if (authReq.user.role === 'startup') {
      conditions.push(`fpc.organization_id = $${params.length + 1}`);
      params.push(authReq.user.organizationId);
    }

    if (query.status) {
      conditions.push(`fpc.status = $${params.length + 1}`);
      params.push(query.status);
    }

    if (query.departmentId) {
      conditions.push(`fpc.department_id = $${params.length + 1}`);
      params.push(query.departmentId);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY fpc.created_at DESC';

    const res = await db.query(sql, params);
    return reply.send({ data: res.rows });
  });

  // 4. Submit Payment Claim (Startup)
  app.post('/payments', { preHandler: [authenticate, requireRole('startup')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const parseResult = submitClaimSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }
    const data = parseResult.data;

    // Verify milestone exists and is under this pilot
    const msRes = await db.query(
      `SELECT pm.*, p.organization_id, p.department_id, p.contract_value_paise
       FROM pilot_milestones pm
       JOIN pilots p ON pm.pilot_id = p.id
       WHERE pm.id = $1 AND p.id = $2`,
      [data.milestoneId, data.pilotId]
    );

    if (msRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Milestone or Pilot record not found' });
    }
    const ms = msRes.rows[0];

    if (ms.organization_id !== authReq.user.organizationId) {
      return reply.status(403).send({ error: 'Forbidden: You cannot claim payments for other startups.' });
    }
    if (!['VERIFIED', 'APPROVED'].includes(ms.status)) {
      return reply.status(409).send({ error: 'A payment claim can only be raised after the inspector has verified this milestone.', code: 'MILESTONE_NOT_VERIFIED' });
    }
    if (BigInt(data.grossAmountPaise) > BigInt(ms.amount_paise)) {
      return reply.status(400).send({ error: 'Claim exceeds the milestone amount agreed in the contract.', code: 'EXCEEDS_MILESTONE_AMOUNT' });
    }
    const activeClaim = await db.query(`SELECT id FROM finance_payment_claims WHERE milestone_id = $1 AND status NOT IN ('REJECTED')`, [data.milestoneId]);
    if (activeClaim.rows.length > 0) {
      return reply.status(409).send({ error: `A claim (${activeClaim.rows[0].id}) already exists for this milestone.`, code: 'CLAIM_EXISTS' });
    }

    // Spec Section 55: statutory deductions, deterministic integer-paise math (see tax.ts)
    const grossPaise = BigInt(data.grossAmountPaise);
    const taxSettings = await loadTaxSettings(db);
    let deductions;
    try {
      deductions = computeDeductions({
        grossPaise,
        contractValuePaise: BigInt(ms.contract_value_paise || 0),
        settings: taxSettings
      });
    } catch (e: any) {
      return reply.status(400).send({ error: e.message, code: 'INVALID_DEDUCTION' });
    }
    const { tdsPaise, gstTdsPaise: gstPaise, penaltyPaise, netPayablePaise } = deductions;

    const claimId = `PAY-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;

    await db.transaction(async (tx) => {
      // 1. Create payment claim
      await tx.query(
        `INSERT INTO finance_payment_claims (
          id, pilot_id, milestone_id, organization_id, department_id,
          invoice_number, invoice_date, gross_amount_paise, tds_paise,
          gst_paise, penalty_deduction_paise, net_payable_paise,
          status, requester_user_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'SUBMITTED', $13)`,
        [
          claimId, data.pilotId, data.milestoneId, ms.organization_id, ms.department_id,
          data.invoiceNumber, new Date(data.invoiceDate).toISOString(),
          grossPaise.toString(), tdsPaise.toString(), gstPaise.toString(), penaltyPaise.toString(),
          netPayablePaise.toString(), authReq.user.userId
        ]
      );

      // 2. Check for duplicate invoice anomaly
      const dupRes = await tx.query(
        `SELECT id FROM finance_payment_claims WHERE invoice_number = $1 AND id != $2`,
        [data.invoiceNumber, claimId]
      );
      if (dupRes.rows.length > 0) {
        await tx.query(
          `INSERT INTO finance_anomalies (id, claim_id, pilot_id, anomaly_type, severity, description, status)
           VALUES ($1, $2, $3, 'DUPLICATE_INVOICE', 'HIGH', $4, 'DETECTED')`,
          [
            `ANOM-${Date.now()}`, claimId, data.pilotId,
            `Duplicate Invoice Number detected: '${data.invoiceNumber}' matches existing claim ${dupRes.rows[0].id}`
          ]
        );
      }
    });

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: 'startup',
      action: 'PAYMENT_CLAIM_SUBMITTED',
      entityType: 'PAYMENT_CLAIM',
      entityId: claimId,
      details: {
        grossPaise: grossPaise.toString(),
        netPayablePaise: netPayablePaise.toString(),
        invoiceNumber: data.invoiceNumber
      },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.status(201).send({
      success: true,
      claimId,
      grossAmountPaise: grossPaise.toString(),
      tdsPaise: tdsPaise.toString(),
      gstTdsPaise: gstPaise.toString(),
      netPayablePaise: netPayablePaise.toString(),
      message: 'Payment claim registered. Statutory TDS and GST withholding calculated.'
    });
  });

  // 5. Maker-Checker Payment Approval (Finance Officer, Spec Section 47 & 65)
  app.post('/payments/:id/approve', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;
    const { remarks } = (request.body || {}) as { remarks?: string };

    const claimRes = await db.query(
      `SELECT fpc.*, d.budget_allocated_paise, d.budget_committed_paise, d.budget_disbursed_paise
       FROM finance_payment_claims fpc
       JOIN departments d ON fpc.department_id = d.id
       WHERE fpc.id = $1`,
      [id]
    );

    if (claimRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Payment claim not found' });
    }
    const claim = claimRes.rows[0];

    if (!['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_PENDING', 'FINANCE_REVIEW'].includes(claim.status)) {
      return reply.status(409).send({ error: `A claim in status '${claim.status}' cannot be approved.`, code: 'INVALID_CLAIM_STATE' });
    }
    if (!remarks || remarks.trim().length < 5) {
      return reply.status(400).send({ error: 'Approval remarks (min 5 characters) are mandatory.' });
    }

    // Maker-Checker Check: Approver cannot be the user who submitted or created the request!
    if (claim.requester_user_id === authReq.user.userId) {
      return reply.status(403).send({
        error: 'Statutory Maker-Checker Control Violation: Approver cannot be the same individual who initiated the payment claim.',
        code: 'MAKER_CHECKER_VIOLATION'
      });
    }

    // Budget Availability Check: Spec Section 47
    // Ensure available budget (allocated − committed − disbursed) is sufficient for this commitment!
    const allocated = BigInt(claim.budget_allocated_paise);
    const committed = BigInt(claim.budget_committed_paise);
    const available = allocated - committed - BigInt(claim.budget_disbursed_paise);
    const netPayable = BigInt(claim.net_payable_paise);

    if (available < netPayable) {
      return reply.status(400).send({
        error: 'INSUFFICIENT AVAILABLE BUDGET: The department does not possess sufficient uncommitted treasury headroom to authorize this disbursement.',
        code: 'INSUFFICIENT_AVAILABLE_BUDGET',
        details: {
          availablePaise: available.toString(),
          requiredPaise: netPayable.toString()
        }
      });
    }

    // Check for unresolved blocking anomalies
    const anomRes = await db.query(
      `SELECT id, anomaly_type, severity FROM finance_anomalies WHERE claim_id = $1 AND status = 'DETECTED' AND severity IN ('HIGH', 'CRITICAL')`,
      [id]
    );

    if (anomRes.rows.length > 0) {
      return reply.status(400).send({
        error: `Cannot approve payment: ${anomRes.rows.length} critical anomaly/anomalies pending human resolution.`,
        code: 'BLOCKING_ANOMALY_PENDING'
      });
    }

    await db.transaction(async (tx) => {
      // 1. Update claim status to APPROVED
      await tx.query(
        `UPDATE finance_payment_claims
         SET status = 'APPROVED', approver_user_id = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [authReq.user.userId, id]
      );

      // 2. Commit funds in department treasury ledger
      await tx.query(
        `UPDATE departments
         SET budget_committed_paise = budget_committed_paise + $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [claim.gross_amount_paise, claim.department_id]
      );
    });

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: authReq.user.role,
      action: 'PAYMENT_CLAIM_APPROVED_BY_FINANCE',
      entityType: 'PAYMENT_CLAIM',
      entityId: id,
      details: {
        approverId: authReq.user.userId,
        netPayablePaise: claim.net_payable_paise,
        remarks: remarks || 'Approved per treasury verification'
      },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.send({
      success: true,
      message: 'Payment claim authorized by Finance. Funds committed in treasury. Ready for bank disbursement recording.'
    });
  });

  // 6. Record Disbursement with Mandatory Bank Reference / UTR Number (Spec Section 68)
  app.post('/payments/:id/disburse', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;

    const parseResult = disburseClaimSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'A valid Bank Reference / UTR Number is mandatory.', details: parseResult.error.format() });
    }
    const { disbursementReference } = parseResult.data;

    const claimRes = await db.query(
      `SELECT fpc.*, o.bank_account_masked, o.ifsc_code
       FROM finance_payment_claims fpc
       JOIN organizations o ON fpc.organization_id = o.id
       WHERE fpc.id = $1`,
      [id]
    );

    if (claimRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Payment claim not found' });
    }
    const claim = claimRes.rows[0];

    if (claim.status !== 'APPROVED') {
      return reply.status(400).send({ error: `Cannot disburse payment in status '${claim.status}'. Must be APPROVED first.` });
    }

    // Call Treasury Provider
    const disburseResult = await treasuryProvider.recordDisbursement({
      claimId: id,
      pilotId: claim.pilot_id,
      milestoneId: claim.milestone_id,
      organizationId: claim.organization_id,
      departmentId: claim.department_id,
      netPayablePaise: BigInt(claim.net_payable_paise),
      bankAccountMasked: claim.bank_account_masked,
      ifscCode: claim.ifsc_code,
      disbursementReference,
      disbursedByUserId: authReq.user.userId
    });

    await db.transaction(async (tx) => {
      // 1. Mark claim as PAID
      await tx.query(
        `UPDATE finance_payment_claims
         SET status = 'PAID', disbursement_reference = $1, disbursed_at = $2,
             disbursed_by_user_id = $3, updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [disburseResult.referenceNumber, disburseResult.disbursedAt, authReq.user.userId, id]
      );

      // 2. Mark milestone as PAID
      await tx.query(
        `UPDATE pilot_milestones SET status = 'PAID', paid_at = $1 WHERE id = $2`,
        [disburseResult.disbursedAt, claim.milestone_id]
      );

      // 3. Move funds from committed to disbursed in Department Ledger
      await tx.query(
        `UPDATE departments
         SET budget_committed_paise = budget_committed_paise - $1,
             budget_disbursed_paise = budget_disbursed_paise + $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [claim.gross_amount_paise, claim.department_id]
      );
    });

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: authReq.user.role,
      action: 'TREASURY_DISBURSEMENT_RECORDED',
      entityType: 'PAYMENT_CLAIM',
      entityId: id,
      details: {
        disbursementReference: disburseResult.referenceNumber,
        netPayablePaise: claim.net_payable_paise,
        disbursedAt: disburseResult.disbursedAt
      },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.send({
      success: true,
      referenceNumber: disburseResult.referenceNumber,
      message: disburseResult.message
    });
  });

  // 6b. Get Payment Claim by ID
  app.get('/payments/:id', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;

    const claimRes = await db.query(
      `SELECT fpc.*, p.name as pilot_name, pm.title as milestone_title,
              o.name as startup_name, d.name as department_name
       FROM finance_payment_claims fpc
       JOIN pilots p ON fpc.pilot_id = p.id
       JOIN pilot_milestones pm ON fpc.milestone_id = pm.id
       JOIN organizations o ON fpc.organization_id = o.id
       JOIN departments d ON fpc.department_id = d.id
       WHERE fpc.id = $1`,
      [id]
    );

    if (claimRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Payment claim not found' });
    }

    const claim = claimRes.rows[0];

    if (authReq.user.role === 'inspector' ||
        (authReq.user.role === 'startup' && claim.organization_id !== authReq.user.organizationId) ||
        (authReq.user.role === 'government' && authReq.user.departmentId && claim.department_id !== authReq.user.departmentId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    return reply.send({ claim });
  });

  // 7. Context-Aware Finance Copilot (Spec Section 51, 52, 53)
  app.post('/copilot', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { query, paymentClaimId } = request.body as { query: string; paymentClaimId?: string };

    let context: any = {};
    if (paymentClaimId) {
      const claimRes = await db.query(
        `SELECT fpc.*, p.name as pilot_name, o.name as startup_name
         FROM finance_payment_claims fpc
         JOIN pilots p ON fpc.pilot_id = p.id
         JOIN organizations o ON fpc.organization_id = o.id
         WHERE fpc.id = $1`,
        [paymentClaimId]
      );
      if (claimRes.rows.length > 0) {
        context.paymentClaim = claimRes.rows[0];
      }
      const anomRes = await db.query('SELECT * FROM finance_anomalies WHERE claim_id = $1', [paymentClaimId]);
      context.anomalies = anomRes.rows;
    }

    const copilotResult = await aiProvider.generateFinanceCopilot(context, query || 'Summarize this payment claim');

    return reply.send({ copilot: copilotResult });
  });

  // 8. Financial Anomalies List
  app.get('/anomalies', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const res = await db.query(`
      SELECT fa.*, p.name as pilot_name
      FROM finance_anomalies fa
      JOIN pilots p ON fa.pilot_id = p.id
      ORDER BY fa.created_at DESC
    `);
    return reply.send({ anomalies: res.rows });
  });

  // 9. Resolve Anomaly
  app.post('/anomalies/:id/resolve', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { resolutionNotes } = request.body as { resolutionNotes: string };
    const authReq = request as AuthenticatedRequest;

    if (!resolutionNotes || resolutionNotes.trim().length < 5) {
      return reply.status(400).send({ error: 'Resolution notes are mandatory.' });
    }

    const anomaly = await db.query('SELECT id, status FROM finance_anomalies WHERE id = $1', [id]);
    if (anomaly.rows.length === 0) return reply.status(404).send({ error: 'Anomaly not found' });
    if (anomaly.rows[0].status === 'RESOLVED') return reply.status(409).send({ error: 'Anomaly is already resolved' });

    await db.query(
      `UPDATE finance_anomalies
       SET status = 'RESOLVED', resolution_notes = $1, resolved_by_user_id = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [resolutionNotes, authReq.user.userId, id]
    );

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: authReq.user.role,
      action: 'FINANCE_ANOMALY_RESOLVED',
      entityType: 'ANOMALY',
      entityId: id,
      details: { resolutionNotes },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.send({ success: true, message: 'Financial anomaly marked as resolved.' });
  });

  // 10. Stalled Pilots List
  app.get('/stalled', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const res = await db.query(`
      SELECT sp.*, p.name as pilot_name, p.startup_name
      FROM stalled_pilots sp
      JOIN pilots p ON sp.pilot_id = p.id
      ORDER BY sp.stalled_date DESC
    `);
    return reply.send({ stalledPilots: res.rows });
  });

  // 11. Reports & Case Files (Spec Section 61: PDF/CSV case files and audit reports)
  app.get('/reports/claims.csv', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const claimsRes = await db.query(`
      SELECT fpc.*, p.name as pilot_name, o.name as startup_name
      FROM finance_payment_claims fpc
      JOIN pilots p ON fpc.pilot_id = p.id
      JOIN organizations o ON fpc.organization_id = o.id
      ORDER BY fpc.created_at DESC
    `);
    const csv = claimsListToCsv(claimsRes.rows);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="claims-report.csv"')
      .send(csv);
  });

  app.get('/reports/budget.csv', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const deptRes = await db.query(`
      SELECT id, name, code, ministry,
             budget_allocated_paise, budget_committed_paise, budget_disbursed_paise,
             CASE
               WHEN budget_allocated_paise = 0 THEN 0
               ELSE ROUND((budget_committed_paise::numeric / budget_allocated_paise::numeric) * 100, 1)
             END as utilization_percent
      FROM departments
      ORDER BY name ASC
    `);
    const csv = budgetLedgerToCsv(deptRes.rows);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="budget-report.csv"')
      .send(csv);
  });

  app.get('/reports/case-file/:id', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { format } = request.query as { format?: string };

    const caseFileData = await getFinanceCaseFileData(db, id);
    if (!caseFileData) {
      return reply.status(404).send({ error: 'Case file record not found' });
    }

    if (format === 'csv') {
      const csv = financeCaseFileToCsv(caseFileData);
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="case-file-${id}.csv"`)
        .send(csv);
    }

    if (format === 'pdf') {
      const pdf = financeCaseFileToPdf(caseFileData);
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="case-file-${id}.pdf"`)
        .send(pdf);
    }

    return reply.send({ caseFile: caseFileData });
  });

  app.get('/reports/case-file/:id.csv', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const caseFileData = await getFinanceCaseFileData(db, id);
    if (!caseFileData) return reply.status(404).send({ error: 'Case file record not found' });
    const csv = financeCaseFileToCsv(caseFileData);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="case-file-${id}.csv"`)
      .send(csv);
  });

  app.get('/reports/case-file/:id.pdf', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const caseFileData = await getFinanceCaseFileData(db, id);
    if (!caseFileData) return reply.status(404).send({ error: 'Case file record not found' });
    const pdf = financeCaseFileToPdf(caseFileData);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="case-file-${id}.pdf"`)
      .send(pdf);
  });

  // Place a claim on hold / reject it — both need a written reason and are audit-logged
  const holdOrReject = (kind: 'hold' | 'reject') => async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ reason: z.string().min(5).max(1000) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'A written reason (min 5 characters) is required.' });
    const claim = (await db.query('SELECT * FROM finance_payment_claims WHERE id = $1', [id])).rows[0];
    if (!claim) return reply.status(404).send({ error: 'Payment claim not found' });
    if (['PAID', 'REJECTED', 'PROCESSING'].includes(claim.status) || (kind === 'hold' && claim.status === 'ON_HOLD')) {
      return reply.status(409).send({ error: `A claim in status '${claim.status}' cannot be ${kind === 'hold' ? 'placed on hold' : 'rejected'}.` });
    }
    const wasApproved = claim.status === 'APPROVED';
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE finance_payment_claims SET status = $1, hold_reason = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`, [kind === 'hold' ? 'ON_HOLD' : 'REJECTED', parsed.data.reason, id]);
      // Approval had committed funds; release them if the claim no longer goes ahead
      if (wasApproved) await tx.query(`UPDATE departments SET budget_committed_paise = budget_committed_paise - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [claim.gross_amount_paise, claim.department_id]);
      if (kind === 'reject') await tx.query(`UPDATE pilot_milestones SET status = 'VERIFIED' WHERE id = $1 AND status <> 'PAID'`, [claim.milestone_id]);
      await tx.query(`INSERT INTO notifications (id, user_id, title, message, priority, action_link)
                      SELECT $1, u.id, $2, $3, 'WARNING', '/startup/payments' FROM users u WHERE u.id = $4`,
        [`NTF-${Date.now()}-${Math.floor(Math.random() * 1000)}`, kind === 'hold' ? 'Payment claim on hold' : 'Payment claim rejected', `${claim.invoice_number}: ${parsed.data.reason}`, claim.requester_user_id]);
    });
    await auditService.logEvent({
      actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role,
      action: kind === 'hold' ? 'PAYMENT_CLAIM_PLACED_ON_HOLD' : 'PAYMENT_CLAIM_REJECTED',
      entityType: 'PAYMENT_CLAIM', entityId: id, details: { reason: parsed.data.reason },
      ipAddress: request.ip || '127.0.0.1', userAgent: request.headers['user-agent'] || 'Unknown'
    });
    return reply.send({ success: true });
  };
  app.post('/payments/:id/hold', { preHandler: [authenticate, requireRole('finance', 'admin')] }, holdOrReject('hold'));
  app.post('/payments/:id/reject', { preHandler: [authenticate, requireRole('finance', 'admin')] }, holdOrReject('reject'));
}
