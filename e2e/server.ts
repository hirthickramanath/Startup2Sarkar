/**
 * Test server for the browser suite: the real app on an in-memory database, a PRETEND GitHub, a capturing mail
 * provider, and a few test-only routes. It refuses to start in production, and none of this is part of the product.
 */
if (process.env.NODE_ENV === 'production') throw new Error('The e2e test server must never run in production.');
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '1000'; process.env.RATE_LIMIT_MAX = '5000';
process.env.GITHUB_CLIENT_ID = 'cid'; process.env.GITHUB_CLIENT_SECRET = 'secret';
process.env.BREVO_API_KEY = 'test-only'; process.env.EMAIL_FROM = 'noreply@example.test';
const PORT = Number(process.env.E2E_PORT || 4010);
process.env.PUBLIC_URL = `http://localhost:${PORT}`;

const { buildApp } = await import('../server/src/app');
const { getDatabase } = await import('../server/src/db');
const { hashPassword, signBlob, signToken, encryptField } = await import('../server/src/security');
const { DevelopmentEmailProvider } = await import('../server/src/adapters');
const { generateSync } = await import('otplib');

const mail = new DevelopmentEmailProvider();
const people: Record<string, any> = { startup: { id: 501, login: 'priya-n', name: 'Priya Nair', email: 'priya@startup.example' } };
const githubFetch = (async (url: any, init: any) => {
  const u = String(url);
  const who = (h: any) => people[String(h?.Authorization || '').replace('Bearer tok:', '')];
  if (u === 'https://github.com/login/oauth/access_token') return new Response(JSON.stringify({ access_token: 'tok:' + JSON.parse(init.body).code }), { status: 200 });
  const p = who(init?.headers);
  if (u === 'https://api.github.com/user') return new Response(JSON.stringify({ id: p.id, login: p.login, name: p.name, avatar_url: 'https://a.example/x.png', html_url: 'https://github.com/' + p.login }), { status: 200 });
  if (u === 'https://api.github.com/user/emails') return new Response(JSON.stringify([{ email: p.email, primary: true, verified: true }]), { status: 200 });
  return new Response('{}', { status: 404 });
}) as typeof fetch;

const db = getDatabase();
const app = await buildApp({ db, githubFetch, emailProvider: mail });
const pw = await hashPassword('Adm1n#Passw0rd!');
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

