import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { getDatabase, DatabaseAdapter } from '../src/db';
import { hashPassword, encryptField } from '../src/security';

process.env.AUTH_RATE_MAX = '1000';
process.env.RATE_LIMIT_MAX = '5000';

describe('Pipeline: bank payment files, scale-up and appeals', () => {
  let app: FastifyInstance; let db: DatabaseAdapter;
  const PW = 'Adm1n#Passw0rd!'; const tok: Record<string, string> = {};
  const J = (r: any) => JSON.parse(r.body); const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const call = (method: string, url: string, who: string, payload?: any) => app.inject({ method: method as any, url: `/api/v1${url}`, headers: bearer(tok[who]), ...(payload !== undefined ? { payload } : {}) });

  async function mkClaim(id: string, gross: number, status: string, org = 'ORG-PP1', extra: Record<string, any> = {}) {
    await db.query(`INSERT INTO pilot_milestones (id, pilot_id, title, due_date, status) VALUES ($1,'PIL-PP',$2, CURRENT_TIMESTAMP,'VERIFIED')`, [`MS-${id}`, id]);
    await db.query(`INSERT INTO finance_payment_claims (id, pilot_id, milestone_id, organization_id, department_id, invoice_number, invoice_date, gross_amount_paise, tds_paise, gst_paise, net_payable_paise, status, requester_user_id) VALUES ($1,'PIL-PP',$2,$3,'DEPT-PP',$4, CURRENT_TIMESTAMP, $5, 0, 0, $5, $6,'PP-ST1')`, [id, `MS-${id}`, org, `INV-${id}`, gross, status]);
    for (const [k, v] of Object.entries(extra)) await db.query(`UPDATE finance_payment_claims SET ${k} = $2 WHERE id = $1`, [id, v]);
  }

  before(async () => {
    db = getDatabase(); app = await buildApp({ db });
    const h = await hashPassword(PW);
    for (const d of ['PP', 'PQ']) await db.query(`INSERT INTO departments (id, name, code, ministry, budget_allocated_paise) VALUES ($1,$2,$3,'Min',10000000000)`, [`DEPT-${d}`, `Dept ${d}`, `P-${d}`]);
    await db.query(`INSERT INTO organizations (id, name, founder_name, founder_email, sector, verification_status, bank_account_encrypted, bank_account_masked, ifsc_code) VALUES ('ORG-PP1','=SUM(Evil) Labs','F','f1@pp.test','IT','VERIFIED',$1,'•••• 9012','HDFC0000140')`, [encryptField('123456789012')]);
    await db.query(`INSERT INTO organizations (id, name, founder_name, founder_email, sector, verification_status, bank_account_encrypted, bank_account_masked, ifsc_code) VALUES ('ORG-PP2','No Bank Labs','F','f2@pp.test','IT','VERIFIED','not-valid-ciphertext','•••• 0000','HDFC0000140')`);
    for (const [id, email, role, org, dept] of [['PP-ST1', 'st1@pp.test', 'startup', 'ORG-PP1', null], ['PP-ST2', 'st2@pp.test', 'startup', 'ORG-PP2', null], ['PP-G1', 'g1@pp.test', 'government', null, 'DEPT-PP'], ['PP-G2', 'g2@pp.test', 'government', null, 'DEPT-PP'], ['PP-GQ', 'gq@pp.test', 'government', null, 'DEPT-PQ'], ['PP-F1', 'f1@pp.test', 'finance', null, 'DEPT-PP'], ['PP-F2', 'f2@pp.test', 'finance', null, 'DEPT-PP'], ['PP-F3', 'f3@pp.test', 'finance', null, 'DEPT-PP'], ['PP-AD', 'ad@pp.test', 'admin', null, null]] as const) {
      await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation, organization_id, department_id) VALUES ($1,$2,$3,$4,$5,'x',$6,$7)`, [id, email, h, role, id, org, dept]);
    }
    for (const [k, email, role] of [['st1', 'st1@pp.test', 'startup'], ['st2', 'st2@pp.test', 'startup'], ['g1', 'g1@pp.test', 'government'], ['g2', 'g2@pp.test', 'government'], ['gq', 'gq@pp.test', 'government'], ['f1', 'f1@pp.test', 'finance'], ['f2', 'f2@pp.test', 'finance'], ['f3', 'f3@pp.test', 'finance'], ['ad', 'ad@pp.test', 'admin']] as const) {
      const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PW, role } }); assert.strictEqual(r.statusCode, 200, r.body); tok[k] = J(r).token;
    }
    await db.query(`INSERT INTO challenges (id, title, department_id, department_name, problem_statement, problem_category, desired_outcome, deadline, status, created_by_user_id) VALUES ('CH-PP','Challenge','DEPT-PP','Dept PP','p','c','o', CURRENT_TIMESTAMP + INTERVAL '30 days','PUBLISHED','PP-G1')`);
    for (const [id, org, st] of [['PRO-PP1', 'ORG-PP1', 'SELECTED'], ['PRO-PP2', 'ORG-PP1', 'NOT_SHORTLISTED'], ['PRO-PP3', 'ORG-PP2', 'REJECTED'], ['PRO-PP4', 'ORG-PP1', 'SUBMITTED']] as const) {
      await db.query(`INSERT INTO proposals (id, challenge_id, organization_id, startup_name, solution_title, problem_solution_fit, technical_approach, deployment_plan, implementation_timeline, status) VALUES ($1,'CH-PP',$2,'S','Title '||$1,'f','t','d','3 months',$3)`, [id, org, st]);
    }
    await db.query(`INSERT INTO pilots (id, name, challenge_id, proposal_id, organization_id, startup_name, department_id, location, status) VALUES ('PIL-PP','Validated pilot','CH-PP','PRO-PP1','ORG-PP1','Org','DEPT-PP','Pune','VALIDATED')`);
    await db.query(`INSERT INTO pilots (id, name, challenge_id, proposal_id, organization_id, startup_name, department_id, location, status) VALUES ('PIL-PP2','Running pilot','CH-PP','PRO-PP4','ORG-PP1','Org','DEPT-PP','Pune','IN_PROGRESS')`);
  });
  after(async () => { await app.close(); });

  describe('Bank payment file', () => {
    before(async () => {
      await mkClaim('PCL-1', 5000000, 'APPROVED'); await mkClaim('PCL-2', 7000000, 'APPROVED', 'ORG-PP2'); await mkClaim('PCL-3', 3000000, 'SUBMITTED');
      await mkClaim('PCL-CH', 4000000, 'APPROVED', 'ORG-PP1', { payment_method: 'CHEQUE' });
      await mkClaim('PCL-BIG', 600000000, 'APPROVED', 'ORG-PP1', { approver_user_id: 'PP-F2', first_reviewer_user_id: 'PP-F1' });
    });
    const gen = (who: string, templateId: string, claimIds: string[]) => call('POST', '/finance/payment-file', who, { templateId, claimIds });

    it('builds a file from approved electronic claims with the real account number, formula-safe, and records the export without any account number', async () => {
      const r = await gen('f1', 'builtin-generic', ['PCL-1']);
      assert.strictEqual(r.statusCode, 200, r.body); assert.match(r.headers['content-type'] as string, /text\/csv/);
      const [head, row] = r.body.trim().split('\r\n');
      assert.strictEqual(head, 'Beneficiary name,Account number,IFSC,Amount (INR),Narration,Reference,Payment date');
      assert.match(row, /^'=SUM\(Evil\) Labs,123456789012,HDFC0000140,50000\.00,S2S INV-PCL-1,PCL-1,\d{4}-\d{2}-\d{2}$/, 'a name starting with = is neutralised, the amount is exact');
      assert.ok((await db.query(`SELECT payment_file_exported_at FROM finance_payment_claims WHERE id = 'PCL-1'`)).rows[0].payment_file_exported_at);
      const audit = (await db.query(`SELECT details FROM audit_logs WHERE action = 'PAYMENT_FILE_EXPORTED' ORDER BY id DESC LIMIT 1`)).rows[0];
      assert.ok(!JSON.stringify(audit).includes('123456789012'), 'the audit trail never holds an account number');
    });
    it('refuses wrong claims, missing bank details and the wrong people', async () => {
      assert.strictEqual((await gen('f1', 'builtin-generic', ['PCL-3'])).statusCode, 409, 'not approved yet');
      assert.strictEqual((await gen('f1', 'builtin-generic', ['PCL-CH'])).statusCode, 409, 'cheques are not bank files');
      const noBank = await gen('f1', 'builtin-generic', ['PCL-2']);
      assert.strictEqual(noBank.statusCode, 409); assert.strictEqual(J(noBank).code, 'BANK_DETAILS_MISSING');
      assert.strictEqual((await gen('f1', 'builtin-generic', ['PCL-NOPE'])).statusCode, 404);
      assert.strictEqual((await gen('f1', 'no-such-layout', ['PCL-1'])).statusCode, 404);
      assert.strictEqual((await gen('st1', 'builtin-generic', ['PCL-1'])).statusCode, 403);
      assert.strictEqual((await gen('g1', 'builtin-generic', ['PCL-1'])).statusCode, 403);
      assert.strictEqual((await call('POST', '/finance/payment-file', 'f1', { templateId: 'builtin-generic', claimIds: [] })).statusCode, 400);
    });
    it('for a payment above the two-person threshold, neither approver may prepare the file; a third officer can', async () => {
      for (const who of ['f1', 'f2']) { const r = await gen(who, 'builtin-generic', ['PCL-BIG']); assert.strictEqual(r.statusCode, 403, who); assert.strictEqual(J(r).code, 'SEGREGATION_OF_DUTIES'); }
      assert.strictEqual((await gen('f3', 'builtin-generic', ['PCL-BIG'])).statusCode, 200);
    });
    it('an administrator defines a bank-specific layout (delimiter, date format, fixed columns); finance can use it; built-ins cannot be deleted', async () => {
      const layout = { name: 'Example Bank bulk', delimiter: '|', dateFormat: 'DDMMYYYY', includeHeader: false, columns: [{ header: '', field: 'fixed', value: 'N' }, { header: '', field: 'accountNumber' }, { header: '', field: 'amountPaise' }, { header: '', field: 'paymentDate' }, { header: '', field: 'beneficiaryName' }] };
      assert.strictEqual((await call('POST', '/finance/payment-file/templates', 'f1', layout)).statusCode, 403, 'only administrators define layouts');
      assert.strictEqual((await call('POST', '/finance/payment-file/templates', 'ad', { ...layout, columns: [{ header: '', field: 'fixed' }] })).statusCode, 400, 'a fixed column needs a value');
      assert.strictEqual((await call('POST', '/finance/payment-file/templates', 'ad', { ...layout, columns: [{ header: '', field: 'password' }] })).statusCode, 400, 'unknown fields are refused');
      const created = await call('POST', '/finance/payment-file/templates', 'ad', layout); assert.strictEqual(created.statusCode, 201);
      assert.strictEqual((await call('POST', '/finance/payment-file/templates', 'ad', layout)).statusCode, 409, 'names are unique');
      const id = J(created).id;
      assert.ok(J(await call('GET', '/finance/payment-file/templates', 'f1')).templates.some((t: any) => t.id === id));
      const out = await gen('f1', id, ['PCL-1']);
      assert.match(out.body.trim(), /^N\|123456789012\|5000000\|\d{8}\|'=SUM\(Evil\) Labs$/);
      assert.strictEqual((await call('DELETE', '/finance/payment-file/templates/builtin-generic', 'ad')).statusCode, 404);
      assert.strictEqual((await call('DELETE', `/finance/payment-file/templates/${id}`, 'ad')).statusCode, 200);
    });
  });

  describe('Scale-up pipeline', () => {
    let planId = '';
    const body = { pilotId: 'PIL-PP', rationale: 'The pilot met every KPI and the ward staff want it extended to the whole city.', proposedValuePaise: 900000000 };
    it('only the owning department can recommend, only after validation, and only once', async () => {
      assert.strictEqual((await call('POST', '/pipeline/scaleup', 'g1', { ...body, rationale: 'too short' })).statusCode, 400);
      assert.strictEqual((await call('POST', '/pipeline/scaleup', 'gq', body)).statusCode, 403, 'another department');
      assert.strictEqual((await call('POST', '/pipeline/scaleup', 'st1', body)).statusCode, 403);
      assert.strictEqual((await call('POST', '/pipeline/scaleup', 'g1', { ...body, pilotId: 'PIL-PP2' })).statusCode, 409, 'a running pilot cannot scale up yet');
      const ok = await call('POST', '/pipeline/scaleup', 'g1', body); assert.strictEqual(ok.statusCode, 201); planId = J(ok).id;
      assert.strictEqual((await call('POST', '/pipeline/scaleup', 'g1', body)).statusCode, 409, 'once per pilot');
    });
    it('two-person rule: the recommender cannot decide; another officer or an administrator can; the startup is told', async () => {
      const own = await call('POST', `/pipeline/scaleup/${planId}/decide`, 'g1', { decision: 'APPROVED', note: 'I recommended it myself.' });
      assert.strictEqual(own.statusCode, 403); assert.strictEqual(J(own).code, 'TWO_PERSON_RULE');
      assert.strictEqual((await call('POST', `/pipeline/scaleup/${planId}/decide`, 'gq', { decision: 'APPROVED', note: 'Another department decides?' })).statusCode, 403);
      assert.strictEqual((await call('POST', `/pipeline/scaleup/${planId}/decide`, 'g2', { decision: 'APPROVED', note: 'short' })).statusCode, 400);
      assert.strictEqual((await call('POST', `/pipeline/scaleup/${planId}/decide`, 'g2', { decision: 'APPROVED', note: 'KPIs verified by the inspector; budget confirmed.' })).statusCode, 200);
      assert.strictEqual((await call('POST', `/pipeline/scaleup/${planId}/decide`, 'ad', { decision: 'DECLINED', note: 'Trying to flip a decision later.' })).statusCode, 409);
      assert.ok((await db.query(`SELECT 1 FROM notifications WHERE title = 'Scale-up approved'`)).rows.length >= 1);
    });
    it('visibility is scoped: the startup sees its own plans, the department its own, an unrelated department none', async () => {
      assert.strictEqual(J(await call('GET', '/pipeline/scaleup', 'st1')).plans.length, 1);
      assert.strictEqual(J(await call('GET', '/pipeline/scaleup', 'st2')).plans.length, 0);
      assert.strictEqual(J(await call('GET', '/pipeline/scaleup', 'g2')).plans.length, 1);
      assert.strictEqual(J(await call('GET', '/pipeline/scaleup', 'gq')).plans.length, 0);
      assert.strictEqual((await call('GET', '/pipeline/scaleup', 'f1')).statusCode, 403);
    });
  });

  describe('Appeals', () => {
    let appealId = '';
    it('a startup can appeal its own rejected proposal once, with reasons, inside the window', async () => {
      const reason = 'The evaluation ignored our deployment at two district hospitals that is documented in the proposal.';
      assert.strictEqual((await call('POST', '/pipeline/appeals', 'st1', { proposalId: 'PRO-PP2', reason: 'unfair' })).statusCode, 400);
      assert.strictEqual((await call('POST', '/pipeline/appeals', 'st1', { proposalId: 'PRO-PP3', reason })).statusCode, 404, 'not its proposal');
      assert.strictEqual((await call('POST', '/pipeline/appeals', 'st1', { proposalId: 'PRO-PP4', reason })).statusCode, 409, 'still in the running');
      assert.strictEqual((await call('POST', '/pipeline/appeals', 'g1', { proposalId: 'PRO-PP2', reason })).statusCode, 403);
      const ok = await call('POST', '/pipeline/appeals', 'st1', { proposalId: 'PRO-PP2', reason }); assert.strictEqual(ok.statusCode, 201); appealId = J(ok).id;
      assert.strictEqual((await call('POST', '/pipeline/appeals', 'st1', { proposalId: 'PRO-PP2', reason })).statusCode, 409, 'once');
      await db.query(`UPDATE proposals SET updated_at = CURRENT_TIMESTAMP - INTERVAL '20 days' WHERE id = 'PRO-PP3'`);
      const late = await call('POST', '/pipeline/appeals', 'st2', { proposalId: 'PRO-PP3', reason });
      assert.strictEqual(late.statusCode, 409); assert.strictEqual(J(late).code, 'APPEAL_WINDOW_CLOSED');
    });
    it('only an administrator decides; the department can read but not decide; an upheld appeal sends the proposal back to review', async () => {
      assert.strictEqual((await call('POST', `/pipeline/appeals/${appealId}/decide`, 'g1', { decision: 'UPHELD', note: 'The department judging itself.' })).statusCode, 403);
      assert.strictEqual(J(await call('GET', '/pipeline/appeals', 'g1')).appeals.length, 1, 'the department can see it');
      assert.strictEqual(J(await call('GET', '/pipeline/appeals', 'gq')).appeals.length, 0);
      assert.strictEqual((await call('POST', `/pipeline/appeals/${appealId}/decide`, 'ad', { decision: 'UPHELD', note: 'short' })).statusCode, 400);
      assert.strictEqual((await call('POST', `/pipeline/appeals/${appealId}/decide`, 'ad', { decision: 'UPHELD', note: 'The documented deployments were not scored; please re-evaluate.' })).statusCode, 200);
      assert.strictEqual((await db.query(`SELECT status FROM proposals WHERE id = 'PRO-PP2'`)).rows[0].status, 'UNDER_REVIEW');
      assert.strictEqual((await call('POST', `/pipeline/appeals/${appealId}/decide`, 'ad', { decision: 'DISMISSED', note: 'Changing my mind afterwards.' })).statusCode, 409);
      assert.ok((await db.query(`SELECT 1 FROM notifications WHERE title = 'Appeal upheld: proposal back in review'`)).rows.length >= 1);
    });
  });
});
