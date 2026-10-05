import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { generateSync } from 'otplib';
import { buildApp } from '../src/app';
import { getDatabase, DatabaseAdapter } from '../src/db';
import { hashPassword } from '../src/security';
import { BrevoEmailProvider, emailHints, EmailProvider } from '../src/adapters';

process.env.AUTH_RATE_MAX = '1000';
process.env.RATE_LIMIT_MAX = '5000';

/** A provider that can be told to fail the way Brevo does when it blocks an unknown server IP. */
class Flaky implements EmailProvider {
  readonly kind = 'brevo' as const; fail = false; sent: any[] = [];
  async sendEmail(m: any) { if (this.fail) throw new Error('Brevo rejected the message (HTTP 401: We have detected you are using an unrecognised IP address.)'); this.sent.push(m); return { success: true, messageId: `<${this.sent.length}@test>` }; }
}

describe('Optional startup details, email diagnostics and security notices', () => {
  let app: FastifyInstance; let db: DatabaseAdapter;
  const PW = 'Adm1n#Passw0rd!'; const tok: Record<string, string> = {}; const mail = new Flaky();
  const J = (r: any) => JSON.parse(r.body); const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const call = (method: string, url: string, who: string, payload?: any) => app.inject({ method: method as any, url: `/api/v1${url}`, headers: bearer(tok[who]), ...(payload !== undefined ? { payload } : {}) });
  const reg = (over: any = {}) => app.inject({ method: 'POST', url: '/api/v1/auth/register-startup', payload: { startupName: 'Min Labs', founderName: 'Mina Rao', email: 'mina@min.test', password: 'Str0ng#Passw0rd!', phone: '9876500000', sector: 'AgriTech', ...over } });

  before(async () => {
    db = getDatabase(); app = await buildApp({ db, emailProvider: mail });
    const h = await hashPassword(PW);
    await db.query(`INSERT INTO departments (id, name, code, ministry, budget_allocated_paise) VALUES ('DEPT-EM','Email Dept','EM','Min',100)`);
    for (const [id, email, role, dept] of [['EM-AD', 'ad@em.test', 'admin', null], ['EM-FIN', 'fin@em.test', 'finance', 'DEPT-EM']] as const) await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation, department_id) VALUES ($1,$2,$3,$4,$5,'x',$6)`, [id, email, h, role, id, dept]);
    for (const [k, email, role] of [['ad', 'ad@em.test', 'admin'], ['fin', 'fin@em.test', 'finance']] as const) { const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PW, role } }); assert.strictEqual(r.statusCode, 200, r.body); tok[k] = J(r).token; }
  });
  after(async () => { await app.close(); });

  describe('Startup registration details are optional', () => {
    it('a startup can register with only its basics; details are stored as "not provided", and it can sign in', async () => {
      const r = await reg(); assert.strictEqual(r.statusCode, 201, r.body);
      const org = (await db.query(`SELECT dpiit_number, cin_llpin, pan, gstin, bank_account_encrypted, ifsc_code, verification_status FROM organizations WHERE name = 'Min Labs'`)).rows[0];
      assert.deepStrictEqual([org.dpiit_number, org.cin_llpin, org.pan, org.gstin, org.bank_account_encrypted, org.ifsc_code, org.verification_status], [null, null, null, null, null, null, 'PENDING']);
      assert.strictEqual((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'mina@min.test', password: 'Str0ng#Passw0rd!', role: 'startup' } })).statusCode, 200);
    });
    it('blank strings count as not provided; what IS given is still checked', async () => {
      assert.strictEqual((await reg({ email: 'b1@min.test', startupName: 'Blank Labs', dpiitNumber: '', cinLlpin: '  ', pan: '', gstin: '', bankAccountNumber: '', ifscCode: '' })).statusCode, 201, 'blank means not provided');
      assert.match(J(await reg({ email: 'b2@min.test', pan: 'BADPAN1234' })).error, /PAN/);
      assert.match(J(await reg({ email: 'b3@min.test', gstin: '12ABCDE1234F1Z5' })).error, /GSTIN/);
      assert.match(J(await reg({ email: 'b4@min.test', dpiitNumber: 'nonsense value' })).error, /DPIIT/);
      assert.match(J(await reg({ email: 'b5@min.test', bankAccountNumber: '123456789012' })).error, /both the bank account number and the IFSC/, 'an account number needs its IFSC');
      assert.match(J(await reg({ email: 'b6@min.test', ifscCode: 'HDFC0000140' })).error, /both the bank account number and the IFSC/);
    });
    it('a startup that adds details later can be reviewed with the gaps listed, and cannot be paid by bank file until bank details exist', async () => {
      const id = (await db.query(`SELECT id FROM organizations WHERE name = 'Min Labs'`)).rows[0].id;
      const rev = J(await call('GET', `/admin/startups/${id}/review`, 'ad'));
      assert.deepStrictEqual(rev.missingDetails.sort(), ['Bank account', 'CIN / LLPIN', 'DPIIT number', 'GSTIN', 'IFSC', 'PAN']);
      assert.strictEqual((await call('PUT', `/admin/startups/${id}/verify`, 'ad', { status: 'VERIFIED', verificationNotes: 'Verified on the basics for now' })).statusCode, 200, 'an administrator may verify without them');
    });
    it('onboarding after email or Google sign-up also treats the DPIIT number as optional', async () => {
      await app.inject({ method: 'POST', url: '/api/v1/auth/signup-email', payload: { email: 'ob@min.test', name: 'Ob Founder', password: 'Str0ng#Passw0rd!' } });
      const token = /token=([0-9a-f]{64})/.exec(mail.sent.find((m) => m.to === 'ob@min.test').text)![1];
      const cookie = (await app.inject({ method: 'GET', url: '/api/v1/auth/verify-email?token=' + token })).cookies.find((c: any) => c.name === 's2s_signup')!.value;
      const r = await app.inject({ method: 'POST', url: '/api/v1/auth/onboarding', cookies: { s2s_signup: cookie }, payload: { role: 'startup', name: 'Ob Founder', phone: '9876511111', acceptTerms: true, startupName: 'Ob Labs', sector: 'EdTech' } });
      assert.strictEqual(r.statusCode, 201, r.body);
      assert.strictEqual((await db.query(`SELECT dpiit_number FROM organizations WHERE name = 'Ob Labs'`)).rows[0].dpiit_number, null);
    });
  });

  describe('Email: nothing fails silently any more', () => {
    it('when the provider rejects a send (for example Brevo blocking the server IP), the person still gets the generic answer, but the failure is recorded with the real reason', async () => {
      mail.fail = true;
      const r = await app.inject({ method: 'POST', url: '/api/v1/auth/signup-email', payload: { email: 'lost@min.test', name: 'Lost Mail', password: 'Str0ng#Passw0rd!' } });
      assert.strictEqual(r.statusCode, 200, 'the answer does not reveal whether an address is registered');
      const row = (await db.query(`SELECT status, error, to_email FROM email_log WHERE to_email = 'lost@min.test'`)).rows[0];
      assert.deepStrictEqual([row.status, /unrecognised IP address/.test(row.error)], ['FAILED', true]);
      mail.fail = false;
    });
    it('administrators see the status, the failures and plain advice; nobody else does', async () => {
      const st = J(await call('GET', '/admin/email/status', 'ad'));
      assert.deepStrictEqual([st.provider, st.delivers], ['brevo', true]);
      assert.ok(st.last24h.failed >= 1);
      assert.ok(st.recent.some((e: any) => e.status === 'FAILED' && /unrecognised IP/.test(e.error)));
      assert.ok(st.lastFailureHints.some((h: string) => /Authorised IPs/.test(h)), 'tells the admin exactly where to fix it in Brevo');
      assert.strictEqual((await call('GET', '/admin/email/status', 'fin')).statusCode, 403);
      assert.strictEqual((await call('POST', '/admin/email/test', 'fin', {})).statusCode, 403);
    });
    it('the test button reports success or the exact failure', async () => {
      const ok = J(await call('POST', '/admin/email/test', 'ad', {})); assert.deepStrictEqual([ok.ok, ok.to], [true, 'ad@em.test']);
      assert.ok(mail.sent.some((m) => m.to === 'ad@em.test' && /test email/i.test(m.subject)));
      mail.fail = true;
      const bad = J(await call('POST', '/admin/email/test', 'ad', { to: 'someone@example.com' }));
      assert.strictEqual(bad.ok, false); assert.match(bad.error, /unrecognised IP/); assert.ok(bad.hints.length >= 1);
      mail.fail = false;
      assert.strictEqual((await call('POST', '/admin/email/test', 'ad', { to: 'not-an-email' })).statusCode, 400);
    });
    it('the log keeps who and what, never the message body (which can contain one-time links)', async () => {
      await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: 'ad@em.test' } });
      const all = JSON.stringify((await db.query('SELECT * FROM email_log')).rows);
      assert.ok(all.includes('ad@em.test')); assert.ok(!/reset-password\?token|verify-email\?token|[0-9a-f]{64}/.test(all), 'no tokens in the log');
    });
    it('provider rejections are explained: Brevo\'s own message is kept, and each common cause gets advice', async () => {
      const brevo = new BrevoEmailProvider('k', { email: 'a@b.c', name: 'S' }, (async () => new Response(JSON.stringify({ code: 'unauthorized', message: 'We have detected you are using an unrecognised IP address' }), { status: 401 })) as any);
      await assert.rejects(() => brevo.sendEmail({ to: 'x@y.z', subject: 's', text: 't', html: 't' }), /HTTP 401: We have detected you are using an unrecognised IP address/);
      assert.ok(emailHints('Brevo rejected the message (HTTP 400: Sender not valid)').some((h) => /EMAIL_FROM/.test(h)));
      assert.ok(emailHints('Brevo rejected the message (HTTP 401: Key not found)').some((h) => /API key/.test(h)));
      assert.ok(emailHints('weird').length === 1);
    });
  });

  describe('Security notices by email', () => {
    it('turning on two-step verification, changing a password and resetting one each send a notice', async () => {
      const before = mail.sent.length;
      const setup = J(await call('POST', '/auth/mfa/setup', 'fin'));
      assert.strictEqual((await call('POST', '/auth/mfa/enable', 'fin', { code: generateSync({ secret: setup.secret }) })).statusCode, 200);
      assert.ok(mail.sent.slice(before).some((m) => m.to === 'fin@em.test' && m.subject === 'Two-step verification is now on'), '2FA notice');
      assert.strictEqual((await call('POST', '/auth/change-password', 'ad', { currentPassword: PW, newPassword: 'N3w#StrongPass!42' })).statusCode, 200);
      assert.ok(mail.sent.some((m) => m.to === 'ad@em.test' && m.subject === 'Your password was changed'), 'change notice');
      await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: 'fin@em.test' } });
      const t = /token=([0-9a-f]{64})/.exec(mail.sent.filter((m) => m.to === 'fin@em.test' && /Reset/.test(m.subject)).pop()!.text)![1];
      assert.strictEqual((await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token: t, password: 'An0ther#StrongPass!1' } })).statusCode, 200);
      assert.ok(mail.sent.filter((m) => m.to === 'fin@em.test' && m.subject === 'Your password was changed').length >= 1, 'reset notice');
    });
  });
});
