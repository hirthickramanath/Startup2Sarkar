import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DatabaseAdapter, getSetting } from '../db';
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

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
const chequeSchema = z.object({
  chequeNumber: z.string().trim().regex(/^[0-9]{6,10}$/, 'A cheque number is 6 to 10 digits'),
  chequeDate: isoDay,
  draweeBank: z.string().trim().min(3).max(80),
  signatories: z.string().trim().min(3).max(200)
});
const clearSchema = z.object({ clearedDate: isoDay });
const bounceSchema = z.object({ reason: z.string().trim().min(5).max(300) });
const remitSchema = z.object({ challanNumber: z.string().trim().regex(/^[A-Za-z0-9\-\/]{6,30}$/, 'Challan numbers are 6-30 letters, digits, - or /'), challanDate: isoDay });

/** Claims at or above this gross amount need two different finance officers, and a third person to record the payment. */
export const DUAL_APPROVAL_KEY = 'payments.dual_approval_threshold_paise';
export const DEFAULT_DUAL_APPROVAL_PAISE = '500000000'; // ₹50,00,000

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
  const meta = (request: FastifyRequest) => ({ ipAddress: request.ip || '127.0.0.1', userAgent: (request.headers['user-agent'] as string) || 'Unknown' });
  const dualThreshold = async () => BigInt(String(await getSetting<string | number>(db, DUAL_APPROVAL_KEY, DEFAULT_DUAL_APPROVAL_PAISE)));
  const needsTwoPeople = async (claim: any) => BigInt(claim.gross_amount_paise) >= (await dualThreshold());
  const taxId = (claimId: string, t: string) => `TAX-${claimId}-${t === 'TDS' ? 'TDS' : 'GST'}`;

  /** The ONE place a claim becomes PAID (electronic transfer recorded, or cheque cleared): ledger, milestone, tax. */
  async function markPaid(tx: DatabaseAdapter, claim: any, reference: string, paidAt: string | Date, userId: string, method: 'ELECTRONIC' | 'CHEQUE') {
    await tx.query(
      `UPDATE finance_payment_claims SET status = 'PAID', payment_method = $1, disbursement_reference = $2, disbursed_at = $3, disbursed_by_user_id = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5`,
      [method, reference, paidAt, userId, claim.id]
    );
    await tx.query(`UPDATE pilot_milestones SET status = 'PAID', paid_at = $1 WHERE id = $2`, [paidAt, claim.milestone_id]);
    await tx.query(
      `UPDATE departments SET budget_committed_paise = budget_committed_paise - $1, budget_disbursed_paise = budget_disbursed_paise + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [claim.gross_amount_paise, claim.department_id]
    );
    for (const [type, amount] of [['TDS', claim.tds_paise], ['GST_TDS', claim.gst_paise]] as const) {
      if (BigInt(amount) > 0n) {
        await tx.query(
          `INSERT INTO tax_remittances (id, claim_id, department_id, tax_type, amount_paise, deducted_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [taxId(claim.id, type), claim.id, claim.department_id, type, String(amount), paidAt]
        );
      }
    }
  }

  const notifyStartup = (orgId: string, title: string, message: string) => db.query(
    `INSERT INTO notifications (id, user_id, title, message, priority, action_link)
     SELECT 'NTF-' || $1::text || '-' || u.id, u.id, $2::text, $3::text, 'INFO', '/startup/payments' FROM users u WHERE u.organization_id = $4`,
    [`${Date.now()}${Math.floor(Math.random() * 1000)}`, title, message, orgId]
  );

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
             END as utilization_percent,
             (SELECT COALESCE(SUM(c.net_payable_paise), 0) FROM finance_payment_claims c WHERE c.department_id = departments.id AND c.status = 'CHEQUE_ISSUED') AS cheques_in_transit_paise
      FROM departments
      ORDER BY name ASC
    `);

    return reply.send({ departments: res.rows, asOf: new Date().toISOString() });
  });

  // 3. Payment Claims List
  app.get('/payments', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const query = request.query as any;

    let sql = `
      SELECT fpc.*, to_char(fpc.cheque_date, 'YYYY-MM-DD') AS cheque_day,
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

    if (!['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_PENDING', 'FINANCE_REVIEW', 'AWAITING_SECOND_APPROVAL'].includes(claim.status)) {
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

    // Two-person rule for large payments: the first approval only records; a DIFFERENT officer completes it.
    const dual = await needsTwoPeople(claim);
    if (claim.status === 'AWAITING_SECOND_APPROVAL' && claim.first_reviewer_user_id === authReq.user.userId) {
      return reply.status(403).send({ error: 'Two-person rule: a different finance officer must give the second approval.', code: 'TWO_PERSON_RULE' });
    }
    if (dual && claim.status !== 'AWAITING_SECOND_APPROVAL') {
      await db.query(`UPDATE finance_payment_claims SET status = 'AWAITING_SECOND_APPROVAL', first_reviewer_user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [authReq.user.userId, id]);
      await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'PAYMENT_CLAIM_FIRST_APPROVAL', entityType: 'PAYMENT_CLAIM', entityId: id, details: { grossPaise: String(claim.gross_amount_paise), remarks }, ...meta(request) });
      return reply.send({ success: true, awaitingSecondApproval: true, message: 'First approval recorded. This amount needs a second approval from a different finance officer.' });
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
    if ((await needsTwoPeople(claim)) && [claim.approver_user_id, claim.first_reviewer_user_id].includes(authReq.user.userId)) {
      return reply.status(403).send({ error: 'Segregation of duties: for a payment this size, someone other than the two approvers must record it.', code: 'SEGREGATION_OF_DUTIES' });
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

    await db.transaction(async (tx) => { await markPaid(tx, claim, disburseResult.referenceNumber, disburseResult.disbursedAt, authReq.user.userId, 'ELECTRONIC'); });

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
      `SELECT fpc.*, to_char(fpc.cheque_date, 'YYYY-MM-DD') AS cheque_day, p.name as pilot_name, pm.title as milestone_title,
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
  // ───────────── Cheque lifecycle: issued -> cleared (counts as spent) or bounced (back to approved) ─────────────
  const loadForPayment = async (id: string) => (await db.query("SELECT *, to_char(cheque_date, 'YYYY-MM-DD') AS cheque_day FROM finance_payment_claims WHERE id = $1", [id])).rows[0];
  const today = () => new Date().toISOString().slice(0, 10);

  app.post('/payments/:id/cheque', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const { id } = request.params as { id: string };
    const parsed = chequeSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Please check the cheque details', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    const d = parsed.data;
    const claim = await loadForPayment(id);
    if (!claim) return reply.status(404).send({ error: 'Payment claim not found' });
    if (claim.status !== 'APPROVED') return reply.status(409).send({ error: `A cheque can be recorded only for an APPROVED claim (this one is ${claim.status}).`, code: 'INVALID_CLAIM_STATE' });
    if ((await needsTwoPeople(claim)) && [claim.approver_user_id, claim.first_reviewer_user_id].includes(authReq.user.userId)) {
      return reply.status(403).send({ error: 'Segregation of duties: for a payment this size, someone other than the two approvers must issue the cheque.', code: 'SEGREGATION_OF_DUTIES' });
    }
    const gap = Math.abs(Date.parse(d.chequeDate) - Date.parse(today())) / 86400000;
    if (Number.isNaN(gap) || gap > 90) return reply.status(400).send({ error: 'The cheque date must be within 90 days of today.' });
    const bankKey = d.draweeBank.toLowerCase();
    const dup = await db.query(
      `SELECT 1 FROM finance_payment_claims WHERE (LOWER(drawee_bank) = $1 AND cheque_number = $2) OR cheque_history @> $3::jsonb LIMIT 1`,
      [bankKey, d.chequeNumber, JSON.stringify([{ number: d.chequeNumber, bankKey }])]
    );
    if (dup.rows.length) return reply.status(409).send({ error: 'That cheque number has already been used for this bank.', code: 'CHEQUE_NUMBER_USED' });

    const entry = { event: 'ISSUED', number: d.chequeNumber, bank: d.draweeBank, bankKey, date: d.chequeDate, at: new Date().toISOString(), by: authReq.user.userId };
    await db.query(
      `UPDATE finance_payment_claims SET status = 'CHEQUE_ISSUED', payment_method = 'CHEQUE', cheque_number = $1, cheque_date = $2, drawee_bank = $3, cheque_signatories = $4,
         cheque_issued_at = CURRENT_TIMESTAMP, cheque_issued_by_user_id = $5, cheque_history = cheque_history || $6::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $7`,
      [d.chequeNumber, d.chequeDate, d.draweeBank, d.signatories, authReq.user.userId, JSON.stringify([entry]), id]
    );
    await notifyStartup(claim.organization_id, 'Cheque issued', `A cheque (no. ${d.chequeNumber}, ${d.draweeBank}) was issued for your claim ${claim.invoice_number}. It counts as paid once it clears.`);
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'CHEQUE_ISSUED', entityType: 'PAYMENT_CLAIM', entityId: id, details: { chequeNumber: d.chequeNumber, draweeBank: d.draweeBank, netPayablePaise: String(claim.net_payable_paise) }, ...meta(request) });
    return reply.send({ success: true });
  });

  app.post('/payments/:id/cheque/clear', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const { id } = request.params as { id: string };
    const parsed = clearSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Enter the date the cheque cleared (YYYY-MM-DD)' });
    const claim = await loadForPayment(id);
    if (!claim) return reply.status(404).send({ error: 'Payment claim not found' });
    if (claim.status !== 'CHEQUE_ISSUED') return reply.status(409).send({ error: 'Only a claim with an issued cheque can be marked as cleared.', code: 'INVALID_CLAIM_STATE' });
    if (parsed.data.clearedDate > today()) return reply.status(400).send({ error: 'A cheque cannot clear in the future.' });
    if (claim.cheque_day && parsed.data.clearedDate < claim.cheque_day) return reply.status(400).send({ error: 'The clearing date cannot be before the cheque date.' });
    const entry = { event: 'CLEARED', number: claim.cheque_number, bank: claim.drawee_bank, bankKey: String(claim.drawee_bank).toLowerCase(), date: parsed.data.clearedDate, at: new Date().toISOString(), by: authReq.user.userId };
    await db.transaction(async (tx) => {
      await markPaid(tx, claim, `CHQ-${claim.cheque_number}`, `${parsed.data.clearedDate}T12:00:00Z`, authReq.user.userId, 'CHEQUE');
      await tx.query(`UPDATE finance_payment_claims SET cheque_history = cheque_history || $1::jsonb WHERE id = $2`, [JSON.stringify([entry]), id]);
    });
    await notifyStartup(claim.organization_id, 'Payment cleared', `Your cheque for claim ${claim.invoice_number} has cleared.`);
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'CHEQUE_CLEARED', entityType: 'PAYMENT_CLAIM', entityId: id, details: { chequeNumber: claim.cheque_number, clearedDate: parsed.data.clearedDate, netPayablePaise: String(claim.net_payable_paise) }, ...meta(request) });
    return reply.send({ success: true });
  });

  app.post('/payments/:id/cheque/bounce', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const { id } = request.params as { id: string };
    const parsed = bounceSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Give the reason the cheque was returned (at least 5 characters)' });
    const claim = await loadForPayment(id);
    if (!claim) return reply.status(404).send({ error: 'Payment claim not found' });
    if (claim.status !== 'CHEQUE_ISSUED') return reply.status(409).send({ error: 'Only an issued cheque can be marked as returned.', code: 'INVALID_CLAIM_STATE' });
    const entry = { event: 'BOUNCED', number: claim.cheque_number, bank: claim.drawee_bank, bankKey: String(claim.drawee_bank).toLowerCase(), reason: parsed.data.reason, at: new Date().toISOString(), by: authReq.user.userId };
    // Money stays reserved; the claim goes back to APPROVED so a new cheque or an electronic payment can be recorded.
    await db.query(
      `UPDATE finance_payment_claims SET status = 'APPROVED', payment_method = NULL, cheque_number = NULL, cheque_date = NULL, drawee_bank = NULL, cheque_signatories = NULL,
         cheque_history = cheque_history || $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [JSON.stringify([entry]), id]);
    await notifyStartup(claim.organization_id, 'Cheque returned', `The cheque for claim ${claim.invoice_number} was returned. Finance will issue a new payment.`);
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'CHEQUE_BOUNCED', entityType: 'PAYMENT_CLAIM', entityId: id, details: { chequeNumber: claim.cheque_number, reason: parsed.data.reason }, ...meta(request) });
    return reply.send({ success: true });
  });

  // ───────────── Tax ledger: deducted -> remitted ─────────────
  app.get('/tax-ledger', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const status = String((request.query as any).status || 'ALL').toUpperCase();
    const where = ['DEDUCTED', 'REMITTED'].includes(status) ? 'WHERE t.status = $1' : '';
    const rows = (await db.query(
      `SELECT t.id, t.claim_id, t.tax_type, t.amount_paise, t.status, to_char(t.deducted_at, 'YYYY-MM-DD') AS deducted_day, t.challan_number, to_char(t.challan_date, 'YYYY-MM-DD') AS challan_day,
              c.invoice_number, o.name AS startup_name, d.name AS department_name
       FROM tax_remittances t JOIN finance_payment_claims c ON c.id = t.claim_id JOIN organizations o ON o.id = c.organization_id JOIN departments d ON d.id = t.department_id
       ${where} ORDER BY t.deducted_at DESC LIMIT 500`, where ? [status] : []
    )).rows;
    const sum = (st: string) => rows.filter((r: any) => r.status === st).reduce((a: bigint, r: any) => a + BigInt(r.amount_paise), 0n).toString();
    return reply.send({ entries: rows, totals: { deductedPaise: sum('DEDUCTED'), remittedPaise: sum('REMITTED') } });
  });

  app.post('/tax-ledger/:id/remit', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = remitSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Please check the challan details', details: parsed.error.issues.map((i) => i.message) });
    const row = (await db.query('SELECT * FROM tax_remittances WHERE id = $1', [(request.params as any).id])).rows[0];
    if (!row) return reply.status(404).send({ error: 'Ledger entry not found' });
    if (row.status === 'REMITTED') return reply.status(409).send({ error: 'This amount is already marked as remitted.' });
    if (parsed.data.challanDate > today()) return reply.status(400).send({ error: 'The challan date cannot be in the future.' });
    await db.query(`UPDATE tax_remittances SET status = 'REMITTED', challan_number = $1, challan_date = $2, remitted_by_user_id = $3, remitted_at = CURRENT_TIMESTAMP WHERE id = $4`, [parsed.data.challanNumber, parsed.data.challanDate, authReq.user.userId, row.id]);
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'TAX_REMITTED', entityType: 'PAYMENT_CLAIM', entityId: row.claim_id, details: { taxType: row.tax_type, amountPaise: String(row.amount_paise), challan: parsed.data.challanNumber }, ...meta(request) });
    return reply.send({ success: true });
  });

  app.get('/reports/tax-ledger.csv', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const rows = (await db.query(
      `SELECT t.tax_type, t.amount_paise, t.status, to_char(t.deducted_at, 'YYYY-MM-DD') AS deducted_day, t.challan_number, to_char(t.challan_date, 'YYYY-MM-DD') AS challan_day, c.invoice_number, o.name AS startup_name, d.name AS department_name
       FROM tax_remittances t JOIN finance_payment_claims c ON c.id = t.claim_id JOIN organizations o ON o.id = c.organization_id JOIN departments d ON d.id = t.department_id ORDER BY t.deducted_at`
    )).rows;
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
    const rupees = (p: any) => (Number(BigInt(p)) / 100).toFixed(2);
    const lines = [['Department', 'Startup', 'Invoice', 'Tax', 'Amount (INR)', 'Status', 'Deducted on', 'Challan no.', 'Challan date'].join(',')];
    for (const r of rows) lines.push([r.department_name, r.startup_name, r.invoice_number, r.tax_type === 'TDS' ? 'TDS' : 'GST-TDS', rupees(r.amount_paise), r.status, r.deducted_day, r.challan_number, r.challan_day || ''].map(esc).join(','));
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="tax-ledger.csv"');
    return reply.send(lines.join('\n'));
  });
  // ───────────── Bank statement reconciliation ─────────────
  const stmtRow = z.object({ date: isoDay, description: z.string().max(300).default(''), reference: z.string().max(100).default(''), debitPaise: z.number().int().min(0).max(100000000000) });
  const tokenIn = (text: string, token: string) => new RegExp(`(^|[^0-9A-Za-z])0*${token.replace(/[^0-9A-Za-z]/g, '')}([^0-9A-Za-z]|$)`, 'i').test(text);

  app.post('/reconcile', { preHandler: [authenticate, requireRole('finance', 'admin')], bodyLimit: 2 * 1024 * 1024 }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = z.object({ rows: z.array(stmtRow).min(1).max(1000) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Send between 1 and 1000 statement lines with a date (YYYY-MM-DD) and a debit amount.' });
    const cheques = (await db.query(`SELECT c.id, c.cheque_number, c.cheque_day, c.net_payable_paise, o.name AS startup_name FROM (SELECT *, to_char(cheque_date, 'YYYY-MM-DD') AS cheque_day FROM finance_payment_claims) c JOIN organizations o ON o.id = c.organization_id WHERE c.status = 'CHEQUE_ISSUED'`)).rows;
    const transfers = (await db.query(`SELECT c.id, c.disbursement_reference, c.net_payable_paise, o.name AS startup_name FROM finance_payment_claims c JOIN organizations o ON o.id = c.organization_id WHERE c.status = 'PAID' AND c.payment_method = 'ELECTRONIC' AND c.bank_confirmed_at IS NULL AND c.disbursement_reference IS NOT NULL`)).rows;
    const matches: any[] = []; const mismatches: any[] = []; const unmatched: number[] = [];
    parsed.data.rows.forEach((row, i) => {
      if (row.debitPaise <= 0) return; // credits and zero lines are not payments we made
      const text = `${row.description} ${row.reference}`;
      let hit = false;
      for (const c of cheques) {
        if (c.cheque_number && tokenIn(text, c.cheque_number)) {
          hit = true;
          const item = { rowIndex: i, claimId: c.id, kind: 'CHEQUE_CLEARED', startupName: c.startup_name, reference: c.cheque_number, expectedPaise: String(c.net_payable_paise), statementPaise: String(row.debitPaise), date: row.date };
          if (BigInt(c.net_payable_paise) === BigInt(row.debitPaise) && (!c.cheque_day || row.date >= c.cheque_day)) matches.push(item);
          else mismatches.push({ ...item, reason: BigInt(c.net_payable_paise) !== BigInt(row.debitPaise) ? 'AMOUNT_DIFFERS' : 'BEFORE_CHEQUE_DATE' });
        }
      }
      for (const t of transfers) {
        if (t.disbursement_reference && tokenIn(text, t.disbursement_reference)) {
          hit = true;
          const item = { rowIndex: i, claimId: t.id, kind: 'TRANSFER_CONFIRMED', startupName: t.startup_name, reference: t.disbursement_reference, expectedPaise: String(t.net_payable_paise), statementPaise: String(row.debitPaise), date: row.date };
          if (BigInt(t.net_payable_paise) === BigInt(row.debitPaise)) matches.push(item); else mismatches.push({ ...item, reason: 'AMOUNT_DIFFERS' });
        }
      }
      if (!hit) unmatched.push(i);
    });
    return reply.send({ matches, mismatches, unmatched, openCheques: cheques.length });
  });

  app.post('/reconcile/apply', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ items: z.array(z.object({ claimId: z.string(), kind: z.enum(['CHEQUE_CLEARED', 'TRANSFER_CONFIRMED']), date: isoDay })).min(1).max(200) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Nothing to apply.' });
    const results: any[] = [];
    for (const it of parsed.data.items) {
      try {
        const claim = await loadForPayment(it.claimId);
        if (!claim) { results.push({ claimId: it.claimId, ok: false, error: 'Claim not found' }); continue; }
        if (it.date > today()) { results.push({ claimId: it.claimId, ok: false, error: 'The date is in the future' }); continue; }
        if (it.kind === 'CHEQUE_CLEARED') {
          if (claim.status !== 'CHEQUE_ISSUED') { results.push({ claimId: it.claimId, ok: false, error: `Not an issued cheque (status ${claim.status})` }); continue; }
          if (claim.cheque_day && it.date < claim.cheque_day) { results.push({ claimId: it.claimId, ok: false, error: 'Statement date is before the cheque date' }); continue; }
          const entry = { event: 'CLEARED', number: claim.cheque_number, bank: claim.drawee_bank, bankKey: String(claim.drawee_bank).toLowerCase(), date: it.date, via: 'BANK_STATEMENT', at: new Date().toISOString(), by: authReq.user.userId };
          await db.transaction(async (tx) => {
            await markPaid(tx, claim, `CHQ-${claim.cheque_number}`, `${it.date}T12:00:00Z`, authReq.user.userId, 'CHEQUE');
            await tx.query(`UPDATE finance_payment_claims SET cheque_history = cheque_history || $1::jsonb, bank_confirmed_at = $2 WHERE id = $3`, [JSON.stringify([entry]), `${it.date}T12:00:00Z`, it.claimId]);
          });
          await notifyStartup(claim.organization_id, 'Payment cleared', `Your cheque for claim ${claim.invoice_number} has cleared.`);
          await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'CHEQUE_CLEARED', entityType: 'PAYMENT_CLAIM', entityId: it.claimId, details: { via: 'BANK_STATEMENT', clearedDate: it.date }, ...meta(request) });
        } else {
          if (claim.status !== 'PAID' || claim.bank_confirmed_at) { results.push({ claimId: it.claimId, ok: false, error: 'Not an unconfirmed electronic payment' }); continue; }
          await db.query('UPDATE finance_payment_claims SET bank_confirmed_at = $1 WHERE id = $2', [`${it.date}T12:00:00Z`, it.claimId]);
          await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'TRANSFER_CONFIRMED_BY_STATEMENT', entityType: 'PAYMENT_CLAIM', entityId: it.claimId, details: { date: it.date }, ...meta(request) });
        }
        results.push({ claimId: it.claimId, ok: true });
      } catch (e: any) { results.push({ claimId: it.claimId, ok: false, error: 'Could not be applied' }); }
    }
    return reply.send({ results, applied: results.filter((r) => r.ok).length });
  });

  // ───────────── Monthly trends (last 6 months) ─────────────
  app.get('/trends', { preHandler: [authenticate, requireRole('finance', 'admin')] }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const rows = (await db.query(
      `SELECT to_char(created_at, 'YYYY-MM') AS m, COUNT(*) AS submitted, COALESCE(SUM(gross_amount_paise), 0) AS gross,
              COALESCE(SUM(CASE WHEN status = 'PAID' THEN net_payable_paise ELSE 0 END), 0) AS paid_net
       FROM finance_payment_claims WHERE created_at >= date_trunc('month', CURRENT_TIMESTAMP) - INTERVAL '5 months' GROUP BY 1`
    )).rows;
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
    return reply.send({ months: months.map((m) => { const r = rows.find((x: any) => x.m === m); return { month: m, claims: r ? Number(r.submitted) : 0, grossPaise: r ? String(r.gross) : '0', paidNetPaise: r ? String(r.paid_net) : '0' }; }) });
  });
}
