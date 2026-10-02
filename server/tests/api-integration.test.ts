import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { getDatabase, DatabaseAdapter } from '../src/db';
import { hashPassword } from '../src/security';

process.env.NODE_ENV = 'test';

describe('Sovereign API Integration Test — Full Procurement Lifecycle & Audit Chain', () => {
  let app: FastifyInstance;
  let db: DatabaseAdapter;

  let govToken: string;
  let startupToken: string;
  let inspectorToken: string;
  let financeToken: string;
  let adminToken: string;

  let challengeId: string;
  let proposalId: string;
  let pilotId: string;
  let milestoneId: string;
  let kpiId: string;
  let claimId: string;

  before(async () => {
    db = getDatabase();
    app = await buildApp({ db });

    // Seed test accounts in database if not present
    const testUsers = [
      { id: 'USR-GOV-INT', email: 'gov.test@s2s.gov.in', role: 'government', name: 'Dr. R. Sharma', departmentId: 'DEPT-HFW', orgId: null },
      { id: 'USR-STARTUP-INT', email: 'startup.test@greengrid.in', role: 'startup', name: 'Rohan Sengupta', departmentId: null, orgId: 'ORG-GREENGRID' },
      { id: 'USR-INSPECTOR-INT', email: 'inspector.test@qcin.org', role: 'inspector', name: 'Vikram Malhotra', departmentId: null, orgId: null },
      { id: 'USR-FINANCE-INT', email: 'finance.test@nic.in', role: 'finance', name: 'Sunita Deshmukh', departmentId: 'DEPT-HFW', orgId: null },
      { id: 'USR-ADMIN-INT', email: 'admin.test@dpiit.gov.in', role: 'admin', name: 'Anand Vardhan', departmentId: null, orgId: null }
    ];

    const passHash = await hashPassword('DevPass@2026!');

    // Ensure department exists
    await db.query(`
      INSERT INTO departments (id, name, code, ministry, budget_allocated_paise, budget_committed_paise, budget_disbursed_paise)
      VALUES ('DEPT-HFW', 'Ministry of Health & Family Welfare', 'HFW', 'Ministry of Health & Family Welfare', 5000000000, 0, 0)
      ON CONFLICT (id) DO NOTHING
    `);

    // Ensure organization exists
    await db.query(`
      INSERT INTO organizations (
        id, name, dpiit_number, cin_llpin, pan, gstin,
        bank_account_encrypted, bank_account_masked, ifsc_code,
        founder_name, founder_email, founder_phone, sector, verification_status
      ) VALUES (
        'ORG-GREENGRID', 'GreenGrid Innovations Pvt Ltd', 'DIPP77120', 'U40106KA2021PTC148810',
        'AABCG7712B', '29AABCG7712B1ZX', 'enc_bank_data', '•••• 7120', 'HDFC0000140',
        'Rohan Sengupta', 'startup.test@greengrid.in', '+919876543210', 'CleanTech', 'VERIFIED'
      ) ON CONFLICT (id) DO UPDATE SET verification_status = 'VERIFIED'
    `);

    for (const u of testUsers) {
      await db.query(`
        INSERT INTO users (id, email, password_hash, role, name, designation, department_id, organization_id, is_active)
        VALUES ($1, $2, $3, $4, $5, 'Officer', $6, $7, TRUE)
        ON CONFLICT (id) DO UPDATE SET password_hash = $3, role = $4, is_active = TRUE
      `, [u.id, u.email, passHash, u.role, u.name, u.departmentId, u.orgId]);
    }
  });

  after(async () => {
    await app.close();
  });

  // ── Step 1: Authentication & Token Issuance for All 5 Roles ────────
  it('1. Authenticates all 5 sovereign roles and obtains scoped JWT/Session tokens', async () => {
    // Government
    const govRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'gov.test@s2s.gov.in', password: 'DevPass@2026!', role: 'government' }
    });
    assert.strictEqual(govRes.statusCode, 200);
    const govBody = JSON.parse(govRes.body);
    assert.ok(govBody.token);
    assert.strictEqual(govBody.user.role, 'government');
    govToken = govBody.token;

    // Startup
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'startup.test@greengrid.in', password: 'DevPass@2026!', role: 'startup' }
    });
    assert.strictEqual(startRes.statusCode, 200);
    const startBody = JSON.parse(startRes.body);
    assert.ok(startBody.token);
    assert.strictEqual(startBody.user.role, 'startup');
    startupToken = startBody.token;

    // Inspector
    const inspRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'inspector.test@qcin.org', password: 'DevPass@2026!', role: 'inspector' }
    });
    assert.strictEqual(inspRes.statusCode, 200);
    const inspBody = JSON.parse(inspRes.body);
    assert.ok(inspBody.token);
    assert.strictEqual(inspBody.user.role, 'inspector');
    inspectorToken = inspBody.token;

    // Finance
    const finRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'finance.test@nic.in', password: 'DevPass@2026!', role: 'finance' }
    });
    assert.strictEqual(finRes.statusCode, 200);
    const finBody = JSON.parse(finRes.body);
    assert.ok(finBody.token);
    assert.strictEqual(finBody.user.role, 'finance');
    financeToken = finBody.token;

    // Admin
    const admRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin.test@dpiit.gov.in', password: 'DevPass@2026!', role: 'admin' }
    });
    assert.strictEqual(admRes.statusCode, 200);
    const admBody = JSON.parse(admRes.body);
    assert.ok(admBody.token);
    assert.strictEqual(admBody.user.role, 'admin');
    adminToken = admBody.token;
  });

  // ── Step 2: Challenge Draft Creation & Publication ─────────────────
  it('2. Government creates a challenge draft and publishes it to the national portal', async () => {
    // Create Draft
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/challenges',
      headers: { Authorization: `Bearer ${govToken}` },
      payload: {
        title: 'AI Diagnostic Telemedicine Solution for PHCs',
        departmentId: 'DEPT-HFW',
        problemStatement: 'Rural Primary Health Centres require automated AI diagnostic decision support to triage critical cases.',
        problemCategory: 'HealthTech',
        targetBeneficiaries: 'Rural primary care patients',
        desiredOutcome: 'High-accuracy automated diagnostic triage with low latency',
        requiredCapabilities: ['Computer Vision', 'Edge Model Deployment', 'HL7 FHIR Interoperability'],
        constraints: 'Low-bandwidth connectivity tolerance',
        pilotDurationMonths: 3,
        budgetPaise: 150000000, // ₹15 Lakhs in integer paise
        kpis: [
          { name: 'Diagnostic Accuracy', baseline: '75%', target: '95%', unit: '%', measurementMethod: 'Clinical audit' }
        ],
        evaluationCriteria: [
          { criterion: 'Clinical Sensitivity & Safety', weight: 50 },
          { criterion: 'Deployment Feasibility', weight: 50 }
        ],
        requiredDocuments: ['DPIIT Certificate', 'Security Audit Report'],
        riskConsiderations: [
          { risk: 'Power outages at PHCs', severity: 'Medium', mitigation: 'Battery-backed edge gateway' }
        ],
        deadline: '2026-11-30'
      }
    });

    assert.strictEqual(createRes.statusCode, 201);
    const createBody = JSON.parse(createRes.body);
    assert.ok(createBody.challengeId);
    challengeId = createBody.challengeId;

    // Publish Challenge
    const pubRes = await app.inject({
      method: 'POST',
      url: `/api/v1/challenges/${challengeId}/publish`,
      headers: { Authorization: `Bearer ${govToken}` }
    });
    assert.strictEqual(pubRes.statusCode, 200);
    const pubBody = JSON.parse(pubRes.body);
    assert.strictEqual(pubBody.success, true);
  });

  // ── Step 3: Startup Proposal Submission ────────────────────────────
  it('3. Startup submits an innovation proposal and commercial bid', async () => {
    const propRes = await app.inject({
      method: 'POST',
      url: '/api/v1/proposals',
      headers: { Authorization: `Bearer ${startupToken}` },
      payload: {
        challengeId,
        solutionTitle: 'GreenGrid Clinical AI Edge Node',
        problemSolutionFit: 'The clinical edge node provides automated triage that directly fits rural PHC requirements with high sensitivity.',
        technicalApproach: '8-bit quantized neural network running on low-power edge accelerators with 96% validated sensitivity.',
        deploymentPlan: 'Week 1: Site survey; Week 2-4: Deployment in 5 test PHCs; Week 5-12: Live clinical telemetry trial.',
        implementationTimeline: '3 Months (90 calendar days)',
        pilotCostPaise: 145000000, // ₹14.5 Lakhs in integer paise
        scaleupCostPaise: 480000000, // ₹48 Lakhs in integer paise
        evidenceDeployments: [
          { client: 'Government General Hospital', scope: 'Radiology Triage', status: 'Completed' }
        ],
        certifications: ['ISO 13485', 'CDSCO Registered Class B'],
        documents: ['technical-architecture.pdf', 'clinical-trial-protocol.pdf']
      }
    });

    assert.strictEqual(propRes.statusCode, 201);
    const propBody = JSON.parse(propRes.body);
    assert.ok(propBody.proposalId);
    proposalId = propBody.proposalId;
  });

  // ── Step 4: AI Proposal Evaluation Engine ──────────────────────────
  it('4. Government triggers multi-criteria AI proposal evaluation with structured rationale', async () => {
    const evalRes = await app.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposalId}/ai-evaluate`,
      headers: { Authorization: `Bearer ${govToken}` }
    });

    assert.strictEqual(evalRes.statusCode, 200);
    const evalBody = JSON.parse(evalRes.body);
    assert.strictEqual(evalBody.success, true);
    assert.ok(evalBody.evaluation);
    assert.ok(typeof (evalBody.evaluation.overall_score ?? evalBody.evaluation.overallScore) === 'number');
    assert.ok(evalBody.evaluation.why_recommended ?? evalBody.evaluation.whyRecommended);
    assert.ok(evalBody.evaluation.concerns);
  });

  // ── Step 5: Proposal Shortlisting & Pilot Creation ─────────────────
  it('5. Government approves startup shortlist and launches the monitored pilot', async () => {
    // Select / Shortlist Proposal (creates pilot docket automatically)
    const selectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposalId}/select`,
      headers: { Authorization: `Bearer ${govToken}` },
      payload: { remarks: 'Top scored candidate meeting all statutory clinical parameters and budget constraints.' }
    });
    assert.strictEqual(selectRes.statusCode, 200);
    const selectBody = JSON.parse(selectRes.body);
    assert.ok(selectBody.pilotId);
    pilotId = selectBody.pilotId;

    milestoneId = `MS-${pilotId}-01`;
    kpiId = `KPI-${pilotId}-01`;

    // Seed test KPI for the pilot
    await db.query(`
      INSERT INTO pilot_kpis (id, pilot_id, name, baseline_value, target_value, current_value, unit, measurement_method, status)
      VALUES ($1, $2, 'Diagnostic Accuracy', '75%', '95%', '75%', '%', 'Automated telemetry & clinical review', 'ON_TRACK')
    `, [kpiId, pilotId]);

    // Government assigns the field inspector (inspectors only see pilots assigned to them)
    const assignRes = await app.inject({
      method: 'POST',
      url: `/api/v1/pilots/${pilotId}/assign-inspector`,
      headers: { Authorization: `Bearer ${govToken}` },
      payload: { inspectorId: 'USR-INSPECTOR-INT' }
    });
    assert.strictEqual(assignRes.statusCode, 200);

    // Retrieve created pilot details to verify milestones
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/pilots/${pilotId}`,
      headers: { Authorization: `Bearer ${govToken}` }
    });
    assert.strictEqual(detailRes.statusCode, 200);
    const detailBody = JSON.parse(detailRes.body);
    assert.ok(detailBody.milestones.length >= 3);
  });

  // ── Step 6: KPI Evidence Submission by Startup ─────────────────────
  it('6. Startup records telemetry-backed KPI evidence version', async () => {
    const kpiRes = await app.inject({
      method: 'POST',
      url: `/api/v1/pilots/${pilotId}/kpis/${kpiId}/evidence`,
      headers: { Authorization: `Bearer ${startupToken}` },
      payload: {
        reportedValue: '96.4%',
        evidenceNotes: 'Clinical trial over 1,450 patient cases yielded 96.4% diagnostic sensitivity.'
      }
    });

    assert.strictEqual(kpiRes.statusCode, 201);
    const kpiBody = JSON.parse(kpiRes.body);
    assert.ok(kpiBody.submissionId);
    assert.strictEqual(kpiBody.versionNumber, 1);
  });

  // ── Step 7: Inspector Verification & Field Report ──────────────────
  it('7. Inspector validates KPI evidence and files on-site field inspection report', async () => {
    // Verify KPI
    const verifyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/pilots/${pilotId}/kpis/${kpiId}/verify`,
      headers: { Authorization: `Bearer ${inspectorToken}` },
      payload: {
        verificationStatus: 'VERIFIED',
        inspectorNotes: 'On-site physical inspection confirmed sensors match telemetry readings and clinical baseline.'
      }
    });
    assert.strictEqual(verifyRes.statusCode, 200);

    // Submit Inspection Docket
    const inspRes = await app.inject({
      method: 'POST',
      url: `/api/v1/pilots/${pilotId}/inspections`,
      headers: { Authorization: `Bearer ${inspectorToken}` },
      payload: {
        findings: 'Edge hardware deployed as specified. Telemetry integrity verified with zero packet loss.',
        validationStatus: 'VERIFIED',
        checklistResults: {
          hardwareCompliant: 'PASS',
          dataSecurityPassed: 'PASS'
        }
      }
    });
    assert.strictEqual(inspRes.statusCode, 201);

    // Official forwards validated pilot to Finance
    const fwdRes = await app.inject({
      method: 'POST',
      url: `/api/v1/pilots/${pilotId}/submit-to-finance`,
      headers: { Authorization: `Bearer ${govToken}` }
    });
    assert.strictEqual(fwdRes.statusCode, 200);
  });

  // ── Step 8: Payment Claim Submission (Integer Paise & Tax Schedule) ─
  it('7b. Startup submits the milestone deliverable and the inspector verifies it (unlocks payment claims)', async () => {
    // A claim before verification must be refused
    const early = await app.inject({
      method: 'POST', url: '/api/v1/finance/payments', headers: { Authorization: `Bearer ${startupToken}` },
      payload: { pilotId, milestoneId, invoiceNumber: 'INV-EARLY-001', invoiceDate: new Date().toISOString().slice(0, 10), grossAmountPaise: 100000 }
    });
    assert.strictEqual(early.statusCode, 409);

    const sub = await app.inject({
      method: 'POST', url: `/api/v1/pilots/${pilotId}/milestones/${milestoneId}/submit`, headers: { Authorization: `Bearer ${startupToken}` },
      payload: { notes: 'Edge devices installed at all sites and telemetry is streaming.' }
    });
    assert.strictEqual(sub.statusCode, 200);

    const ver = await app.inject({
      method: 'POST', url: `/api/v1/pilots/${pilotId}/milestones/${milestoneId}/verify`, headers: { Authorization: `Bearer ${inspectorToken}` },
      payload: { decision: 'VERIFIED', notes: 'Verified on site against the installation checklist.' }
    });
    assert.strictEqual(ver.statusCode, 200);
  });

  it('8. Startup submits Milestone 1 payment claim with deterministic tax withholding', async () => {
    const claimRes = await app.inject({
      method: 'POST',
      url: '/api/v1/finance/payments',
      headers: { Authorization: `Bearer ${startupToken}` },
      payload: {
        pilotId,
        milestoneId,
        invoiceNumber: `INV-GG-${Date.now()}`,
        invoiceDate: '2026-08-01',
        grossAmountPaise: 43500000 // ₹4,35,000 in integer paise
      }
    });

    assert.strictEqual(claimRes.statusCode, 201);
    const claimBody = JSON.parse(claimRes.body);
    assert.ok(claimBody.claimId);
    claimId = claimBody.claimId;

    // Verify deterministic tax schedule in integer paise:
    // Gross: 43,500,000 paise (₹4,35,000)
    // TDS 2%: 870,000 paise (₹8,700)
    // GST TDS 2%: 870,000 paise (₹8,700)
    // Net Payable: 41,760,000 paise (₹4,17,600)
    assert.strictEqual(claimBody.grossAmountPaise, '43500000');
    assert.strictEqual(claimBody.tdsPaise, '870000');
    assert.strictEqual(claimBody.gstTdsPaise, '870000');
    assert.strictEqual(claimBody.netPayablePaise, '41760000');
  });

  // ── Step 9: Maker-Checker Approval & Treasury Disbursement ─────────
  it('9. Finance Officer approves claim and records treasury disbursement (PFMS/RBI)', async () => {
    // Maker-checker approval
    const appRes = await app.inject({
      method: 'POST',
      url: `/api/v1/finance/payments/${claimId}/approve`,
      headers: { Authorization: `Bearer ${financeToken}` },
      payload: { remarks: 'Statutory milestone audit passed. Tax deductions reconciled with Income Tax Sec 194C and GST Sec 51.' }
    });
    assert.strictEqual(appRes.statusCode, 200);

    // Record Treasury Disbursement
    const utr = 'PFMS-UTR-20260930-778899';
    const disbRes = await app.inject({
      method: 'POST',
      url: `/api/v1/finance/payments/${claimId}/disburse`,
      headers: { Authorization: `Bearer ${financeToken}` },
      payload: { disbursementReference: utr }
    });
    assert.strictEqual(disbRes.statusCode, 200);
    const disbBody = JSON.parse(disbRes.body);
    assert.strictEqual(disbBody.success, true);
    assert.strictEqual(disbBody.referenceNumber, utr);

    // Check payment record reflects PAID status
    const getClaimRes = await app.inject({
      method: 'GET',
      url: `/api/v1/finance/payments/${claimId}`,
      headers: { Authorization: `Bearer ${financeToken}` }
    });
    assert.strictEqual(getClaimRes.statusCode, 200);
    const claimRecord = JSON.parse(getClaimRes.body).claim;
    assert.strictEqual(claimRecord.status, 'PAID');
    assert.strictEqual(claimRecord.disbursement_reference, utr);
  });

  // ── Step 10: Cryptographic Audit Trail Verification ────────────────
  it('10. Confirms audit logs recorded every critical step and hash chain remains mathematically intact', async () => {
    const auditRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-logs?limit=50',
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.strictEqual(auditRes.statusCode, 200);
    const auditBody = JSON.parse(auditRes.body);
    assert.ok(auditBody.logs.length >= 8);

    // Verify essential audit actions occurred in chronological trajectory
    const actions = auditBody.logs.map((l: any) => l.action);
    assert.ok(actions.includes('CHALLENGE_CREATED_DRAFT'));
    assert.ok(actions.includes('CHALLENGE_PUBLISHED'));
    assert.ok(actions.includes('PROPOSAL_SUBMITTED'));
    assert.ok(actions.includes('PROPOSAL_AI_EVALUATED'));
    assert.ok(actions.includes('HUMAN_STARTUP_SELECTION_CONFIRMED'));
    assert.ok(actions.includes('KPI_EVIDENCE_SUBMITTED_NEW_VERSION'));
    assert.ok(actions.includes('KPI_VERIFIED_BY_INSPECTOR'));
    assert.ok(actions.includes('INSPECTION_DOCKET_FILED'));
    assert.ok(actions.includes('PAYMENT_CLAIM_SUBMITTED'));
    assert.ok(actions.includes('PAYMENT_CLAIM_APPROVED_BY_FINANCE'));
    assert.ok(actions.includes('TREASURY_DISBURSEMENT_RECORDED'));

    // Verify unbroken mathematical tamper-evidence
    assert.strictEqual(auditBody.integrity.valid, true);
    assert.ok(auditBody.integrity.totalEntries >= 8);
  });
});
