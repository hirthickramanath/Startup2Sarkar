import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { getDatabase, DatabaseAdapter } from '../src/db';
import { hashPassword } from '../src/security';
import { LocalObjectStore, SupabaseObjectStore } from '../src/objectstore';

process.env.AUTH_RATE_MAX = '1000';
process.env.RATE_LIMIT_MAX = '5000';

const pdf = (extra = '') => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${extra}${'% padding to look like a real file\n'.repeat(8)}%%EOF`, 'latin1');

describe('Platform: documents, verification review, reconciliation, Q&A, drafts, trends', () => {
  let app: FastifyInstance; let db: DatabaseAdapter;
  const PW = 'Adm1n#Passw0rd!'; const tok: Record<string, string> = {};
  const J = (r: any) => JSON.parse(r.body); const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const call = (method: string, url: string, who: string, payload?: any) => app.inject({ method: method as any, url: `/api/v1${url}`, headers: bearer(tok[who]), ...(payload !== undefined ? { payload } : {}) });
  const iso = (n = 0) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const num = (v: any) => Number(BigInt(String(v)));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's2s-docs-'));

  before(async () => {
    db = getDatabase(); app = await buildApp({ db, objectStore: new LocalObjectStore(tmp) });
    const h = await hashPassword(PW);
    await db.query(`INSERT INTO departments (id, name, code, ministry, budget_allocated_paise) VALUES ('DEPT-PL','Platform Dept','PLT','Min',10000000000)`);
    for (const [o, n, vs, bank, gst, phone] of [['ORG-P1', 'Alpha Labs', 'PENDING', '•••• 7311', '27ZZZZZ9999Z1Z5', '9000000001'], ['ORG-P2', 'Beta Labs', 'VERIFIED', '•••• 7311', '27ZZZZZ9999Z1Z5', '9000000001'], ['ORG-P3', 'Gamma Labs', 'VERIFIED', '•••• 3333', null, '9000000003']] as const) {
      await db.query(`INSERT INTO organizations (id, name, founder_name, founder_email, founder_phone, sector, verification_status, bank_account_masked, ifsc_code, gstin) VALUES ($1,$2,'F',$3,$4,'IT',$5,$6,'HDFC0000140',$7)`, [o, n, `f@${o}.test`, phone, vs, bank, gst]);
    }
    for (const [id, email, role, org, dept] of [['PL-U1', 'p1@pl.test', 'startup', 'ORG-P1', null], ['PL-U2', 'p2@pl.test', 'startup', 'ORG-P2', null], ['PL-U3', 'p3@pl.test', 'startup', 'ORG-P3', null], ['PL-GOV', 'gov@pl.test', 'government', null, 'DEPT-PL'], ['PL-FIN', 'fin@pl.test', 'finance', null, 'DEPT-PL'], ['PL-ADM', 'adm@pl.test', 'admin', null, null]] as const) {
      await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation, organization_id, department_id) VALUES ($1,$2,$3,$4,$5,'x',$6,$7)`, [id, email, h, role, id, org, dept]);
    }
    for (const [k, email, role] of [['p1', 'p1@pl.test', 'startup'], ['p2', 'p2@pl.test', 'startup'], ['p3', 'p3@pl.test', 'startup'], ['gov', 'gov@pl.test', 'government'], ['fin', 'fin@pl.test', 'finance'], ['adm', 'adm@pl.test', 'admin']] as const) {
      const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PW, role } }); assert.strictEqual(r.statusCode, 200, r.body); tok[k] = J(r).token;
    }
    await db.query(`INSERT INTO challenges (id, title, department_id, department_name, problem_statement, problem_category, desired_outcome, deadline, status, created_by_user_id) VALUES ('CH-PL','Waste routing','DEPT-PL','Platform Dept','p','Waste','o', CURRENT_TIMESTAMP + INTERVAL '30 days','PUBLISHED','PL-GOV')`);
  });
  after(async () => { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  describe('Statutory documents', () => {
    const up = (who: string, docType: string, buf: Buffer, filename = 'cert.pdf') => call('POST', '/documents', who, { docType, filename, contentBase64: buf.toString('base64') });
    it('accepts a real PDF and stores it; refuses other files, scripts, tiny files and bad types', async () => {
      assert.strictEqual((await up('p1', 'DPIIT_CERTIFICATE', pdf())).statusCode, 201);
      const notPdf = await up('p1', 'DPIIT_CERTIFICATE', Buffer.from('MZ' + 'x'.repeat(300)));
      assert.strictEqual(notPdf.statusCode, 400); assert.strictEqual(J(notPdf).code, 'INVALID_DOCUMENT');
      assert.strictEqual((await up('p1', 'DPIIT_CERTIFICATE', Buffer.from('%PDF-1.4 ' + 'x'.repeat(200) + ' /JavaScript (app.alert(1))'))).statusCode, 400, 'active content');
      assert.strictEqual((await up('p1', 'DPIIT_CERTIFICATE', Buffer.from('%PDF-'))).statusCode, 400, 'too small');
      assert.strictEqual((await up('p1', 'PASSPORT', pdf())).statusCode, 400, 'unknown type');
      assert.strictEqual((await up('gov', 'DPIIT_CERTIFICATE', pdf())).statusCode, 403, 'only startups upload');
      const big = Buffer.concat([pdf(), Buffer.alloc(9 * 1024 * 1024, 65)]);
      assert.strictEqual((await up('p1', 'BANK_PROOF', big)).statusCode, 400, 'over 8 MB');
    });
    it('a new upload of the same type replaces the old one; the file is private to its startup and the administrator', async () => {
      assert.strictEqual((await up('p1', 'DPIIT_CERTIFICATE', pdf('% second version\n'))).statusCode, 201);
      const list = J(await call('GET', '/documents', 'p1')).documents.filter((d: any) => d.docType === 'DPIIT_CERTIFICATE');
      assert.strictEqual(list.length, 1, 'only the latest version is current');
      const id = list[0].id;
      const own = await call('GET', `/documents/${id}/download`, 'p1');
      assert.strictEqual(own.statusCode, 200); assert.match(own.headers['content-type'] as string, /application\/pdf/); assert.strictEqual(own.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual((await call('GET', `/documents/${id}/download`, 'p2')).statusCode, 404, 'another startup cannot read it');
      assert.strictEqual((await call('GET', `/documents/${id}/download`, 'gov')).statusCode, 403, 'government cannot read it');
      assert.strictEqual((await call('GET', `/documents/${id}/download`, 'adm')).statusCode, 200);
      assert.strictEqual(J(await call('GET', '/documents?organizationId=ORG-P1', 'adm')).documents.length, 1);
      assert.strictEqual(J(await call('GET', '/documents', 'p2')).documents.length, 0, 'tenant isolation');
    });
    it('the administrator accepts or rejects (with a reason), and tampered storage is detected', async () => {
      const id = J(await call('GET', '/documents', 'p1')).documents[0].id;
      assert.strictEqual((await call('PUT', `/documents/${id}/review`, 'adm', { status: 'REJECTED' })).statusCode, 400, 'a rejection needs a reason');
      assert.strictEqual((await call('PUT', `/documents/${id}/review`, 'p1', { status: 'ACCEPTED' })).statusCode, 403);
      assert.strictEqual((await call('PUT', `/documents/${id}/review`, 'adm', { status: 'ACCEPTED' })).statusCode, 200);
      assert.strictEqual(J(await call('GET', '/documents', 'p1')).documents[0].status, 'ACCEPTED');
      const row = (await db.query('SELECT storage_key FROM organization_documents WHERE id = $1', [id])).rows[0];
      fs.writeFileSync(path.join(tmp, row.storage_key), Buffer.from('%PDF-1.4 tampered ' + 'x'.repeat(200)));
      const bad = await call('GET', `/documents/${id}/download`, 'p1');
      assert.strictEqual(bad.statusCode, 500); assert.strictEqual(J(bad).code, 'INTEGRITY_FAILED');
    });
    it('the Supabase storage backend calls the right endpoints with the key in headers', async () => {
      const calls: any[] = [];
      const store = new SupabaseObjectStore('https://proj.supabase.co/', 'svc-key', 'docs', (async (url: any, init: any) => { calls.push({ url: String(url), init }); return new Response(init?.method === 'POST' ? '{}' : 'FILEDATA', { status: 200 }); }) as any);
      await store.put('ORG 1/BANK_PROOF/doc 1.pdf', Buffer.from('abc'), 'application/pdf');
      assert.strictEqual(calls[0].url, 'https://proj.supabase.co/storage/v1/object/docs/ORG_1/BANK_PROOF/doc_1.pdf');
      assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer svc-key'); assert.strictEqual(calls[0].init.headers['x-upsert'], 'true');
      assert.strictEqual((await store.get('ORG 1/BANK_PROOF/doc 1.pdf')).toString(), 'FILEDATA');
      assert.match(calls[1].url, /\/object\/authenticated\/docs\//);
      const failing = new SupabaseObjectStore('https://p.supabase.co', 'k', 'docs', (async () => new Response('no', { status: 500 })) as any);
      await assert.rejects(() => failing.put('a/b', Buffer.from('x'), 'application/pdf'), /Storage upload failed/);
    });
  });

  describe('Verification review: checklist and duplicate-detail flags', () => {
    it('flags startups that share a bank account, GSTIN or phone, and lists missing details', async () => {
      const r = J(await call('GET', '/admin/startups/ORG-P1/review', 'adm'));
      assert.deepStrictEqual(r.flags.map((f: any) => f.type).sort(), ['SHARED_BANK_ACCOUNT', 'SHARED_GSTIN', 'SHARED_PHONE']);
      assert.ok(r.flags.every((f: any) => /Beta Labs/.test(f.message)));
      assert.ok(r.missingDetails.includes('PAN') && r.missingDetails.includes('CIN / LLPIN'));
      assert.strictEqual(J(await call('GET', '/admin/startups/ORG-P3/review', 'adm')).flags.length, 0, 'an unrelated startup has no flags');
      assert.strictEqual((await call('GET', '/admin/startups/ORG-P1/review', 'fin')).statusCode, 403);
      assert.strictEqual((await call('GET', '/admin/startups/NOPE/review', 'adm')).statusCode, 404);
    });
    it('the checklist records who checked what, and when', async () => {
      assert.strictEqual((await call('PUT', '/admin/startups/ORG-P1/checklist', 'adm', { key: 'dpiit', done: true, note: 'Seen on the DPIIT portal' })).statusCode, 200);
      assert.strictEqual((await call('PUT', '/admin/startups/ORG-P1/checklist', 'adm', { key: 'passport', done: true })).statusCode, 400);
      const items = J(await call('GET', '/admin/startups/ORG-P1/review', 'adm')).checklist;
      assert.strictEqual(items.length, 6); assert.strictEqual(items.find((i: any) => i.key === 'dpiit').done, true); assert.strictEqual(items.find((i: any) => i.key === 'bank').done, false);
      assert.ok((await db.query(`SELECT 1 FROM audit_logs WHERE action = 'VERIFICATION_CHECK_UPDATED'`)).rows.length >= 1);
    });
  });

  describe('Bank statement reconciliation', () => {
    before(async () => {
      await db.query(`INSERT INTO pilots (id, name, challenge_id, proposal_id, organization_id, startup_name, department_id, location) VALUES ('PIL-RC','Rc Pilot','CH-PL','PRO-RC','ORG-P2','Beta Labs','DEPT-PL','Pune')`).catch(async () => {
        await db.query(`INSERT INTO proposals (id, challenge_id, organization_id, startup_name, solution_title, problem_solution_fit, technical_approach, deployment_plan, implementation_timeline) VALUES ('PRO-RC','CH-PL','ORG-P2','Beta Labs','s','f','t','d','3 months')`);
        await db.query(`INSERT INTO pilots (id, name, challenge_id, proposal_id, organization_id, startup_name, department_id, location) VALUES ('PIL-RC','Rc Pilot','CH-PL','PRO-RC','ORG-P2','Beta Labs','DEPT-PL','Pune')`);
      });
      const mk = async (id: string, status: string, extra: Record<string, any> = {}) => {
        await db.query(`INSERT INTO pilot_milestones (id, pilot_id, title, due_date, status) VALUES ($1,'PIL-RC',$2, CURRENT_TIMESTAMP,'VERIFIED')`, [`MS-${id}`, id]);
        await db.query(`INSERT INTO finance_payment_claims (id, pilot_id, milestone_id, organization_id, department_id, invoice_number, invoice_date, gross_amount_paise, tds_paise, gst_paise, net_payable_paise, status, requester_user_id, budget_dummy) VALUES ($1,'PIL-RC',$2,'ORG-P2','DEPT-PL',$3, CURRENT_TIMESTAMP, 5000000, 100000, 100000, 4800000, $4,'PL-U2', 0)`.replace(', budget_dummy', '').replace(', 0)', ')'), [id, `MS-${id}`, `INV-${id}`, status]);
        if (Object.keys(extra).length) await db.query(`UPDATE finance_payment_claims SET ${Object.keys(extra).map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...Object.values(extra)]);
      };
      await mk('CLM-CH1', 'CHEQUE_ISSUED', { payment_method: 'CHEQUE', cheque_number: '482910', cheque_date: iso(-3), drawee_bank: 'SBI' });
      await mk('CLM-CH2', 'CHEQUE_ISSUED', { payment_method: 'CHEQUE', cheque_number: '700001', cheque_date: iso(-3), drawee_bank: 'SBI' });
      await mk('CLM-EL1', 'PAID', { payment_method: 'ELECTRONIC', disbursement_reference: 'UTR9988776655', disbursed_at: new Date().toISOString() });
      await db.query(`UPDATE departments SET budget_committed_paise = 9600000 WHERE id = 'DEPT-PL'`);
    });
    const rec = (rows: any[]) => call('POST', '/finance/reconcile', 'fin', { rows });
    it('matches cheques and transfers to statement lines, and reports mismatches and unmatched lines without changing anything', async () => {
      const r = J(await rec([
        { date: iso(-1), description: 'CHQ NO 000482910 CLEARING', reference: '', debitPaise: 4800000 },
        { date: iso(-1), description: 'CHEQUE 700001', reference: '', debitPaise: 4700000 },
        { date: iso(-1), description: 'NEFT UTR9988776655 BETA LABS', reference: '', debitPaise: 4800000 },
        { date: iso(-1), description: 'ATM WITHDRAWAL', reference: '', debitPaise: 100000 },
        { date: iso(-1), description: 'Interest credit', reference: '', debitPaise: 0 },
      ]));
      assert.deepStrictEqual(r.matches.map((m: any) => [m.claimId, m.kind]).sort(), [['CLM-CH1', 'CHEQUE_CLEARED'], ['CLM-EL1', 'TRANSFER_CONFIRMED']]);
      assert.deepStrictEqual(r.mismatches.map((m: any) => [m.claimId, m.reason]), [['CLM-CH2', 'AMOUNT_DIFFERS']]);
      assert.deepStrictEqual(r.unmatched, [3]);
      assert.strictEqual((await db.query(`SELECT status FROM finance_payment_claims WHERE id = 'CLM-CH1'`)).rows[0].status, 'CHEQUE_ISSUED', 'dry run only');
      assert.strictEqual((await call('POST', '/finance/reconcile', 'p2', { rows: [{ date: iso(), description: 'x', debitPaise: 1 }] })).statusCode, 403);
      assert.strictEqual((await call('POST', '/finance/reconcile', 'fin', { rows: [] })).statusCode, 400);
    });
    it('applying a matched cheque clears it (budget moves from reserved to spent); a transfer is marked bank-confirmed; wrong items are refused', async () => {
      const res = J(await call('POST', '/finance/reconcile/apply', 'fin', { items: [
        { claimId: 'CLM-CH1', kind: 'CHEQUE_CLEARED', date: iso(-1) }, { claimId: 'CLM-EL1', kind: 'TRANSFER_CONFIRMED', date: iso(-1) },
        { claimId: 'CLM-CH2', kind: 'CHEQUE_CLEARED', date: iso(-9) }, { claimId: 'CLM-NOPE', kind: 'CHEQUE_CLEARED', date: iso(-1) }, { claimId: 'CLM-CH2', kind: 'CHEQUE_CLEARED', date: iso(2) }] }));
      assert.deepStrictEqual(res.results.map((x: any) => x.ok), [true, true, false, false, false]);
      assert.strictEqual(res.applied, 2);
      const c = (await db.query(`SELECT status, disbursement_reference FROM finance_payment_claims WHERE id = 'CLM-CH1'`)).rows[0];
      assert.deepStrictEqual([c.status, c.disbursement_reference], ['PAID', 'CHQ-482910']);
      assert.ok((await db.query(`SELECT bank_confirmed_at FROM finance_payment_claims WHERE id = 'CLM-EL1'`)).rows[0].bank_confirmed_at);
      assert.strictEqual(num((await db.query(`SELECT budget_disbursed_paise FROM departments WHERE id = 'DEPT-PL'`)).rows[0].budget_disbursed_paise), 5000000);
      assert.strictEqual(J(await call('POST', '/finance/reconcile/apply', 'fin', { items: [{ claimId: 'CLM-CH1', kind: 'CHEQUE_CLEARED', date: iso(-1) }] })).applied, 0, 'cannot clear twice');
    });
    it('monthly trends cover six months for finance and for administrators', async () => {
      const f = J(await call('GET', '/finance/trends', 'fin')).months; assert.strictEqual(f.length, 6);
      assert.ok(f.some((m: any) => m.claims >= 3), 'this month has the three claims');
      const a = J(await call('GET', '/admin/trends', 'adm')).months; assert.strictEqual(a.length, 6); assert.ok(a[5].users >= 6);
      assert.strictEqual((await call('GET', '/admin/trends', 'fin')).statusCode, 403);
    });
  });

  describe('Challenge Q&A and templates', () => {
    it('bidders ask; officials answer; answered questions are public, unanswered ones stay private to the asker', async () => {
      assert.strictEqual((await call('POST', '/challenges/CH-PL/questions', 'p2', { question: 'short' })).statusCode, 400);
      assert.strictEqual((await call('POST', '/challenges/CH-PL/questions', 'gov', { question: 'Officials cannot ask these.' })).statusCode, 403);
      const q1 = J(await call('POST', '/challenges/CH-PL/questions', 'p2', { question: 'Is a field trial in two cities acceptable?' })).id;
      assert.ok(q1); await call('POST', '/challenges/CH-PL/questions', 'p3', { question: 'Which sensor standards are expected?' });
      const own = J(await call('GET', '/challenges/CH-PL/questions', 'p2')).questions;
      assert.deepStrictEqual(own.map((q: any) => q.mine), [true], 'p2 sees only its own unanswered question');
      assert.strictEqual(J(await call('GET', '/challenges/CH-PL/questions', 'gov')).questions.length, 2);
      assert.strictEqual((await call('POST', `/challenges/CH-PL/questions/${q1}/answer`, 'p2', { answer: 'I answer myself' })).statusCode, 403);
      assert.strictEqual((await call('POST', `/challenges/CH-PL/questions/${q1}/answer`, 'gov', { answer: 'Yes, two cities are fine.' })).statusCode, 200);
      assert.strictEqual((await call('POST', `/challenges/CH-PL/questions/${q1}/answer`, 'gov', { answer: 'Answering again later' })).statusCode, 409);
      const p3 = J(await call('GET', '/challenges/CH-PL/questions', 'p3')).questions;
      assert.ok(p3.some((q: any) => q.answer === 'Yes, two cities are fine.' && q.mine === false), 'an answered question is visible to every bidder');
      assert.ok(!p3.some((q: any) => !q.answer && !q.mine));
      assert.strictEqual(J(await call('GET', '/challenges/CH-PL/questions', 'p1')).questions.length, 1, 'p1 sees the one public answer only');
    });
    it('a challenge can be copied as a new draft by its own department', async () => {
      const r = await call('POST', '/challenges/CH-PL/duplicate', 'gov');
      assert.strictEqual(r.statusCode, 201, r.body);
      const copy = (await db.query('SELECT title, status, department_id FROM challenges WHERE id = $1', [J(r).id])).rows[0];
      assert.deepStrictEqual([copy.title, copy.status, copy.department_id], ['Waste routing (copy)', 'DRAFT', 'DEPT-PL']);
      assert.strictEqual((await call('POST', '/challenges/CH-PL/duplicate', 'p2')).statusCode, 403);
    });
  });

  describe('Proposal drafts', () => {
    let draftId = '';
    const body = { challengeId: 'CH-PL', solutionTitle: 'Route optimiser', problemSolutionFit: 'x'.repeat(40), technicalApproach: 'y'.repeat(40), deploymentPlan: 'Pilot in two wards', implementationTimeline: '4 months', pilotCostPaise: 200000, scaleupCostPaise: 900000 };
    it('a startup can save a partial draft, even before verification, and edit it', async () => {
      const r = await call('POST', '/proposals/drafts', 'p1', { challengeId: 'CH-PL', solutionTitle: 'Half done' });
      assert.strictEqual(r.statusCode, 201, r.body); draftId = J(r).id;
      assert.strictEqual((await call('PUT', `/proposals/${draftId}/draft`, 'p1', body)).statusCode, 200);
      assert.strictEqual((await call('PUT', `/proposals/${draftId}/draft`, 'p2', body)).statusCode, 404, 'not another startup\'s draft');
      assert.strictEqual((await call('POST', '/proposals/drafts', 'p1', { challengeId: 'CH-NOPE' })).statusCode, 404);
      assert.strictEqual((await call('POST', '/proposals/drafts', 'gov', { challengeId: 'CH-PL' })).statusCode, 403);
    });
    it('drafts are private: officials never see them', async () => {
      assert.ok(J(await call('GET', '/proposals', 'p1')).data.some((p: any) => p.id === draftId));
      assert.ok(!J(await call('GET', '/proposals', 'gov')).data.some((p: any) => p.id === draftId));
      assert.ok(!J(await call('GET', '/proposals', 'adm')).data.some((p: any) => p.id === draftId));
    });
    it('an incomplete draft cannot be submitted; an unverified startup is told its draft is safe; a verified one submits', async () => {
      const half = J(await call('POST', '/proposals/drafts', 'p2', { challengeId: 'CH-PL', solutionTitle: 'Tiny' })).id;
      const incomplete = await call('POST', `/proposals/${half}/submit`, 'p2');
      assert.strictEqual(incomplete.statusCode, 400); assert.match(incomplete.body, /not complete/);
      const blocked = await call('POST', `/proposals/${draftId}/submit`, 'p1');
      assert.strictEqual(blocked.statusCode, 403); assert.strictEqual(J(blocked).code, 'ORG_NOT_VERIFIED');
      assert.strictEqual((await db.query('SELECT status FROM proposals WHERE id = $1', [draftId])).rows[0].status, 'DRAFT', 'the draft is kept');
      await call('PUT', `/proposals/${half}/draft`, 'p2', body);
      const ok = await call('POST', `/proposals/${half}/submit`, 'p2');
      assert.strictEqual(ok.statusCode, 200, ok.body);
      assert.strictEqual((await db.query('SELECT status FROM proposals WHERE id = $1', [half])).rows[0].status, 'SUBMITTED');
      assert.ok(J(await call('GET', '/proposals', 'gov')).data.some((p: any) => p.id === half), 'now officials can see it');
      assert.strictEqual((await call('PUT', `/proposals/${half}/draft`, 'p2', body)).statusCode, 409, 'a submitted proposal is no longer a draft');
    });
    it('a draft can be deleted, but a submitted proposal cannot', async () => {
      assert.strictEqual((await call('DELETE', `/proposals/${draftId}/draft`, 'p2')).statusCode, 404);
      assert.strictEqual((await call('DELETE', `/proposals/${draftId}/draft`, 'p1')).statusCode, 200);
      assert.strictEqual((await db.query('SELECT 1 FROM proposals WHERE id = $1', [draftId])).rows.length, 0);
      const submitted = (await db.query(`SELECT id FROM proposals WHERE organization_id = 'ORG-P2' AND status = 'SUBMITTED'`)).rows[0].id;
      assert.strictEqual((await call('DELETE', `/proposals/${submitted}/draft`, 'p2')).statusCode, 409);
    });
  });
});
