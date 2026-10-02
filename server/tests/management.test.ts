import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { getDatabase, DatabaseAdapter } from '../src/db';
import { hashPassword } from '../src/security';

process.env.AUTH_RATE_MAX = '1000';
process.env.RATE_LIMIT_MAX = '5000';

describe('Management actions: pilots, proposals, challenges', () => {
  let app: FastifyInstance; let db: DatabaseAdapter;
  const PW = 'Adm1n#Passw0rd!';
  const tok: Record<string, string> = {};
  const J = (r: any) => JSON.parse(r.body);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (url: string, who: string, payload: any = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: bearer(tok[who]), payload });
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString();

  before(async () => {
    db = getDatabase(); app = await buildApp({ db });
    const h = await hashPassword(PW);
    for (const d of ['A', 'B']) await db.query(`INSERT INTO departments (id, name, code, ministry, budget_allocated_paise) VALUES ($1,$2,$3,'Min',1000000000)`, [`DEPT-MGT-${d}`, `Dept ${d}`, `MGT-${d}`]);
    for (const o of ['A', 'B']) await db.query(`INSERT INTO organizations (id, name, founder_name, founder_email, sector, verification_status) VALUES ($1,$2,'F',$3,'IT','VERIFIED')`, [`ORG-${o}`, `Org ${o}`, `f@${o}.test`]);
    for (const [id, email, role, org, dept] of [['U-GA', 'ga@m.test', 'government', null, 'DEPT-MGT-A'], ['U-GB', 'gb@m.test', 'government', null, 'DEPT-MGT-B'], ['U-SA', 'sa@m.test', 'startup', 'ORG-A', null], ['U-SB', 'sb@m.test', 'startup', 'ORG-B', null], ['U-FIN', 'fin@m.test', 'finance', null, 'DEPT-MGT-A']] as const) {
      await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation, organization_id, department_id) VALUES ($1,$2,$3,$4,$5,'x',$6,$7)`, [id, email, h, role, id, org, dept]);
    }
    await db.query(`INSERT INTO challenges (id, title, department_id, department_name, problem_statement, problem_category, desired_outcome, deadline, status, created_by_user_id) VALUES ('CH-M','Challenge','DEPT-MGT-A','Dept A','p','c','o', CURRENT_TIMESTAMP + INTERVAL '10 days','PUBLISHED','U-GA')`);
    await db.query(`INSERT INTO challenges (id, title, department_id, department_name, problem_statement, problem_category, desired_outcome, deadline, status, created_by_user_id) VALUES ('CH-D','Draft','DEPT-MGT-A','Dept A','p','c','o', CURRENT_TIMESTAMP + INTERVAL '10 days','DRAFT','U-GA')`);
    for (const [id, org, st] of [['PRO-1', 'ORG-A', 'SUBMITTED'], ['PRO-2', 'ORG-A', 'SELECTED'], ['PRO-3', 'ORG-B', 'SUBMITTED']] as const) {
      await db.query(`INSERT INTO proposals (id, challenge_id, organization_id, startup_name, solution_title, problem_solution_fit, technical_approach, deployment_plan, implementation_timeline, status) VALUES ($1,'CH-M',$2,'S','s','f','t','d','3 months',$3)`, [id, org, st]);
    }
    await db.query(`INSERT INTO pilots (id, name, challenge_id, proposal_id, organization_id, startup_name, department_id, location, duration_months) VALUES ('PIL-M','Pilot','CH-M','PRO-2','ORG-A','Org A','DEPT-MGT-A','Pune',4)`);
    for (const [k, email, role] of [['ga', 'ga@m.test', 'government'], ['gb', 'gb@m.test', 'government'], ['sa', 'sa@m.test', 'startup'], ['sb', 'sb@m.test', 'startup'], ['fin', 'fin@m.test', 'finance']] as const) {
      const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PW, role } });
      assert.strictEqual(r.statusCode, 200, r.body); tok[k] = J(r).token;
    }
  });
  after(async () => { await app.close(); });

  it('a pilot can be extended by its own department only, with a reason', async () => {
    assert.strictEqual((await post('/pilots/PIL-M/extend', 'ga', { months: 0, reason: 'Needs more time for rollout' })).statusCode, 400);
    assert.strictEqual((await post('/pilots/PIL-M/extend', 'ga', { months: 2, reason: 'short' })).statusCode, 400);
    assert.strictEqual((await post('/pilots/PIL-M/extend', 'gb', { months: 2, reason: 'Not my department at all' })).statusCode, 403);
    assert.strictEqual((await post('/pilots/PIL-M/extend', 'sa', { months: 2, reason: 'The startup asking for itself' })).statusCode, 403);
    assert.strictEqual((await post('/pilots/PIL-M/extend', 'ga', { months: 2, reason: 'Monsoon delayed the field installation' })).statusCode, 200);
    assert.strictEqual(Number((await db.query(`SELECT duration_months FROM pilots WHERE id = 'PIL-M'`)).rows[0].duration_months), 6);
    assert.ok((await db.query(`SELECT 1 FROM audit_logs WHERE action = 'PILOT_EXTENDED'`)).rows.length === 1);
  });

  it('a pilot cannot be terminated while money is committed, and termination needs a reason', async () => {
    await db.query(`INSERT INTO pilot_milestones (id, pilot_id, title, due_date, status) VALUES ('MS-M','PIL-M','M1', CURRENT_TIMESTAMP, 'VERIFIED')`);
    await db.query(`INSERT INTO finance_payment_claims (id, pilot_id, milestone_id, organization_id, department_id, invoice_number, invoice_date, gross_amount_paise, net_payable_paise, status, requester_user_id) VALUES ('CLM-M','PIL-M','MS-M','ORG-A','DEPT-MGT-A','INV-M', CURRENT_TIMESTAMP, 1000000, 960000, 'APPROVED','U-SA')`);
    assert.strictEqual((await post('/pilots/PIL-M/terminate', 'ga', { reason: 'short' })).statusCode, 400);
    const blocked = await post('/pilots/PIL-M/terminate', 'ga', { reason: 'Startup stopped responding to the department' });
    assert.strictEqual(blocked.statusCode, 409); assert.strictEqual(J(blocked).code, 'PAYMENTS_IN_FLIGHT');
    await db.query(`UPDATE finance_payment_claims SET status = 'REJECTED' WHERE id = 'CLM-M'`);
    assert.strictEqual((await post('/pilots/PIL-M/terminate', 'gb', { reason: 'Another department cannot do this' })).statusCode, 403);
    assert.strictEqual((await post('/pilots/PIL-M/terminate', 'ga', { reason: 'Startup stopped responding to the department' })).statusCode, 200);
    assert.strictEqual((await db.query(`SELECT status FROM pilots WHERE id = 'PIL-M'`)).rows[0].status, 'TERMINATED');
    assert.strictEqual((await post('/pilots/PIL-M/terminate', 'ga', { reason: 'Trying to terminate it a second time' })).statusCode, 409);
    assert.strictEqual((await post('/pilots/PIL-M/extend', 'ga', { months: 1, reason: 'Extending a terminated pilot' })).statusCode, 409);
  });

  it('a startup can withdraw its own open proposal, but not a selected one or another startup\'s', async () => {
    assert.strictEqual((await post('/proposals/PRO-1/withdraw', 'sb')).statusCode, 404, 'not its proposal');
    assert.strictEqual((await post('/proposals/PRO-2/withdraw', 'sa')).statusCode, 409, 'already selected');
    assert.strictEqual((await post('/proposals/PRO-1/withdraw', 'ga')).statusCode, 403, 'officials do not withdraw for startups');
    assert.strictEqual((await post('/proposals/PRO-1/withdraw', 'sa')).statusCode, 200);
    assert.strictEqual((await db.query(`SELECT status FROM proposals WHERE id = 'PRO-1'`)).rows[0].status, 'WITHDRAWN');
    assert.strictEqual((await post('/proposals/PRO-1/withdraw', 'sa')).statusCode, 409);
    assert.strictEqual((await post('/proposals/PRO-1/select', 'ga', { remarks: 'Selecting a withdrawn proposal by mistake' })).statusCode, 409, 'a withdrawn proposal cannot be selected');
  });

  it('a challenge deadline can only move later, by its own department, and the change is announced', async () => {
    assert.strictEqual((await post('/challenges/CH-M/extend-deadline', 'ga', { deadline: day(2), reason: 'Earlier than the current date' })).statusCode, 400);
    assert.strictEqual((await post('/challenges/CH-M/extend-deadline', 'gb', { deadline: day(20), reason: 'Not my department at all' })).statusCode, 403);
    assert.strictEqual((await post('/challenges/CH-M/extend-deadline', 'sa', { deadline: day(20), reason: 'A startup cannot move deadlines' })).statusCode, 403);
    assert.strictEqual((await post('/challenges/CH-M/extend-deadline', 'ga', { deadline: day(20), reason: 'More startups asked for time' })).statusCode, 200);
    const add = J(await app.inject({ method: 'GET', url: '/api/v1/challenges/CH-M/addenda', headers: bearer(tok.sa) })).addenda;
    assert.ok(add.some((a: any) => a.title === 'Deadline extended'), 'bidders can read the notice');
  });

  it('addenda: officials post, bidders read, drafts stay private', async () => {
    assert.strictEqual((await post('/challenges/CH-M/addenda', 'sa', { title: 'My own addendum', body: 'A startup cannot post these.' })).statusCode, 403);
    assert.strictEqual((await post('/challenges/CH-M/addenda', 'gb', { title: 'Wrong department', body: 'Not this department challenge.' })).statusCode, 403);
    assert.strictEqual((await post('/challenges/CH-D/addenda', 'ga', { title: 'Too early', body: 'The challenge is still a draft.' })).statusCode, 409);
    assert.strictEqual((await post('/challenges/CH-M/addenda', 'ga', { title: 'Site visit', body: 'A site visit is arranged for all bidders on Friday.' })).statusCode, 201);
    assert.ok(J(await app.inject({ method: 'GET', url: '/api/v1/challenges/CH-M/addenda', headers: bearer(tok.sb) })).addenda.some((a: any) => a.title === 'Site visit'));
    assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/challenges/CH-D/addenda', headers: bearer(tok.sa) })).statusCode, 404, 'startups cannot see a draft');
  });
});