await db.query(`INSERT INTO departments (id, name, code, ministry, budget_allocated_paise) VALUES ('DEPT-UI','Department of Health & Family Welfare','HFW','Min',100000000000)`);
await db.query(`INSERT INTO organizations (id, name, founder_name, founder_email, sector, verification_status, bank_account_encrypted, bank_account_masked, ifsc_code) VALUES ('ORG-UI','Greenfield Labs','Rohan','rohan@ui.test','CleanTech','VERIFIED',$1,'•••• 9012','HDFC0000140')`, [encryptField('123456789012')]);
for (const [id, email, role, name, org, dept] of [['USR-ADM', 'admin@ui.test', 'admin', 'Admin User', null, null], ['USR-ST', 'rohan@ui.test', 'startup', 'Rohan Sengupta', 'ORG-UI', null], ['USR-FIN', 'fin@ui.test', 'finance', 'Sunita Rao', null, 'DEPT-UI'], ['USR-GOV', 'gov@ui.test', 'government', 'Dr. Mehta', null, 'DEPT-UI']] as const) {
  await db.query(`INSERT INTO users (id, email, password_hash, role, name, designation, organization_id, department_id) VALUES ($1,$2,$3,$4,$5,'x',$6,$7)`, [id, email, pw, role, name, org, dept]);
}
await db.query(`INSERT INTO challenges (id, title, department_id, department_name, problem_statement, problem_category, desired_outcome, deadline, status, created_by_user_id) VALUES ('CH-UI','Smart waste routing','DEPT-UI','Dept','p','c','o', CURRENT_TIMESTAMP + INTERVAL '20 days','PUBLISHED','USR-GOV')`);
for (const [id, st] of [['PRO-UI', 'SELECTED'], ['PRO-UI2', 'NOT_SHORTLISTED'], ['PRO-UI3', 'SELECTED']] as const) {
  await db.query(`INSERT INTO proposals (id, challenge_id, organization_id, startup_name, solution_title, problem_solution_fit, technical_approach, deployment_plan, implementation_timeline, status) VALUES ($1,'CH-UI','ORG-UI','Greenfield Labs',$2,'f','t','d','3 months',$3)`, [id, id === 'PRO-UI2' ? 'Drone based routing' : 'Sensor routing', st]);
}
await db.query(`INSERT INTO pilots (id, name, challenge_id, proposal_id, organization_id, startup_name, department_id, location, duration_months, status) VALUES ('PIL-UI','Greenfield pilot','CH-UI','PRO-UI','ORG-UI','Greenfield Labs','DEPT-UI','Pune',4,'IN_PROGRESS')`);
await db.query(`INSERT INTO pilots (id, name, challenge_id, proposal_id, organization_id, startup_name, department_id, location, duration_months, status) VALUES ('PIL-UI3','Validated pilot','CH-UI','PRO-UI3','ORG-UI','Greenfield Labs','DEPT-UI','Nagpur',4,'VALIDATED')`);
const claim = async (id: string, status: string, extra = '', params: any[] = []) => {
  await db.query(`INSERT INTO pilot_milestones (id, pilot_id, title, due_date, status) VALUES ($1,'PIL-UI',$2, CURRENT_TIMESTAMP, 'VERIFIED')`, [`MS-${id}`, `Milestone ${id}`]);
  await db.query(`INSERT INTO finance_payment_claims (id, pilot_id, milestone_id, organization_id, department_id, invoice_number, invoice_date, gross_amount_paise, tds_paise, gst_paise, net_payable_paise, status, requester_user_id${extra ? ', ' + extra.split('=')[0] : ''}) VALUES ($1,'PIL-UI',$2,'ORG-UI','DEPT-UI',$3, CURRENT_TIMESTAMP, 60000000, 1200000, 1200000, 57600000, $4,'USR-ST'${extra ? ', $5' : ''})`, [id, `MS-${id}`, `INV-${id}`, status, ...params]);
};
await claim('CLM-UI', 'SUBMITTED');
await db.query(`INSERT INTO pilot_milestones (id, pilot_id, title, due_date, status) VALUES ('MS-UI2','PIL-UI','Interim validation', CURRENT_TIMESTAMP, 'VERIFIED')`);
await db.query(`INSERT INTO finance_payment_claims (id, pilot_id, milestone_id, organization_id, department_id, invoice_number, invoice_date, gross_amount_paise, tds_paise, gst_paise, net_payable_paise, status, requester_user_id, payment_method, cheque_number, cheque_date, drawee_bank) VALUES ('CLM-UI2','PIL-UI','MS-UI2','ORG-UI','DEPT-UI','INV-UI-2', CURRENT_TIMESTAMP, 60000000, 1200000, 1200000, 57600000, 'CHEQUE_ISSUED','USR-ST','CHEQUE','910011',$1,'State Bank of India')`, [daysAgo(2)]);
await db.query(`INSERT INTO pilot_milestones (id, pilot_id, title, due_date, status) VALUES ('MS-UI3','PIL-UI','Final report', CURRENT_TIMESTAMP, 'VERIFIED')`);
await db.query(`INSERT INTO finance_payment_claims (id, pilot_id, milestone_id, organization_id, department_id, invoice_number, invoice_date, gross_amount_paise, tds_paise, gst_paise, net_payable_paise, status, requester_user_id, approver_user_id) VALUES ('CLM-UI3','PIL-UI','MS-UI3','ORG-UI','DEPT-UI','INV-UI-3', CURRENT_TIMESTAMP, 30000000, 0, 0, 30000000, 'APPROVED','USR-ST','USR-ADM')`);

// ── test-only routes ──
app.get('/__test/google-signup', async (req, reply) => {
  const q = req.query as any;
  reply.setCookie('s2s_signup', signBlob({ p: 'google', s: 'g-' + q.email, e: q.email, n: q.name, a: null, u: null, l: null }, 1800), { path: '/', httpOnly: true, sameSite: 'lax' });
  return reply.redirect('/signup');
});
app.get('/__test/session', async (req, reply) => {
  const u = (await db.query('SELECT * FROM users WHERE email = $1', [(req.query as any).email])).rows[0];
  const sid = 'SESS-T-' + Date.now() + Math.floor(Math.random() * 1000);
  await db.query('INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5)', [sid, u.id, '127.0.0.1', 't', new Date(Date.now() + 3600000)]);
  reply.setCookie('s2s_session', signToken({ userId: u.id, email: u.email, role: u.role, name: u.name, departmentId: u.department_id, organizationId: u.organization_id, sessionId: sid }), { path: '/', httpOnly: true, sameSite: 'strict' });
  return reply.redirect('/');
});
app.get('/__test/mfa', async (req) => { process.env.REQUIRE_STAFF_MFA = String((req.query as any).on); return { on: process.env.REQUIRE_STAFF_MFA }; });
app.get('/__test/totp', async (req) => { const u = (await db.query('SELECT mfa_secret FROM users WHERE email = $1', [(req.query as any).email])).rows[0]; return { code: generateSync({ secret: u.mfa_secret }) }; });
app.get('/__test/last-email', async (req) => { const to = String((req.query as any).to); const m = [...mail.getSentEmails()].reverse().find((e) => e.to === to); return { text: m?.text || '' }; });

await app.listen({ port: PORT, host: '127.0.0.1' });
console.log('E2E-SERVER READY');
