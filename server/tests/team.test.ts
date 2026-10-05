import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { generateSync } from 'otplib';
import { buildApp } from '../src/app';
import { getDatabase, DatabaseAdapter } from '../src/db';
import { hashPassword } from '../src/security';
import { DevelopmentEmailProvider } from '../src/adapters';

process.env.AUTH_RATE_MAX = '1000';
process.env.RATE_LIMIT_MAX = '5000';

describe('Teams, messaging and the skip-for-now option', () => {
  let app: FastifyInstance; let db: DatabaseAdapter;
  const PW = 'Adm1n#Passw0rd!'; const tok: Record<string, string> = {};
  const mail = new DevelopmentEmailProvider();
  const J = (r: any) => JSON.parse(r.body); const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const call = (method: string, url: string, who: string, payload?: any) => app.inject({ method: method as any, url: `/api/v1${url}`, headers: bearer(tok[who]), ...(payload !== undefined ? { payload } : {}) });
  const tokenOf = (link: string) => /token=([0-9a-f]{64})/.exec(link)![1];

  before(async () => {
    db = getDatabase(); app = await buildApp({ db, emailProvider: mail });
    const h = await hashPassword(PW);
    for (const d of ['TM1', 'TM2']) await db.query(`INSERT INTO departments (id, name, code, ministry, budget_allocated_paise) VALUES ($1,$2,$3,'Min',10000000000)`, [`DEPT-${d}`, `Dept ${d}`, d]);
    for (const o of ['TM1', 'TM2']) await db.query(`INSERT INTO organizations (id, name, founder_name, founder_email, sector, verification_status) VALUES ($1,$2,'F',$3,'IT','VERIFIED')`, [`ORG-${o}`, `Org ${o}`, `f@${o}.test`]);
    for (const [id, email, role, org, dept] of [['TM-O1', 'owner1@tm.test', 'startup', 'ORG-TM1', null], ['TM-O2', 'owner2@tm.test', 'startup', 'ORG-TM2', null], ['TM-G1', 'g1@tm.test', 'government', null, 'DEPT-TM1'], ['TM-G1B', 'g1b@tm.test', 'government', null, 'DEPT-TM1'], ['TM-G2', 'g2@tm.test', 'government', null, 'DEPT-TM2'], ['TM-F1', 'f1@tm.test', 'finance', null, 'DEPT-TM1'], ['TM-ST', 'staff@tm.test', 'finance', null, 'DEPT-TM1']] as const) {
      await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation, organization_id, department_id) VALUES ($1,$2,$3,$4,$5,'x',$6,$7)`, [id, email, h, role, id, org, dept]);
    }
    await db.query(`INSERT INTO challenges (id, title, department_id, department_name, problem_statement, problem_category, desired_outcome, deadline, status, created_by_user_id) VALUES ('CH-TM','C','DEPT-TM1','Dept TM1','p','c','o', CURRENT_TIMESTAMP + INTERVAL '30 days','PUBLISHED','TM-G1')`);
    await db.query(`INSERT INTO proposals (id, challenge_id, organization_id, startup_name, solution_title, problem_solution_fit, technical_approach, deployment_plan, implementation_timeline, status) VALUES ('PRO-TM','CH-TM','ORG-TM1','S','s','f','t','d','3 months','SELECTED')`);
    await db.query(`INSERT INTO pilots (id, name, challenge_id, proposal_id, organization_id, startup_name, department_id, location) VALUES ('PIL-TM','Team pilot','CH-TM','PRO-TM','ORG-TM1','Org TM1','DEPT-TM1','Pune')`);
    const login = async (k: string, email: string, role: string, password = PW) => { const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password, role } }); assert.strictEqual(r.statusCode, 200, r.body); tok[k] = J(r).token; };
    for (const [k, email, role] of [['o1', 'owner1@tm.test', 'startup'], ['o2', 'owner2@tm.test', 'startup'], ['g1', 'g1@tm.test', 'government'], ['g1b', 'g1b@tm.test', 'government'], ['g2', 'g2@tm.test', 'government'], ['f1', 'f1@tm.test', 'finance'], ['st', 'staff@tm.test', 'finance']] as const) await login(k, email, role);
  });
  after(async () => { await app.close(); });

  describe('Several users per startup', () => {
    let link = ''; let memberId = '';
    it('only the owner invites; duplicates, existing accounts and bad addresses are refused; the owner gets a link even if email fails', async () => {
      assert.strictEqual((await call('POST', '/team/invites', 'o1', { email: 'not-an-email' })).statusCode, 400);
      assert.strictEqual((await call('POST', '/team/invites', 'g1', { email: 'x@tm.test' })).statusCode, 403, 'government has no team');
      assert.strictEqual((await call('POST', '/team/invites', 'o1', { email: 'owner2@tm.test' })).statusCode, 409, 'that address already has an account');
      const ok = await call('POST', '/team/invites', 'o1', { email: 'Mate@TM.test' });
      assert.strictEqual(ok.statusCode, 201, ok.body); link = J(ok).inviteLink; assert.ok(link.includes('/join?token='));
      assert.ok(mail.getSentEmails().some((e) => e.to === 'mate@tm.test' && e.text.includes(tokenOf(link))), 'emailed to the lower-cased address');
      assert.strictEqual((await call('POST', '/team/invites', 'o1', { email: 'mate@tm.test' })).statusCode, 409, 'one pending invitation per address');
      assert.strictEqual(J(await call('GET', '/team', 'o1')).invites.length, 1);
    });
    it('the invitation page shows who invited you; a wrong token reveals nothing', async () => {
      const info = J(await app.inject({ method: 'GET', url: `/api/v1/auth/join-info?token=${tokenOf(link)}` }));
      assert.deepStrictEqual([info.email, info.organizationName], ['mate@tm.test', 'Org TM1']);
      const bad = await app.inject({ method: 'GET', url: `/api/v1/auth/join-info?token=${'f'.repeat(64)}` });
      assert.strictEqual(bad.statusCode, 404); assert.strictEqual(J(bad).code, 'INVITE_INVALID');
    });
    it('joining needs a strong password, creates a MEMBER of the same startup, signs them in, and works only once', async () => {
      const join = (payload: any) => app.inject({ method: 'POST', url: '/api/v1/auth/join', payload });
      assert.strictEqual(J(await join({ token: tokenOf(link), name: 'Mate One', password: 'password' })).code, 'WEAK_PASSWORD');
      assert.strictEqual((await join({ token: 'f'.repeat(64), name: 'Mate One', password: 'Str0ng#Passw0rd!' })).statusCode, 404);
      const ok = await join({ token: tokenOf(link), name: 'Mate One', password: 'Str0ng#Passw0rd!' });
      assert.strictEqual(ok.statusCode, 201, ok.body);
      const body = J(ok); tok.m1 = body.token; memberId = body.user.id;
      assert.strictEqual(body.user.organizationId, 'ORG-TM1'); assert.strictEqual(body.user.orgRole, 'MEMBER'); assert.strictEqual(body.user.role, 'startup');
      assert.strictEqual((await join({ token: tokenOf(link), name: 'Again', password: 'Str0ng#Passw0rd!' })).statusCode, 404, 'one use only');
      const me = J(await call('GET', '/auth/me', 'm1')).user; assert.strictEqual(me.org_role, 'MEMBER');
      assert.strictEqual(J(await call('GET', '/auth/me', 'o1')).user.org_role, 'OWNER');
    });
    it('a teammate shares the startup\'s work but not its sensitive settings', async () => {
      assert.strictEqual(J(await call('GET', '/proposals', 'm1')).data.length, 1, 'sees the startup\'s proposals');
      assert.strictEqual((await call('GET', '/pilots', 'm1')).statusCode, 200);
      const owner = ['/team/invites'];
      assert.strictEqual((await call('POST', owner[0], 'm1', { email: 'third@tm.test' })).statusCode, 403, 'cannot invite');
      assert.strictEqual(J(await call('POST', owner[0], 'm1', { email: 'third@tm.test' })).code, 'OWNER_ONLY');
      assert.strictEqual(J(await call('PUT', '/auth/organization', 'm1', { sector: 'Hacked' })).code, 'OWNER_ONLY', 'cannot change registration or bank details');
      assert.strictEqual((await call('PUT', '/network/showcase', 'm1', { optIn: false })).statusCode, 403, 'cannot change investor visibility');
      assert.strictEqual((await call('POST', '/network/incoming/X/respond', 'm1', { accept: true })).statusCode, 403, 'cannot answer investor introductions');
      const pdf = Buffer.from('%PDF-1.4\n' + '% padding\n'.repeat(20) + '%%EOF').toString('base64');
      assert.strictEqual(J(await call('POST', '/documents', 'm1', { docType: 'BANK_PROOF', filename: 'x', contentBase64: pdf })).code, 'OWNER_ONLY', 'cannot upload verification documents');
      assert.strictEqual((await call('POST', '/documents', 'o1', { docType: 'BANK_PROOF', filename: 'x', contentBase64: pdf })).statusCode, 201, 'the owner can');
      assert.strictEqual(J(await call('GET', '/team', 'm1')).canManage, false);
    });
    it('teams are isolated: another startup sees none of this, and cannot remove or revoke across startups', async () => {
      assert.strictEqual(J(await call('GET', '/team', 'o2')).members.length, 1);
      assert.strictEqual(J(await call('GET', '/proposals', 'o2')).data.length, 0);
      assert.strictEqual((await call('DELETE', `/team/members/${memberId}`, 'o2')).statusCode, 404);
      const inv = J(await call('POST', '/team/invites', 'o1', { email: 'revoke.me@tm.test' }));
      assert.strictEqual((await call('DELETE', `/team/invites/${inv.id}`, 'o2')).statusCode, 404);
      assert.strictEqual((await call('DELETE', `/team/invites/${inv.id}`, 'm1')).statusCode, 403);
      assert.strictEqual((await call('DELETE', `/team/invites/${inv.id}`, 'o1')).statusCode, 200);
      assert.strictEqual((await app.inject({ method: 'GET', url: `/api/v1/auth/join-info?token=${tokenOf(inv.inviteLink)}` })).statusCode, 404, 'a revoked link stops working');
    });
    it('an expired invitation stops working; the team is capped', async () => {
      const inv = J(await call('POST', '/team/invites', 'o2', { email: 'late@tm.test' }));
      await db.query(`UPDATE team_invites SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = $1`, [inv.id]);
      assert.strictEqual((await app.inject({ method: 'GET', url: `/api/v1/auth/join-info?token=${tokenOf(inv.inviteLink)}` })).statusCode, 404);
      assert.strictEqual((await call('POST', '/team/invites', 'o2', { email: 'late@tm.test' })).statusCode, 201, 'an expired one can be re-sent');
      for (let i = 0; i < 8; i++) assert.strictEqual((await call('POST', '/team/invites', 'o2', { email: `cap${i}@tm.test` })).statusCode, 201);
      const full = await call('POST', '/team/invites', 'o2', { email: 'overflow@tm.test' });
      assert.strictEqual(full.statusCode, 409); assert.strictEqual(J(full).code, 'TEAM_FULL');
    });
    it('removing a teammate signs them out immediately and blocks their login; the owner cannot be removed', async () => {
      assert.strictEqual((await call('GET', '/auth/me', 'm1')).statusCode, 200);
      assert.strictEqual(J(await call('DELETE', '/team/members/TM-O1', 'o1')).code, 'CANNOT_REMOVE_OWNER');
      assert.strictEqual((await call('DELETE', `/team/members/${memberId}`, 'm1')).statusCode, 403);
      assert.strictEqual((await call('DELETE', `/team/members/${memberId}`, 'o1')).statusCode, 200);
      assert.strictEqual((await call('GET', '/auth/me', 'm1')).statusCode, 401, 'their session ended at once');
      assert.strictEqual((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'mate@tm.test', password: 'Str0ng#Passw0rd!', role: 'startup' } })).statusCode, 401);
      assert.strictEqual(J(await call('GET', '/team', 'o1')).members.length, 1);
    });
  });

  describe('In-app messaging (pilots only)', () => {
    let threadId = '';
    it('either side of a pilot can start a conversation; strangers cannot', async () => {
      const mk = (who: string, over: any = {}) => call('POST', '/messages/threads', who, { pilotId: 'PIL-TM', subject: 'Site access', body: 'When can we install the sensors?', ...over });
      assert.strictEqual((await mk('o1', { body: '' })).statusCode, 400);
      assert.strictEqual((await mk('o2')).statusCode, 404, 'another startup');
      assert.strictEqual((await mk('g2')).statusCode, 404, 'another department');
      assert.strictEqual((await mk('f1')).statusCode, 403, 'finance does not use messaging');
      assert.strictEqual((await call('POST', '/messages/threads', 'o1', { pilotId: 'PRO-TM', subject: 'Bid chat', body: 'Private word about my bid?' })).statusCode, 404, 'proposals have no private channel: use the public Q&A');
      const ok = await mk('o1'); assert.strictEqual(ok.statusCode, 201); threadId = J(ok).id;
      assert.ok((await db.query(`SELECT 1 FROM notifications WHERE title = 'New message' AND user_id IN ('TM-G1','TM-G1B')`)).rows.length >= 2, 'the whole department is notified');
      assert.ok(!(await db.query(`SELECT details FROM audit_logs WHERE action = 'MESSAGE_THREAD_STARTED'`)).rows.some((r: any) => JSON.stringify(r).includes('install the sensors')), 'the audit trail never holds message text');
    });
    it('unread counts are per person; opening a conversation marks it read; replies notify the other side', async () => {
      assert.strictEqual(J(await call('GET', '/messages/unread', 'g1')).unread, 1);
      assert.strictEqual(J(await call('GET', '/messages/unread', 'o1')).unread, 0, 'your own message is not unread for you');
      const open = J(await call('GET', `/messages/threads/${threadId}`, 'g1'));
      assert.deepStrictEqual([open.messages.length, open.messages[0].side, open.messages[0].mine], [1, 'STARTUP', false]);
      assert.strictEqual(J(await call('GET', '/messages/unread', 'g1')).unread, 0);
      assert.strictEqual(J(await call('GET', '/messages/unread', 'g1b')).unread, 1, 'a colleague still has it unread');
      assert.strictEqual((await call('POST', `/messages/threads/${threadId}/messages`, 'g1', { body: 'Friday works. Please bring site passes.' })).statusCode, 201);
      assert.strictEqual(J(await call('GET', '/messages/unread', 'o1')).unread, 1);
      const list = J(await call('GET', '/messages/threads', 'o1')).threads;
      assert.deepStrictEqual([list.length, list[0].unread, list[0].lastMessage], [1, 1, 'Friday works. Please bring site passes.']);
    });
    it('conversations are private to the two sides: no leakage to other startups, other departments or other roles', async () => {
      for (const who of ['o2', 'g2']) {
        assert.strictEqual((await call('GET', `/messages/threads/${threadId}`, who)).statusCode, 404, who);
        assert.strictEqual((await call('POST', `/messages/threads/${threadId}/messages`, who, { body: 'Intruding' })).statusCode, 404, who);
        assert.strictEqual(J(await call('GET', '/messages/threads', who)).threads.length, 0, who);
      }
      assert.strictEqual((await call('GET', '/messages/threads', 'f1')).statusCode, 403);
    });
    it('long, empty or script-bearing messages are handled; closed conversations stop; only the owner closes for the startup', async () => {
      assert.strictEqual((await call('POST', `/messages/threads/${threadId}/messages`, 'o1', { body: 'x'.repeat(2001) })).statusCode, 400);
      assert.strictEqual((await call('POST', `/messages/threads/${threadId}/messages`, 'o1', { body: '   ' })).statusCode, 400);
      assert.strictEqual((await call('POST', `/messages/threads/${threadId}/messages`, 'o1', { body: '<img src=x onerror=alert(1)>' })).statusCode, 201);
      const stored = J(await call('GET', `/messages/threads/${threadId}`, 'g1')).messages.pop();
      assert.strictEqual(stored.body, '<img src=x onerror=alert(1)>', 'stored as plain text; the screen shows it as text');
      assert.strictEqual((await call('POST', `/messages/threads/${threadId}/close`, 'g2')).statusCode, 404);
      assert.strictEqual((await call('POST', `/messages/threads/${threadId}/close`, 'g1')).statusCode, 200);
      const closed = await call('POST', `/messages/threads/${threadId}/messages`, 'o1', { body: 'Hello?' });
      assert.strictEqual(closed.statusCode, 409); assert.strictEqual(J(closed).code, 'THREAD_CLOSED');
      assert.strictEqual((await call('POST', `/messages/threads/${threadId}/reopen`, 'g1')).statusCode, 200);
      assert.strictEqual((await call('POST', `/messages/threads/${threadId}/messages`, 'o1', { body: 'Back again.' })).statusCode, 201);
    });
  });

  describe('Skip for now on forced two-step verification', () => {
    const withMfa = async (fn: () => Promise<void>) => { process.env.REQUIRE_STAFF_MFA = 'true'; try { await fn(); } finally { delete process.env.REQUIRE_STAFF_MFA; } };
    it('staff can skip, which opens access for 24 hours and keeps nagging; the skip is audited and limited', async () => withMfa(async () => {
      assert.strictEqual(J(await call('GET', '/finance/budget', 'st')).code, 'MFA_ENROLMENT_REQUIRED');
      const me0 = J(await call('GET', '/auth/me', 'st')).user; assert.deepStrictEqual([me0.mfa_enrol_required, me0.mfa_skips_left], [true, 5]);
      const skip = J(await call('POST', '/auth/mfa/skip', 'st')); assert.deepStrictEqual([skip.success, skip.skipsLeft], [true, 4]);
      assert.strictEqual((await call('GET', '/finance/budget', 'st')).statusCode, 200, 'access is open during the skip');
      const me1 = J(await call('GET', '/auth/me', 'st')).user; assert.deepStrictEqual([me1.mfa_enrol_required, me1.mfa_enabled, me1.mfa_skips_left], [false, false, 4]);
      assert.ok((await db.query(`SELECT 1 FROM audit_logs WHERE action = 'AUTH_MFA_ENROLMENT_SKIPPED'`)).rows.length >= 1);
      await db.query(`UPDATE users SET mfa_snoozed_until = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = 'TM-ST'`);
      assert.strictEqual(J(await call('GET', '/finance/budget', 'st')).code, 'MFA_ENROLMENT_REQUIRED', 'the screen comes back when the skip runs out');
      for (let i = 0; i < 4; i++) { assert.strictEqual((await call('POST', '/auth/mfa/skip', 'st')).statusCode, 200); await db.query(`UPDATE users SET mfa_snoozed_until = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = 'TM-ST'`); }
      const last = await call('POST', '/auth/mfa/skip', 'st');
      assert.strictEqual(last.statusCode, 403); assert.strictEqual(J(last).code, 'MFA_SKIP_LIMIT');
      assert.strictEqual(J(await call('GET', '/finance/budget', 'st')).code, 'MFA_ENROLMENT_REQUIRED', 'no skips left: enrolment is truly required');
      const setup = J(await call('POST', '/auth/mfa/setup', 'st'));
      assert.strictEqual((await call('POST', '/auth/mfa/enable', 'st', { code: generateSync({ secret: setup.secret }) })).statusCode, 200, 'and enrolling still works');
      assert.strictEqual((await call('GET', '/finance/budget', 'st')).statusCode, 200);
      assert.strictEqual((await call('POST', '/auth/mfa/skip', 'st')).statusCode, 409, 'nothing to skip once enrolled');
    }));
    it('people who are not forced cannot use it', async () => withMfa(async () => {
      assert.strictEqual((await call('POST', '/auth/mfa/skip', 'o1')).statusCode, 409, 'startups are never forced');
    }));
  });
});
