import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { getDatabase, DatabaseAdapter } from '../src/db';
import { hashPassword } from '../src/security';

process.env.AUTH_RATE_MAX = '1000';
process.env.RATE_LIMIT_MAX = '5000';

describe('Payments: cheque lifecycle, two-person approval, tax ledger', () => {
  let app: FastifyInstance;
  let db: DatabaseAdapter;
  const PW = 'Adm1n#Passw0rd!';
  const tok: Record<string, string> = {};
  const J = (r: any) => JSON.parse(r.body);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const num = (v: any) => Number(BigInt(String(v)));
  const post = (url: string, who: string, payload: any = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: bearer(tok[who]), payload });
  const iso = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  const dept = async () => (await db.query(`SELECT * FROM departments WHERE id = 'DEPT-PAY'`)).rows[0];
  const claimRow = async (id: string) => (await db.query('SELECT * FROM finance_payment_claims WHERE id = $1', [id])).rows[0];

  /** Inserts a milestone and a SUBMITTED claim directly (the lifecycle suite already covers how they are really created). */
  async function mkClaim(id: string, grossPaise: number) {
    const tds = Math.round(grossPaise * 0.02), gst = Math.round(grossPaise * 0.02);
    await db.query(`INSERT INTO pilot_milestones (id, pilot_id, title, due_date, status) VALUES ($1,'PIL-PAY',$2, CURRENT_TIMESTAMP, 'VERIFIED')`, [`MS-${id}`, `Milestone ${id}`]);
    await db.query(
      `INSERT INTO finance_payment_claims (id, pilot_id, milestone_id, organization_id, department_id, invoice_number, invoice_date, gross_amount_paise, tds_paise, gst_paise, net_payable_paise, status, requester_user_id)
       VALUES ($1,'PIL-PAY',$2,'ORG-PAY','DEPT-PAY',$3, CURRENT_TIMESTAMP, $4,$5,$6,$7,'SUBMITTED','USR-PAY-ST')`,
      [id, `MS-${id}`, `INV-${id}`, grossPaise, tds, gst, grossPaise - tds - gst]
    );
  }

  before(async () => {
    db = getDatabase();
    app = await buildApp({ db });
    const h = await hashPassword(PW);
    await db.query(`INSERT INTO departments (id, name, code, ministry, budget_allocated_paise) VALUES ('DEPT-PAY','Payments Dept','PAY','Min',10000000000)`);
    await db.query(`INSERT INTO organizations (id, name, founder_name, founder_email, sector, verification_status) VALUES ('ORG-PAY','Pay Startup','F','f@pay.test','IT','VERIFIED')`);
    for (const [id, email, role, name, org, d] of [
      ['USR-PAY-ST', 'st@pay.test', 'startup', 'Startup User', 'ORG-PAY', null], ['USR-PAY-F1', 'f1@pay.test', 'finance', 'Finance One', null, 'DEPT-PAY'],
      ['USR-PAY-F2', 'f2@pay.test', 'finance', 'Finance Two', null, 'DEPT-PAY'], ['USR-PAY-F3', 'f3@pay.test', 'finance', 'Finance Three', null, 'DEPT-PAY'],
      ['USR-PAY-AD', 'ad@pay.test', 'admin', 'Admin', null, null], ['USR-PAY-GV', 'gv@pay.test', 'government', 'Gov', null, 'DEPT-PAY']
    ] as const) {
      await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation, organization_id, department_id) VALUES ($1,$2,$3,$4,$5,'x',$6,$7)`, [id, email, h, role, name, org, d]);
    }
    await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation) VALUES ('USR-PAY-CH','ch@pay.test',$1,'government','Creator','x')`, [h]);
    await db.query(`INSERT INTO challenges (id, title, department_id, department_name, problem_statement, problem_category, desired_outcome, deadline, created_by_user_id) VALUES ('CH-PAY','Challenge','DEPT-PAY','Payments Dept','p','c','o', CURRENT_TIMESTAMP + INTERVAL '30 days','USR-PAY-CH')`);
    await db.query(`INSERT INTO proposals (id, challenge_id, organization_id, startup_name, solution_title, problem_solution_fit, technical_approach, deployment_plan, implementation_timeline) VALUES ('PRO-PAY','CH-PAY','ORG-PAY','Pay Startup','s','f','t','d','3 months')`);
    await db.query(`INSERT INTO pilots (id, name, challenge_id, proposal_id, organization_id, startup_name, department_id, location) VALUES ('PIL-PAY','Pay Pilot','CH-PAY','PRO-PAY','ORG-PAY','Pay Startup','DEPT-PAY','Pune')`);
    for (const [k, email, role] of [['st', 'st@pay.test', 'startup'], ['f1', 'f1@pay.test', 'finance'], ['f2', 'f2@pay.test', 'finance'], ['f3', 'f3@pay.test', 'finance'], ['ad', 'ad@pay.test', 'admin'], ['gv', 'gv@pay.test', 'government']] as const) {
      const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PW, role } });
      assert.strictEqual(r.statusCode, 200, r.body); tok[k] = J(r).token;
    }
  });
  after(async () => { await app.close(); });

  describe('Cheque: spent only when it clears', () => {
    before(async () => { await mkClaim('CLM-A', 60_000_000); await mkClaim('CLM-B', 60_000_000); await mkClaim('CLM-C', 60_000_000); });

    it('approval reserves the money; recording a cheque does NOT spend it; clearing does', async () => {
      assert.strictEqual((await post('/finance/payments/CLM-A/approve', 'f1', { remarks: 'Checked against the inspection docket' })).statusCode, 200);
      assert.strictEqual(num((await dept()).budget_committed_paise), 60_000_000);

      const bad = (over: any) => post('/finance/payments/CLM-A/cheque', 'f1', { chequeNumber: '123456', chequeDate: iso(), draweeBank: 'State Bank of India', signatories: 'A. Rao, B. Iyer', ...over });
      assert.strictEqual((await bad({ chequeNumber: '12ab' })).statusCode, 400);
      assert.strictEqual((await bad({ chequeDate: iso(-200) })).statusCode, 400, 'a stale cheque date is refused');
      assert.strictEqual((await bad({ signatories: '' })).statusCode, 400);
      assert.strictEqual((await post('/finance/payments/CLM-A/cheque', 'st', { chequeNumber: '123456', chequeDate: iso(), draweeBank: 'SBI Main', signatories: 'A. Rao' })).statusCode, 403, 'the startup cannot record its own cheque');
      assert.strictEqual((await bad({})).statusCode, 200);

      const c = await claimRow('CLM-A');
      assert.strictEqual(c.status, 'CHEQUE_ISSUED'); assert.strictEqual(c.payment_method, 'CHEQUE');
      const d = await dept();
      assert.strictEqual(num(d.budget_disbursed_paise), 0, 'an uncleared cheque is not spending');
      assert.strictEqual(num(d.budget_committed_paise), 60_000_000, 'still reserved');
      const budget = J(await app.inject({ method: 'GET', url: '/api/v1/finance/budget', headers: bearer(tok.f1) }));
      assert.ok(budget.asOf, 'the budget view says when it was taken');
      assert.strictEqual(num(budget.departments.find((x: any) => x.id === 'DEPT-PAY').cheques_in_transit_paise), 57_600_000, 'cheques in transit = net payable');
      assert.strictEqual((await post('/finance/payments/CLM-A/disburse', 'f1', { disbursementReference: 'UTR1234567890' })).statusCode, 400, 'cannot also record an electronic payment while a cheque is out');

      assert.strictEqual((await post('/finance/payments/CLM-A/cheque/clear', 'f2', { clearedDate: iso(1) })).statusCode, 400, 'cannot clear in the future');
      assert.strictEqual((await post('/finance/payments/CLM-A/cheque/clear', 'f2', { clearedDate: iso() })).statusCode, 200);
      const paid = await claimRow('CLM-A');
      assert.strictEqual(paid.status, 'PAID'); assert.strictEqual(paid.disbursement_reference, 'CHQ-123456');
      const after = await dept();
      assert.strictEqual(num(after.budget_disbursed_paise), 60_000_000); assert.strictEqual(num(after.budget_committed_paise), 0);
      assert.strictEqual((await db.query(`SELECT status FROM pilot_milestones WHERE id = 'MS-CLM-A'`)).rows[0].status, 'PAID');
      assert.strictEqual((await post('/finance/payments/CLM-A/cheque/clear', 'f2', { clearedDate: iso() })).statusCode, 409, 'cannot clear twice');
    });

    it('a returned cheque goes back to approved, keeps the money reserved, and its number can never be reused', async () => {
      await post('/finance/payments/CLM-B/approve', 'f1', { remarks: 'Approved for payment by cheque' });
      const issue = (n: string) => post('/finance/payments/CLM-B/cheque', 'f1', { chequeNumber: n, chequeDate: iso(), draweeBank: 'state bank of india', signatories: 'A. Rao, B. Iyer' });
      assert.strictEqual((await issue('123456')).statusCode, 409, 'number already used (case-insensitive bank name)');
      assert.strictEqual((await issue('223344')).statusCode, 200);
      assert.strictEqual((await post('/finance/payments/CLM-B/cheque/bounce', 'f1', { reason: 'x' })).statusCode, 400);
      assert.strictEqual((await post('/finance/payments/CLM-B/cheque/bounce', 'f1', { reason: 'Returned: insufficient funds in drawer account' })).statusCode, 200);
      const c = await claimRow('CLM-B');
      assert.strictEqual(c.status, 'APPROVED'); assert.strictEqual(c.cheque_number, null);
      assert.strictEqual(num((await dept()).budget_committed_paise), 60_000_000, 'money stays reserved');
      assert.deepStrictEqual((c.cheque_history as any[]).map((h) => h.event), ['ISSUED', 'BOUNCED']);
      assert.strictEqual((await issue('223344')).statusCode, 409, 'a returned cheque number is burned');
      assert.strictEqual((await issue('223345')).statusCode, 200);
      assert.strictEqual((await post('/finance/payments/CLM-B/cheque/clear', 'f1', { clearedDate: iso() })).statusCode, 200);
    });

    it('an electronic payment still works the old way and uses the same ledger', async () => {
      await post('/finance/payments/CLM-C/approve', 'f1', { remarks: 'Approved for electronic transfer' });
      assert.strictEqual((await post('/finance/payments/CLM-C/disburse', 'f1', { disbursementReference: 'UTR9876543210' })).statusCode, 200);
      const c = await claimRow('CLM-C');
      assert.strictEqual(c.status, 'PAID'); assert.strictEqual(c.payment_method, 'ELECTRONIC');
    });
  });

  describe('Tax ledger', () => {
    it('every paid claim puts its TDS and GST-TDS on the ledger as DEDUCTED, and remitting records the challan', async () => {
      const led = J(await app.inject({ method: 'GET', url: '/api/v1/finance/tax-ledger', headers: bearer(tok.f1) }));
      const mine = led.entries.filter((x: any) => x.department_name === 'Payments Dept'); // other test files may share the database
      assert.strictEqual(mine.length, 6, '3 paid claims x (TDS + GST-TDS)');
      assert.ok(mine.every((x: any) => x.status === 'DEDUCTED'));
      assert.strictEqual(mine.reduce((a: number, x: any) => a + num(x.amount_paise), 0), 3 * 2 * 1_200_000);
      const e = mine[0];
      assert.strictEqual((await post(`/finance/tax-ledger/${e.id}/remit`, 'f1', { challanNumber: 'x', challanDate: iso() })).statusCode, 400);
      assert.strictEqual((await post(`/finance/tax-ledger/${e.id}/remit`, 'f1', { challanNumber: 'CHALLAN-0001', challanDate: iso(1) })).statusCode, 400, 'challan cannot be dated in the future');
      assert.strictEqual((await post(`/finance/tax-ledger/${e.id}/remit`, 'st', { challanNumber: 'CHALLAN-0001', challanDate: iso() })).statusCode, 403);
      assert.strictEqual((await post(`/finance/tax-ledger/${e.id}/remit`, 'f1', { challanNumber: 'CHALLAN-0001', challanDate: iso() })).statusCode, 200);
      assert.strictEqual((await post(`/finance/tax-ledger/${e.id}/remit`, 'f1', { challanNumber: 'CHALLAN-0002', challanDate: iso() })).statusCode, 409);
      const after = J(await app.inject({ method: 'GET', url: '/api/v1/finance/tax-ledger?status=REMITTED', headers: bearer(tok.f1) }));
      const remitted = after.entries.filter((x: any) => x.department_name === 'Payments Dept');
      assert.strictEqual(remitted.length, 1); assert.strictEqual(num(remitted[0].amount_paise), 1_200_000);
      const csv = await app.inject({ method: 'GET', url: '/api/v1/finance/reports/tax-ledger.csv', headers: bearer(tok.f1) });
      assert.strictEqual(csv.statusCode, 200); assert.match(csv.body, /CHALLAN-0001/); assert.match(csv.headers['content-type'] as string, /text\/csv/);
      assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/finance/tax-ledger', headers: bearer(tok.st) })).statusCode, 403);
      assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/finance/tax-ledger', headers: bearer(tok.gv) })).statusCode, 403);
    });
  });

  describe('Two-person approval for large payments', () => {
    before(async () => { await mkClaim('CLM-BIG', 600_000_000); });

    it('the default threshold is ₹50,00,000 and an administrator can change it', async () => {
      const s = J(await app.inject({ method: 'GET', url: '/api/v1/admin/settings', headers: bearer(tok.ad) })).settings;
      assert.strictEqual(s.dualApprovalThresholdPaise, '500000000');
      assert.strictEqual((await app.inject({ method: 'PUT', url: '/api/v1/admin/settings', headers: bearer(tok.ad), payload: { dualApprovalThresholdPaise: '-5' } })).statusCode, 400);
      assert.strictEqual((await app.inject({ method: 'PUT', url: '/api/v1/admin/settings', headers: bearer(tok.f1), payload: { dualApprovalThresholdPaise: '100' } })).statusCode, 403, 'only an administrator');
    });

    it('the first approval only records; a DIFFERENT officer must give the second; nothing is reserved until then', async () => {
      const before = num((await dept()).budget_committed_paise);
      const r1 = await post('/finance/payments/CLM-BIG/approve', 'f1', { remarks: 'First approval after checking the docket' });
      assert.strictEqual(r1.statusCode, 200); assert.strictEqual(J(r1).awaitingSecondApproval, true);
      assert.strictEqual((await claimRow('CLM-BIG')).status, 'AWAITING_SECOND_APPROVAL');
      assert.strictEqual(num((await dept()).budget_committed_paise), before, 'no money reserved yet');
      const again = await post('/finance/payments/CLM-BIG/approve', 'f1', { remarks: 'Trying to approve it twice myself' });
      assert.strictEqual(again.statusCode, 403); assert.strictEqual(J(again).code, 'TWO_PERSON_RULE');
      assert.strictEqual((await post('/finance/payments/CLM-BIG/cheque', 'f3', { chequeNumber: '555555', chequeDate: iso(), draweeBank: 'HDFC', signatories: 'A. Rao' })).statusCode, 409, 'cannot pay before the second approval');
      const r2 = await post('/finance/payments/CLM-BIG/approve', 'f2', { remarks: 'Second approval, figures verified' });
      assert.strictEqual(r2.statusCode, 200); assert.strictEqual(J(r2).awaitingSecondApproval, undefined);
      const c = await claimRow('CLM-BIG');
      assert.strictEqual(c.status, 'APPROVED'); assert.strictEqual(c.first_reviewer_user_id, 'USR-PAY-F1'); assert.strictEqual(c.approver_user_id, 'USR-PAY-F2');
      assert.strictEqual(num((await dept()).budget_committed_paise), before + 600_000_000);
    });

    it('segregation of duties: neither approver may record the payment; a third officer does', async () => {
      for (const who of ['f1', 'f2']) {
        const r = await post('/finance/payments/CLM-BIG/cheque', who, { chequeNumber: '555555', chequeDate: iso(), draweeBank: 'HDFC Bank', signatories: 'A. Rao, B. Iyer' });
        assert.strictEqual(r.statusCode, 403, `${who} approved it`); assert.strictEqual(J(r).code, 'SEGREGATION_OF_DUTIES');
        assert.strictEqual((await post('/finance/payments/CLM-BIG/disburse', who, { disbursementReference: 'UTR5555555555' })).statusCode, 403);
      }
      assert.strictEqual((await post('/finance/payments/CLM-BIG/cheque', 'f3', { chequeNumber: '555555', chequeDate: iso(), draweeBank: 'HDFC Bank', signatories: 'A. Rao, B. Iyer' })).statusCode, 200);
      assert.strictEqual((await post('/finance/payments/CLM-BIG/cheque/clear', 'f3', { clearedDate: iso() })).statusCode, 200);
      assert.strictEqual((await claimRow('CLM-BIG')).status, 'PAID');
    });

    it('lowering the threshold makes ordinary claims need two people too', async () => {
      assert.strictEqual((await app.inject({ method: 'PUT', url: '/api/v1/admin/settings', headers: bearer(tok.ad), payload: { dualApprovalThresholdPaise: '1000000' } })).statusCode, 200);
      await mkClaim('CLM-SMALL', 5_000_000);
      const r = await post('/finance/payments/CLM-SMALL/approve', 'f1', { remarks: 'First approval of a small claim' });
      assert.strictEqual(J(r).awaitingSecondApproval, true);
      assert.strictEqual((await app.inject({ method: 'PUT', url: '/api/v1/admin/settings', headers: bearer(tok.ad), payload: { dualApprovalThresholdPaise: '500000000' } })).statusCode, 200);
    });
  });
});
