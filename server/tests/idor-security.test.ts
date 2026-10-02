import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { getDatabase, DatabaseAdapter } from '../src/db';
import { hashPassword } from '../src/security';
import { AuditService } from '../src/audit';

process.env.NODE_ENV = 'test';

describe('Sovereign Security & IDOR Access Boundary Tests (Spec Section 89 & ASVS L2)', () => {
  let app: FastifyInstance;
  let db: DatabaseAdapter;
  let auditService: AuditService;

  let govToken: string;
  let startupAToken: string;
  let startupBToken: string;
  let inspectorToken: string;
  let financeToken: string;

  let pilotIdA: string;
  let milestoneIdA: string;

  before(async () => {
    db = getDatabase();
    app = await buildApp({ db });
    auditService = new AuditService(db);

    const passHash = await hashPassword('DevPass@2026!');

    // Ensure department exists
    await db.query(`
      INSERT INTO departments (id, name, code, ministry, budget_allocated_paise, budget_committed_paise, budget_disbursed_paise)
      VALUES ('DEPT-HFW', 'Ministry of Health & Family Welfare', 'HFW', 'Ministry of Health & Family Welfare', 5000000000, 0, 0)
      ON CONFLICT (id) DO NOTHING
    `);

    // Seed organizations for Startup A and Startup B
    await db.query(`
      INSERT INTO organizations (id, name, dpiit_number, cin_llpin, pan, gstin, bank_account_encrypted, bank_account_masked, ifsc_code, founder_name, founder_email, founder_phone, sector, verification_status)
      VALUES 
        ('ORG-ALPHA', 'Alpha Innovations Pvt Ltd', 'DIPP11111', 'U11111DL2021PTC111111', 'AAACA1111A', '07AAACA1111A1Z1', 'enc', '•••• 1111', 'SBIN0000001', 'Alpha Founder', 'alpha@startup.in', '+919999900001', 'AI', 'VERIFIED'),
        ('ORG-BETA',  'Beta Systems Pvt Ltd',      'DIPP22222', 'U22222DL2021PTC222222', 'AAACB2222B', '07AAACB2222B1Z2', 'enc', '•••• 2222', 'SBIN0000002', 'Beta Founder',  'beta@startup.in',  '+919999900002', 'AI', 'VERIFIED')
      ON CONFLICT (id) DO NOTHING
    `);

    // Seed users
    const users = [
      { id: 'USR-SEC-GOV', email: 'sec.gov@s2s.gov.in', role: 'government', orgId: null },
      { id: 'USR-SEC-STARTUP-A', email: 'alpha@startup.in', role: 'startup', orgId: 'ORG-ALPHA' },
      { id: 'USR-SEC-STARTUP-B', email: 'beta@startup.in', role: 'startup', orgId: 'ORG-BETA' },
      { id: 'USR-SEC-INSP', email: 'sec.insp@s2s.gov.in', role: 'inspector', orgId: null },
      { id: 'USR-SEC-FIN', email: 'sec.fin@s2s.gov.in', role: 'finance', orgId: null }
    ];

    for (const u of users) {
      await db.query(`
        INSERT INTO users (id, email, password_hash, role, name, designation, department_id, organization_id, is_active)
        VALUES ($1, $2, $3, $4, 'Sec Officer', 'Official', 'DEPT-HFW', $5, TRUE)
        ON CONFLICT (id) DO UPDATE SET password_hash = $3, role = $4, is_active = TRUE
      `, [u.id, u.email, passHash, u.role, u.orgId]);
    }

    // Login users to acquire tokens
    const login = async (email: string, role: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'DevPass@2026!', role }
      });
      return JSON.parse(res.body).token;
    };

    govToken = await login('sec.gov@s2s.gov.in', 'government');
    startupAToken = await login('alpha@startup.in', 'startup');
    startupBToken = await login('beta@startup.in', 'startup');
    inspectorToken = await login('sec.insp@s2s.gov.in', 'inspector');
    financeToken = await login('sec.fin@s2s.gov.in', 'finance');

    // Ensure test challenge exists
    await db.query(`
      INSERT INTO challenges (
        id, title, department_id, department_name, problem_statement, problem_category,
        desired_outcome, pilot_duration_months, budget_paise, deadline, status, created_by_user_id
      ) VALUES (
        'CH-DEMO-01', 'Sec Challenge', 'DEPT-HFW', 'Ministry of Health & Family Welfare',
        'Problem Statement', 'HealthTech', 'Desired Outcome', 3, 500000000,
        CURRENT_TIMESTAMP + INTERVAL '30 days', 'PUBLISHED', 'USR-SEC-GOV'
      ) ON CONFLICT (id) DO NOTHING
    `);

    // Create a proposal belonging to Startup Alpha
    await db.query(`
      INSERT INTO proposals (
        id, challenge_id, organization_id, startup_name, solution_title,
        problem_solution_fit, technical_approach, deployment_plan, implementation_timeline,
        pilot_cost_paise, scaleup_cost_paise, status
      ) VALUES (
        'PROP-SEC-ALPHA', 'CH-DEMO-01', 'ORG-ALPHA', 'Alpha Innovations', 'Alpha Triage Engine',
        'Direct fit for PHC requirements', 'Edge NN architecture', 'Deployment in 3 sites', '3 Months',
        100000000, 200000000, 'SELECTED'
      ) ON CONFLICT (id) DO NOTHING
    `);

    // Create a pilot belonging exclusively to Startup Alpha
    const pRes = await db.query(`
      INSERT INTO pilots (
        id, challenge_id, proposal_id, organization_id, department_id,
        name, startup_name, location, duration_months,
        contract_value_paise, original_contract_value_paise, status
      ) VALUES (
        'PLT-SEC-ALPHA', 'CH-DEMO-01', 'PROP-SEC-ALPHA', 'ORG-ALPHA', 'DEPT-HFW',
        'Alpha Diagnostic Pilot', 'Alpha Innovations', 'Delhi PHC', 3,
        100000000, 100000000, 'LAUNCHED'
      )
      ON CONFLICT (id) DO UPDATE SET organization_id = 'ORG-ALPHA'
      RETURNING id
    `);
    pilotIdA = pRes.rows[0].id;

    const msRes = await db.query(`
      INSERT INTO pilot_milestones (id, pilot_id, title, due_date, amount_paise, deliverable_description, status)
      VALUES ('MS-SEC-ALPHA-1', $1, 'Inception', CURRENT_TIMESTAMP + INTERVAL '30 days', 30000000, 'Deliverable', 'APPROVED')
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `, [pilotIdA]);
    milestoneIdA = msRes.rows[0]?.id || 'MS-SEC-ALPHA-1';
  });

  after(async () => {
    await app.close();
  });

  // 1. Unauthenticated Requests
  it('rejects unauthenticated requests to protected endpoints with 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/challenges',
      payload: { title: 'Unauthorized Challenge' }
    });
    assert.strictEqual(res.statusCode, 401);
  });

  // 2. Role Boundaries — Startup Forbidden from Government Actions
  it('blocks Startup from creating challenges, evaluating proposals, or approving shortlists (403 Forbidden)', async () => {
    // Attempt Challenge Creation
    const chalRes = await app.inject({
      method: 'POST',
      url: '/api/v1/challenges',
      headers: { Authorization: `Bearer ${startupAToken}` },
      payload: { title: 'Startup Malicious Challenge' }
    });
    assert.strictEqual(chalRes.statusCode, 403);

    // Attempt AI Proposal Evaluation
    const evalRes = await app.inject({
      method: 'POST',
      url: '/api/v1/proposals/PROP-101/ai-evaluate',
      headers: { Authorization: `Bearer ${startupAToken}` }
    });
    assert.strictEqual(evalRes.statusCode, 403);

    // Attempt Shortlist Approval
    const selRes = await app.inject({
      method: 'POST',
      url: '/api/v1/proposals/PROP-101/select',
      headers: { Authorization: `Bearer ${startupAToken}` },
      payload: { justification: 'Self selection attempt' }
    });
    assert.strictEqual(selRes.statusCode, 403);
  });

  // 3. Role Boundaries — Inspector Forbidden from Financial & Authoring Actions
  it('blocks Inspector from submitting payment claims or releasing disbursements (403 Forbidden)', async () => {
    // Attempt Claim Submission (only Startup allowed)
    const claimRes = await app.inject({
      method: 'POST',
      url: '/api/v1/finance/payments',
      headers: { Authorization: `Bearer ${inspectorToken}` },
      payload: {
        pilotId: pilotIdA,
        milestoneId: milestoneIdA,
        invoiceNumber: 'INV-INSP-ATTACK',
        invoiceDate: '2026-08-01',
        grossAmountPaise: 30000000
      }
    });
    assert.strictEqual(claimRes.statusCode, 403);

    // Attempt Treasury Disbursement (only Finance/Admin allowed)
    const disbRes = await app.inject({
      method: 'POST',
      url: '/api/v1/finance/payments/CLM-101/disburse',
      headers: { Authorization: `Bearer ${inspectorToken}` },
      payload: { disbursementReference: 'UTR-MALICIOUS-999' }
    });
    assert.strictEqual(disbRes.statusCode, 403);
  });

  // 4. Role Boundaries — Government Forbidden from Treasury Disbursement
  it('blocks Government Official from releasing treasury payments directly without Finance role (403 Forbidden)', async () => {
    const disbRes = await app.inject({
      method: 'POST',
      url: '/api/v1/finance/payments/CLM-101/disburse',
      headers: { Authorization: `Bearer ${govToken}` },
      payload: { disbursementReference: 'UTR-GOV-BYPASS' }
    });
    assert.strictEqual(disbRes.statusCode, 403);
  });

  // 5. Cross-Tenant IDOR Protection — Startup B cannot claim payments on Startup A pilot
  it('enforces Cross-Tenant Isolation: Startup B cannot claim payments for Startup A pilot (403 Forbidden)', async () => {
    const idorClaimRes = await app.inject({
      method: 'POST',
      url: '/api/v1/finance/payments',
      headers: { Authorization: `Bearer ${startupBToken}` },
      payload: {
        pilotId: pilotIdA, // Belongs to ORG-ALPHA!
        milestoneId: milestoneIdA,
        invoiceNumber: 'INV-ATTACK-001',
        invoiceDate: '2026-08-01',
        grossAmountPaise: 30000000
      }
    });

    assert.strictEqual(idorClaimRes.statusCode, 403);
    const body = JSON.parse(idorClaimRes.body);
    assert.ok(body.error.includes('cannot claim payments for other startups'));
  });

  // 6. Confidential Evaluation Scrubber (Spec Section 26)
  it('sanitizes proposals when viewed by Startup: internal evaluator notes and reviewer scores are never leaked', async () => {
    // Insert proposal with confidential evaluation data
    const pId = 'PROP-SEC-CONFIDENTIAL';
    await db.query(`
      INSERT INTO proposals (
        id, challenge_id, organization_id, startup_name, solution_title,
        problem_solution_fit, technical_approach, deployment_plan, implementation_timeline,
        pilot_cost_paise, scaleup_cost_paise, status
      )
      VALUES ($1, 'CH-DEMO-01', 'ORG-ALPHA', 'Alpha Innovations', 'Alpha Triage Engine', 'Confidential summary', 'Proprietary IP', 'Plan A', '3M', 10000000, 20000000, 'SUBMITTED')
      ON CONFLICT (id) DO NOTHING
    `, [pId]);

    await db.query(`
      INSERT INTO ai_evaluations (
        id, challenge_id, proposal_id, overall_score, problem_alignment_score,
        technical_feasibility_score, expected_impact_score, evidence_strength_score,
        deployment_readiness_score, cost_feasibility_score, risk_score,
        why_recommended, concerns, limitations, is_recommended_top3, basis_data,
        model_name, prompt_version
      ) VALUES (
        'EVAL-CONF-01', 'CH-DEMO-01', $1, 92, 90,
        90, 90, 90,
        90, 90, 10,
        '["Top candidate"]'::jsonb, '["High cloud dependency note: secret internal observation"]'::jsonb, '[]'::jsonb, TRUE, '{"secret": "internal"}'::jsonb,
        'mock-model', 'v1.0'
      ) ON CONFLICT (id) DO NOTHING
    `, [pId]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/proposals',
      headers: { Authorization: `Bearer ${startupAToken}` }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.data.length > 0);
    const found = body.data.find((p: any) => p.id === pId);
    assert.ok(found);

    // Startup response must NOT contain raw ai_evaluations internal basis_data or the evaluator's numeric scores
    assert.strictEqual(found.basis_data, undefined);
    assert.strictEqual(found.overall_score, undefined);
    assert.strictEqual(found.risk_score, undefined);
    // A startup may read the text of its OWN proposal (it wrote it) ...
    assert.strictEqual(found.technical_approach, 'Proprietary IP');

    // ... but a different startup must never see it (tenant isolation)
    const other = await app.inject({ method: 'GET', url: '/api/v1/proposals', headers: { Authorization: `Bearer ${startupBToken}` } });
    assert.strictEqual(other.statusCode, 200);
    assert.ok(!JSON.parse(other.body).data.some((p: any) => p.id === pId), 'another startup must not see this proposal');
    assert.ok(!other.body.includes('Proprietary IP'));
  });

  // 7. Audit Log Tamper Evident Proof
  it('mathematically detects database tampering in the audit log chain', async () => {
    // Verify chain is valid initially
    const initialCheck = await auditService.verifyChain();
    assert.strictEqual(initialCheck.valid, true);

    // Tamper with the latest audit log entry by altering its action directly in the DB
    const latestRes = await db.query('SELECT id, action FROM audit_logs ORDER BY timestamp DESC LIMIT 1');
    const targetEntry = latestRes.rows[0];

    await db.query(`UPDATE audit_logs SET action = 'MALICIOUS_TAMPERED_ACTION' WHERE id = $1`, [targetEntry.id]);

    // Re-verify chain: MUST fail with corrupted chain detection
    const tamperedCheck = await auditService.verifyChain();
    assert.strictEqual(tamperedCheck.valid, false);
    assert.strictEqual(tamperedCheck.brokenAtId, targetEntry.id);

    // Restore original action to keep test state clean
    await db.query(`UPDATE audit_logs SET action = $1 WHERE id = $2`, [targetEntry.action, targetEntry.id]);

    const restoredCheck = await auditService.verifyChain();
    assert.strictEqual(restoredCheck.valid, true);
  });
});
