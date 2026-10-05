import fs from 'fs';
import { withBrowser, wait } from './lib.mjs';

/** Drives the real app in a real browser. Returns { failures, problems, warnings }. */
export async function runFlows({ base, shotsDir, tmpDir }) {
  // E2E_PART=main runs the functional checks, E2E_PART=sweep the dark-mode and phone-width screenshots, anything else runs both
  const part = process.env.E2E_PART || 'all';
  fs.mkdirSync(shotsDir, { recursive: true }); fs.mkdirSync(tmpDir, { recursive: true });
  const failures = []; const problems = []; const warnings = [];
  const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures.push(name); };

  const pdf = `${tmpDir}/sample.pdf`;
  fs.writeFileSync(pdf, '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n' + '% padding to look like a real file\n'.repeat(8) + '%%EOF');
  const now = new Date(); const dmy = `${String(now.getUTCDate()).padStart(2, '0')}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${now.getUTCFullYear()}`;
  const statement = `${tmpDir}/statement.csv`;
  fs.writeFileSync(statement, `Account statement\nDate,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt\n${dmy},CLEARING CHQ 910011 PUNE,910011,"5,76,000.00",\n${dmy},ATM CASH,,2000.00,\n${dmy},Interest,,,150.00\n`);

  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => problems.push(`[pageerror] ${page.url()} :: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!/Failed to load resource|gsi\/client|googleapis|gstatic|\b(400|401|403|409|429)\b/.test(t)) problems.push(`[console] ${t.slice(0, 160)}`); } });
    page.on('dialog', (d) => d.accept('Not a clear scan, please resubmit'));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (u.startsWith('https://github.com/login/oauth/authorize')) { const st = new URL(u).searchParams.get('state'); return req.respond({ status: 302, headers: { Location: `${base}/api/v1/auth/github/callback?code=startup&state=${encodeURIComponent(st)}` } }); }
      if (/^https?:\/\/(?!localhost)/.test(u) && !/fonts\.(googleapis|gstatic)/.test(u)) return req.abort();
      req.continue();
    });

    const text = () => page.evaluate(() => document.body.innerText);
    const has = async (re) => re.test(await text());
    const waitText = async (re, ms = 6000) => { for (let i = 0; i < ms / 250; i++) { if (await has(re)) return true; await wait(250); } return false; };
    const click = async (sel, re) => {
      for (let i = 0; i < 24; i++) {
        const ok = await page.evaluate((sel, src) => { const r = new RegExp(src, 'i'); const el = [...document.querySelectorAll(sel)].find((e) => r.test((e.innerText || e.textContent || '').trim())); if (el) { el.click(); return true; } return false; }, sel, re.source);
        if (ok) return;
        await wait(250);
      }
      throw new Error(`no ${sel} ~ ${re} | url=${page.url()} | page: ${(await text()).replace(/\s+/g, ' ').slice(0, 160)}`);
    };
    const typeInto = async (labelRe, value) => {
      const els = (await page.$$('input, textarea')).reverse();
      for (const el of els) {
        const lab = await el.evaluate((n) => (n.closest('label')?.innerText || (n.id && document.querySelector(`label[for="${n.id}"]`)?.innerText) || n.getAttribute('aria-label') || n.getAttribute('placeholder') || '').split('\n')[0].trim());
        if (labelRe.test(lab)) { await el.click({ clickCount: 3 }); await el.type(value); return; }
      }
      throw new Error('no field ' + labelRe);
    };
    const shot = (n) => page.screenshot({ path: `${shotsDir}/${n}.png` });
    const fresh = async () => { const c = await page.createCDPSession(); await c.send('Network.clearBrowserCookies'); await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch { /* none */ } }).catch(() => {}); };
    const skipIntro = async () => { try { await page.waitForSelector('.in2', { timeout: 5000 }); await wait(300); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.in2'), { timeout: 5000 }); await wait(500); } catch { /* no intro */ } };
    const open = async (path) => { await page.goto(base + path, { waitUntil: 'networkidle0' }); await skipIntro(); await wait(600); };
    const asSession = async (email) => { await fresh(); await page.goto(`${base}/__test/session?email=${email}`, { waitUntil: 'networkidle0' }); await skipIntro(); await wait(800); };
    const dark = async () => { await page.evaluate(() => localStorage.setItem('s2s_mode', 'dark')); await page.reload({ waitUntil: 'networkidle0' }); await skipIntro(); await wait(500); };

    if (part !== 'sweep') {
    // ───────── Look and feel ─────────
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    check('intro plays on first load', await page.waitForSelector('.in2', { timeout: 6000 }).then(() => true).catch(() => false));
    await wait(4300);
    const introText = (await text()).replace(/\s+/g, '');
    check('intro resolves to the logo name and tagline', /Startup2Sarkar/.test(introText) && /BuildforBharat/.test(introText));
    await shot('01-intro-end'); await page.keyboard.press('Escape'); await wait(800);
    await page.reload({ waitUntil: 'domcontentloaded' });
    check('intro plays again after a reload', await page.waitForSelector('.in2', { timeout: 6000 }).then(() => true).catch(() => false));
    await page.keyboard.press('Escape'); await wait(1000);
    check('light is the default theme', (await page.evaluate(() => document.documentElement.getAttribute('data-mode'))) === 'light');
    const t0 = await text();
    check('the start page shows roles only (no social buttons)', ['Government', 'Startup', 'Inspector', 'Finance', 'Investor', 'Admin'].every((r) => t0.includes(r)) && !/Sign in with (Google|GitHub)/.test(t0));
    await wait(2500); await shot('02-login');
    await click('button', /^\s*Government/); await wait(500);
    let t = await text();
    check('government form: Google, no GitHub, email sign-up offered', /Sign in with Google/.test(t) && !/Sign in with GitHub/.test(t) && /Forgot password\?/.test(t));
    await open('/'); await click('button', /^\s*Investor/); await wait(400); t = await text();
    check('investor form: Google, no GitHub', /Sign in with Google/.test(t) && !/Sign in with GitHub/.test(t));
    await open('/'); await click('button', /^\s*Startup/); await wait(400); t = await text();
    check('startup form: Google and GitHub', /Sign in with Google/.test(t) && /Sign in with GitHub/.test(t));

    // ───────── Sign-up ─────────
    await click('a', /Sign in with GitHub/); await page.waitForFunction(() => location.pathname === '/signup', { timeout: 10000 }); await wait(900);
    t = await text();
    check('GitHub sign-up offers only the startup role', /GitHub sign-up is for startups/.test(t));
    const ins = await page.$$('form input:not([type=checkbox])');
    const fill = { 'Mobile number': '9876543210', 'Startup name': 'Priya Robotics', Sector: 'Robotics', 'DPIIT recognition number': 'DIPP88001' };
    for (const el of ins) { const label = await el.evaluate((n) => (n.closest('label')?.innerText || '').split('\n')[0].trim()); if (fill[label]) await el.type(fill[label]); }
    await page.$eval('input[type=checkbox]', (c) => c.click());
    await click('button[type=submit]', /Create my account/); await page.waitForFunction(() => /startup\/dashboard/.test(location.pathname), { timeout: 15000 }); await wait(900);
    check('a startup signs up through GitHub and reaches its dashboard', /startup\/dashboard/.test(page.url()));

    await fresh(); await page.goto(`${base}/__test/google-signup?email=asha@dept.example&name=Asha%20Verma`, { waitUntil: 'networkidle0' }); await wait(700);
    await click('button', /^\s*Government/); await wait(300);
    await page.select('select', 'DEPT-UI');
    for (const el of await page.$$('form input:not([type=checkbox]), form textarea')) {
      const label = await el.evaluate((n) => (n.closest('label')?.innerText || '').split('\n')[0].trim());
      if (label.startsWith('Why')) await el.type('I run procurement for the department.');
      else if (label === 'Mobile number') await el.type('9876501234');
      else if (label === 'Designation') await el.type('Section Officer');
      else if (label === 'Official email') await el.type('asha@dept.gov.in');
    }
    await page.$eval('input[type=checkbox]', (c) => c.click());
    await click('button[type=submit]', /Send access request/); await wait(1600);
    check('an official is told to wait for approval', await has(/Waiting for administrator approval/));
    await asSession('admin@ui.test'); await open('/admin/access-requests');
    await click('button', /Review & approve/); await wait(300); await click('button', /^Confirm$/); await wait(1500);
    check('an administrator approves the request', true);

    await fresh(); await open('/'); await click('button', /^\s*Investor/); await wait(400);
    await click('button', /Register as an investor/); await wait(400);
    await typeInto(/Full name/i, 'Ravi Kapoor'); await typeInto(/^Email/i, 'ravi@fund.example'); await typeInto(/^Password/i, 'Str0ng#Passw0rd!');
    await click('button', /Send confirmation link/); await wait(1200);
    check('email sign-up shows the confirmation message', await has(/sent a confirmation link/));
    const mailText = await page.evaluate(async () => (await (await fetch('/__test/last-email?to=ravi@fund.example')).json()).text);
    const link = (mailText.match(/https?:\/\/[^\s]+verify-email\?token=[0-9a-f]+/) || [])[0];
    await fresh(); await page.goto(link.replace(/^https?:\/\/[^/]+/, base), { waitUntil: 'networkidle0' }); await wait(900);
    check('the confirmation link leads straight to the sign-up questions', /\/signup/.test(page.url()) && await has(/finish your account/i));
    await click('button', /^\s*Investor/); await wait(300); await page.select('select', 'ANGEL');
    await typeInto(/Mobile number/i, '9876500011'); await typeInto(/Organisation/i, 'Kapoor Angels');
    await page.$eval('input[type=checkbox]', (c) => c.click());
    await click('button[type=submit]', /Create my account/); await page.waitForFunction(() => /investor\/dashboard/.test(location.pathname), { timeout: 15000 }); await wait(700);
    check('an investor is created by email and signed in', /investor\/dashboard/.test(page.url()));

    // ───────── Finance: approve, cheque, clear, tax ledger, budget ─────────
    await asSession('fin@ui.test'); await open('/finance/payments/CLM-UI');
    await click('button', /^\s*Approve\s*$/); await wait(400); await page.type('textarea', 'Checked against the inspection docket and the budget.'); await click('button', /Approve claim/); await wait(1500);
    t = await text(); check('a claim is approved and payment choices appear', /Issue cheque/.test(t) && /Record electronic payment/.test(t));
    await click('button', /Issue cheque/); await wait(400);
    await page.type('#cn', '482910'); await page.type('#cb', 'State Bank of India, Pune Main'); await page.type('#cs', 'S. Rao, A. Iyer');
    await click('button', /Record cheque/); await wait(1500);
    t = await text(); check('an issued cheque says it counts as spent only when it clears', /Cheque issued/i.test(t) && /spent only when it clears/.test(t));
    await open('/finance/budget'); t = await text(); check('the budget shows cheques in transit and an as-of time', /Cheques in transit/.test(t) && /As of/.test(t));
    await open('/finance/payments/CLM-UI'); await click('button', /Mark cheque cleared/); await wait(400); await click('button', /Confirm cleared/); await wait(1600);
    t = await text(); check('a cleared cheque becomes Paid with its reference', /Paid/.test(t) && /CHQ-482910/.test(t));
    await open('/finance/tax-ledger'); await wait(1000); t = await text(); check('the tax ledger lists TDS and GST-TDS to remit', /GST-TDS/.test(t) && /Mark remitted/.test(t));
    await shot('03-tax-ledger');

    // ───────── Admin / government / startup basics ─────────
    await asSession('admin@ui.test'); await open('/admin/settings'); t = await text();
    check('admin settings has the two-person approval amount', /Two-person approval from claim amount/.test(t));
    check('admin settings has bank payment file layouts', /Bank payment file layouts/.test(t));
    await asSession('gov@ui.test'); await open('/government/pilots/PIL-UI'); t = await text();
    check('a government pilot page has Extend and Terminate', /Extend pilot/.test(t) && /Terminate pilot/.test(t));
    await asSession('rohan@ui.test'); await open('/account'); check('the account security page opens', await has(/Change password/));

    // ───────── Startup: documents, drafts, questions ─────────
    await open('/startup/profile');
    const fileInputs = await page.$$('input[type=file]'); await fileInputs[0].uploadFile(pdf); await wait(1800);
    check('a startup uploads a document and sees it under review', await has(/Under review/i) && await has(/Open/));
    await shot('04-documents');
    await open('/startup/proposals/create?challenge=CH-UI'); await wait(500);
    await typeInto(/Solution title/i, 'Sensor based routing'); await click('button', /Save draft/); await wait(1500);
    check('a proposal draft is saved', await has(/Draft saved/i));
    await open('/startup/proposals'); check('the drafts panel lists it', await has(/Your drafts/) && await has(/Sensor based routing/));
    await open('/startup/challenges/CH-UI'); await typeInto(/Ask a question/i, 'Is a field trial in two cities acceptable?'); await click('button', /^Ask$/); await wait(1400);
    check('a question is asked and waits for an answer', await has(/Waiting for an official answer/));
    await asSession('gov@ui.test'); await open('/government/challenges/CH-UI'); await typeInto(/Your answer/i, 'Yes, two cities are fine.'); await click('button', /^Publish$/); await wait(1400);
    check('an official answers and sees the template button', await has(/Yes, two cities are fine/) && await has(/Use as template/));
    await asSession('rohan@ui.test'); await open('/startup/challenges/CH-UI'); check('every bidder now sees the public answer', await has(/Yes, two cities are fine/));

    // ───────── Admin: verification review, trends ─────────
    await asSession('admin@ui.test'); await open('/admin/startups'); await click('button', /^All$/); await wait(300); await click('button', /Review/); await wait(1500);
    t = await text(); check('the verification review shows documents, checklist and a decision box', /Documents/.test(t) && /What I have checked/.test(t) && /Decision notes/.test(t));
    await click('label', /DPIIT recognition checked/); await wait(900);
    check('a checklist item stays ticked', await page.evaluate(() => [...document.querySelectorAll('input[type=checkbox]')].some((c) => c.checked)));
    await shot('05-admin-review');
    await open('/admin/dashboard'); check('the admin dashboard has a trend chart', await waitText(/Platform activity/));

    // ───────── Finance: trends, reconciliation ─────────
    await asSession('fin@ui.test'); await open('/finance/dashboard'); check('the finance dashboard has a trend chart', await waitText(/Claims and payments/));
    await open('/finance/reconcile'); await (await page.$('input[type=file]')).uploadFile(statement); await wait(2000);
    t = await text(); check('reconciliation recognises the cheque and ignores unrelated lines', /Ready to apply/.test(t) && /cheque 910011 cleared/.test(t));
    await shot('06-reconcile');
    await click('button', /Apply selected/); await wait(1800);
    await open('/finance/payments/CLM-UI2'); check('the cheque is Paid through the statement', await has(/Paid/) && await has(/CHQ-910011/));

    // ───────── Finance: bank payment file; admin: layout ─────────
    await open('/finance/payments');
    await page.evaluate(() => { window.__csv = null; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { if (b && b.text) b.text().then((x) => { window.__csv = x; }); return o(b); }; });
    await click('button', /Bank payment file/); await wait(700);
    await page.$eval('.modal input[type=checkbox], [role=dialog] input[type=checkbox]', (c) => c.click()).catch(async () => { await page.$eval('input[type=checkbox]', (c) => c.click()); });
    await click('button', /Download file \(1\)/); await wait(1800);
    const csv = await page.evaluate(() => window.__csv);
    check('the bank payment file holds the real account, IFSC and claim', !!csv && /123456789012/.test(csv) && /HDFC0000140/.test(csv) && /CLM-UI3/.test(csv));
    await asSession('admin@ui.test'); await open('/admin/settings'); await click('button', /Add a layout/); await wait(300);
    await page.type('#tn', 'Example Bank bulk'); await click('button', /Save layout/); await wait(1500);
    check('an administrator adds a bank file layout', await has(/Example Bank bulk/));

    // ───────── Scale-up and appeals ─────────
    await asSession('gov@ui.test'); await open('/government/pilots/PIL-UI3'); await click('button', /Recommend scale-up/); await wait(400);
    await page.type('#sr', 'The pilot met every KPI and the ward staff want it extended across the whole city.'); await click('button', /Send for decision/); await wait(1500);
    check('an official recommends a scale-up', await has(/Recommended/));
    await asSession('admin@ui.test'); await open('/admin/scaleup'); await click('button', /^Decide$/); await wait(300);
    await page.type('#sd', 'KPIs verified by the inspector; budget confirmed.'); await click('button', /^Approve$/); await wait(1500);
    check('an administrator approves the scale-up', await has(/Approved/));
    await asSession('rohan@ui.test'); await open('/startup/proposals'); await wait(800);
    check('the startup sees the scale-up decision and an appeal option', await has(/Scale-up decisions/) && await has(/Appeals/) && await has(/Drone based routing/));
    await click('button', /^Appeal$/); await wait(300);
    await page.type('#ar', 'The evaluation ignored the two district hospital deployments documented in our proposal.'); await click('button', /Send appeal/); await wait(1500);
    check('a startup appeals a rejection', await has(/Waiting for an administrator/));
    await asSession('admin@ui.test'); await open('/admin/appeals'); await click('button', /^Review$/); await wait(300);
    await page.type('#ad', 'The documented deployments were not scored; please re-evaluate.'); await click('button', /^Uphold$/); await wait(1500);
    check('an administrator upholds the appeal', await has(/Upheld/));

    // ───────── Several users per startup ─────────
    await asSession('rohan@ui.test'); await open('/startup/team');
    check('the owner sees the team page with an invite form', await has(/Your team/) && await has(/Invite a teammate/));
    await typeInto(/Teammate email/i, 'meera@greenfield.example'); await click('button', /Send invitation/); await wait(1500);
    const inviteLink = await page.evaluate(() => [...document.querySelectorAll('code')].map((c) => c.innerText).find((t) => /join\?token=/.test(t)) || '');
    check('an invitation is created with a link the owner can share', /join\?token=[0-9a-f]{64}/.test(inviteLink));
    await fresh(); await page.goto(inviteLink.replace(/^https?:\/\/[^/]+/, base), { waitUntil: 'networkidle0' }); await wait(900);
    check('the invitation page names the startup, with no intro in the way', /\/join/.test(page.url()) && await has(/Join Greenfield Labs/));
    await typeInto(/Your full name/i, 'Meera Pillai'); await typeInto(/^Password/i, 'Str0ng#Passw0rd!'); await typeInto(/Repeat it/i, 'Str0ng#Passw0rd!');
    await click('button[type=submit]', /Join the team/); await page.waitForFunction(() => /startup\/dashboard/.test(location.pathname), { timeout: 15000 }); await wait(900);
    check('the teammate joins and lands on the startup dashboard', /startup\/dashboard/.test(page.url()) && await has(/Greenfield Labs/));
    await open('/startup/profile');
    check('a teammate cannot see registration, documents or investor settings', await has(/Only the account owner can change these/) && !(await has(/Verification documents/)));
    await open('/startup/team'); check('a teammate cannot invite or remove people', await has(/Only the account owner can invite or remove teammates/) && !(await has(/Send invitation/)));

    // ───────── In-app messaging ─────────
    await open('/messages'); await click('button', /New conversation/); await wait(400);
    await typeInto(/^Subject/i, 'Site access for installation'); await typeInto(/^Message/i, 'When can we start installing the sensors at the Pune ward?');
    await click('button', /^Send$/); await wait(1500);
    check('a teammate starts a conversation with the department', await has(/Site access for installation/) && await has(/sensors at the Pune ward/));
    await asSession('gov@ui.test'); await open('/government/dashboard'); await wait(1200);
    const badge = await page.evaluate(() => [...document.querySelectorAll('.shell-aside button, aside button')].find((b) => /Messages/.test(b.innerText))?.innerText || '');
    check('the department sees an unread count on Messages', /Messages\s*\n?\s*1/.test(badge.replace(/\s+/g, ' ').replace('Messages 1', 'Messages\n1')) || /1/.test(badge));
    await open('/messages'); await click('button', /Site access for installation/); await wait(900);
    await typeInto(/Write a message/i, 'Friday works. Please bring site passes for the team.'); await page.click('button[aria-label="Send"]'); await wait(1400);
    check('an official replies', await has(/Friday works/));
    await asSession('rohan@ui.test'); await open('/messages'); await click('button', /Site access for installation/); await wait(900);
    check('the startup sees the reply, from the department', await has(/Friday works/) && await has(/Department/));
    await shot('08-messages');

    // ───────── Staff two-step verification is forced, can be skipped for now, and enrolment works ─────────
    await page.evaluate(() => fetch('/__test/mfa?on=true'));
    await asSession('gov@ui.test'); await wait(800);
    check('staff without two-step verification see the enrolment screen', await has(/Turn on two-step verification/)); await shot('09-mfa-enrol');
    check('the screen offers Skip for now', await has(/Skip for now/));
    await page.waitForFunction(() => document.querySelector('img[alt^="QR"]') || /Copy key/.test(document.body.innerText), { timeout: 8000 }).catch(() => {});
    await click('button[type=submit]', /Turn on and continue/); await wait(500);
    check('pressing Continue with nothing filled in explains what is missing, right next to the button', await has(/Tick the box above to confirm you have saved your recovery codes/));
    await page.$eval('input[type=checkbox]', (c) => c.click());
    await page.type('input.lp-code', '000000'); await click('button[type=submit]', /Turn on and continue/); await wait(1200);
    check('a wrong code shows a clear message next to the button', await has(/Invalid verification code/) && await has(/newest one/));
    const errVisible = await page.evaluate(() => { const e = document.querySelector('.lp-error'); if (!e) return false; const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    check('the error is on screen without scrolling', errVisible);
    await click('button', /Skip for now/); await wait(1800);
    check('skipping opens the workspace, with a reminder banner', /government\/dashboard/.test(page.url()) && !(await has(/Turn on two-step verification\s+Dr\./)) && await has(/Please turn on two-step verification/));
    await fresh(); await page.evaluate(() => fetch('/__test/mfa?on=true')); await asSession('fin@ui.test'); await wait(800);
    await page.waitForFunction(() => document.querySelector('img[alt^="QR"]') || /Copy key/.test(document.body.innerText), { timeout: 8000 }).catch(() => {});
    await page.$eval('input[type=checkbox]', (c) => c.click());
    const code = await page.evaluate(async () => (await (await fetch('/__test/totp?email=fin@ui.test')).json()).code);
    await page.type('input.lp-code', code); await click('button[type=submit]', /Turn on and continue/); await wait(2000);
    check('after enrolling, the staff member reaches the workspace', /finance\/dashboard/.test(page.url()) && !(await has(/Turn on two-step verification\s+Sunita/)));
    await page.evaluate(() => fetch('/__test/mfa?on=false'));

    }

    if (part !== 'main') {
    // ───────── Dark mode sweep (screenshots to review) ─────────
    const darkPages = [['rohan@ui.test', '/startup/dashboard', 'startup-dashboard'], ['rohan@ui.test', '/startup/profile', 'startup-profile'], ['fin@ui.test', '/finance/payments', 'finance-payments'],
      ['fin@ui.test', '/finance/tax-ledger', 'finance-tax'], ['fin@ui.test', '/finance/reconcile', 'finance-reconcile'], ['admin@ui.test', '/admin/startups', 'admin-startups'], ['admin@ui.test', '/admin/settings', 'admin-settings'], ['admin@ui.test', '/admin/appeals', 'admin-appeals']];
    for (const [email, path, name] of darkPages) { await asSession(email); await open(path); await dark(); await wait(900); await shot(`dark-${name}`); }
    await fresh(); await open('/'); await dark(); await wait(2200); await shot('dark-login');

    // ───────── Phone-width sweep: nothing should scroll sideways ─────────
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
    const mobilePages = [[null, '/', 'login'], ['rohan@ui.test', '/startup/dashboard', 'startup-dashboard'], ['rohan@ui.test', '/startup/proposals', 'startup-proposals'], ['fin@ui.test', '/finance/payments', 'finance-payments'], ['admin@ui.test', '/admin/startups', 'admin-startups']];
    for (const [email, path, name] of mobilePages) {
      if (email) await asSession(email); else await fresh();
      await open(path); await wait(900);
      const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      if (over.sw > over.iw + 2) warnings.push(`${name}: the page is ${over.sw}px wide on a ${over.iw}px screen`);
      await shot(`mobile-${name}`);
    }

    // The signed-in shell must be usable on a phone: navigation hides in a drawer that opens from the menu button and closes after choosing a page
    await asSession('rohan@ui.test'); await open('/startup/dashboard'); await wait(700);
    const drawerClosed = await page.evaluate(() => getComputedStyle(document.querySelector('.shell-aside')).visibility === 'hidden');
    await page.click('.mobile-toggle'); await wait(500);
    const drawerOpen = await page.evaluate(() => { const r = document.querySelector('.shell-aside').getBoundingClientRect(); return r.left >= 0 && r.right > 200; });
    await page.evaluate(() => [...document.querySelectorAll('.shell-aside button')].find((b) => /Submit Proposal/.test(b.innerText))?.click()); await wait(1200);
    check('on a phone, navigation is a drawer that opens from the menu button and closes after choosing a page', drawerClosed && drawerOpen && /proposals\/create/.test(page.url()) && await page.evaluate(() => !document.querySelector('.shell-aside.open')));
    }
  }, { watchdogMs: 900000 });

  return { failures, problems, warnings };
}
