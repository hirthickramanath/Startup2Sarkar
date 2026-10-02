import React, { useEffect, useState } from 'react';
import { useAuth, useApp } from '../../store';
import { authApi } from '../../api';
import { Logo, ThemeControls } from '../common/ui';
import { GoogleG, GitHubMark } from './LoginPage';
import { AlertCircle, Loader2, Building2, Rocket, Search, Wallet, TrendingUp, Clock, XCircle, LogOut, RefreshCw } from 'lucide-react';

const CHOICES = [
  { key: 'startup', label: 'Startup', icon: Rocket, desc: 'I run a DPIIT-recognised startup and want to bid on challenges.', approval: false },
  { key: 'investor', label: 'Investor', icon: TrendingUp, desc: 'I invest privately and want to discover startups.', approval: false },
  { key: 'government', label: 'Government', icon: Building2, desc: 'I post challenges and select startups for a department.', approval: true },
  { key: 'finance', label: 'Finance', icon: Wallet, desc: 'I approve and record payments for a department.', approval: true },
  { key: 'inspector', label: 'Inspector', icon: Search, desc: 'I verify pilot results on site.', approval: true },
];
const INVESTOR_TYPES = [['ANGEL', 'Angel investor'], ['VENTURE_CAPITAL', 'Venture capital fund'], ['CSR_FUNDER', 'CSR funder'], ['CORPORATE', 'Corporate investor'], ['FAMILY_OFFICE', 'Family office'], ['BANK_OR_NBFC', 'Bank or NBFC'], ['OTHER', 'Other']];

function Field({ label, hint, children }) {
  return <label className="lp-field">{label}{children}{hint && <small>{hint}</small>}</label>;
}

/** Shown after a first Google/GitHub sign-in: a few questions, then the account is created. */
export function Onboarding() {
  const { completeOnboarding } = useAuth();
  const { navigate } = useApp();
  const [prefill, setPrefill] = useState(null);
  const [missing, setMissing] = useState(false);
  const [role, setRole] = useState(null);
  const [f, setF] = useState({ acceptTerms: false });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    authApi.onboardingPrefill()
      .then((p) => { setPrefill(p); setF((x) => ({ ...x, name: p.name || '' })); })
      .catch(() => setMissing(true));
  }, []);

  const choice = CHOICES.find((c) => c.key === role);

  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const sectors = (f.sectors || '').split(',').map((x) => x.trim()).filter(Boolean);
      const payload = { role, name: f.name, phone: f.phone, acceptTerms: !!f.acceptTerms };
      if (role === 'startup') Object.assign(payload, { startupName: f.startupName, sector: f.sector, dpiitNumber: f.dpiitNumber });
      if (role === 'investor') Object.assign(payload, { investorType: f.investorType, organisation: f.organisation, website: f.website || '', linkedinUrl: f.linkedinUrl || '', sectors });
      if (['government', 'finance', 'inspector'].includes(role)) Object.assign(payload, { departmentId: f.departmentId, designation: f.designation, officialEmail: f.officialEmail, employeeId: f.employeeId || '', reason: f.reason });
      await completeOnboarding(payload);
      navigate(`/${role}/dashboard`);
    } catch (ex) {
      setErr([ex.message, ...(Array.isArray(ex.details) ? ex.details : [])].filter(Boolean).join(' • '));
    } finally { setBusy(false); }
  };

  return (
    <div className="lp-page">
      <header className="lp-top"><Logo size={38} nameSize={21} /><ThemeControls /></header>
      <main style={{ display: 'flex', justifyContent: 'center', padding: '8px 20px 48px' }}>
        <div className="lp-card" style={{ maxWidth: 640 }}>
          {missing && (
            <>
              <h2>Your sign-up has expired</h2>
              <p className="lp-sub">For your security a sign-up must be finished within 30 minutes. Please sign in with Google or GitHub again.</p>
              <button className="lp-primary" onClick={() => { window.location.href = '/'; }}>Back to sign in</button>
            </>
          )}
          {!missing && !prefill && <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--slate-600)' }}><Loader2 size={16} className="spin" /> Loading…</div>}
          {prefill && (
            <form onSubmit={submit} style={{ display: 'contents' }}>
              <div>
                <h2>Welcome. Let's finish your account.</h2>
                <p className="lp-sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {prefill.provider === 'github' ? <GitHubMark size={16} /> : <GoogleG size={16} />}
                  Signed in as <strong>{prefill.email}</strong>
                </p>
              </div>
              {err && <div className="lp-error" role="alert"><AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{err}</span></div>}

              <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'contents' }}>
                <legend style={{ font: '600 14px Figtree, sans-serif', color: 'var(--ink)', marginBottom: 8 }}>I am joining as…</legend>
                <div className="lp-roles">
                  {CHOICES.map((c) => {
                    const Icon = c.icon;
                    const on = role === c.key;
                    return (
                      <button key={c.key} type="button" className="lp-role" aria-pressed={on} onClick={() => setRole(c.key)}
                        style={{ minHeight: 112, borderColor: on ? 'var(--brand)' : undefined, boxShadow: on ? '0 0 0 2px var(--brand)' : undefined }}>
                        <span className="ico"><Icon size={20} /></span>
                        <b>{c.label}</b>
                        <span>{c.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {choice && (
                <>
                  <div className={choice.approval ? 'lp-info' : 'lp-info'} role="status">
                    {choice.approval ? 'An administrator reviews every government, finance and inspector request. You can sign in while you wait, but you will not see any data until you are approved.'
                      : role === 'startup' ? 'Your account opens immediately. Bidding unlocks once an administrator verifies your registration details, which you can complete later from your profile.'
                      : 'Your account opens immediately. The startup directory unlocks once an administrator verifies your profile.'}
                  </div>
                  <div className="lp-grid2">
                    <Field label="Full name"><input value={f.name || ''} onChange={set('name')} required minLength={2} /></Field>
                    <Field label="Mobile number"><input type="tel" value={f.phone || ''} onChange={set('phone')} required placeholder="e.g. 9876543210" /></Field>
                  </div>

                  {role === 'startup' && (
                    <div className="lp-grid2">
                      <Field label="Startup name"><input value={f.startupName || ''} onChange={set('startupName')} required /></Field>
                      <Field label="Sector"><input value={f.sector || ''} onChange={set('sector')} required placeholder="e.g. CleanTech" /></Field>
                      <Field label="DPIIT recognition number" hint="PAN, GSTIN, CIN and bank details are collected later, in your profile."><input value={f.dpiitNumber || ''} onChange={set('dpiitNumber')} required /></Field>
                    </div>
                  )}

                  {role === 'investor' && (
                    <div className="lp-grid2">
                      <Field label="Type of investor"><select value={f.investorType || ''} onChange={set('investorType')} required><option value="">Select…</option>{INVESTOR_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                      <Field label="Organisation or fund"><input value={f.organisation || ''} onChange={set('organisation')} required /></Field>
                      <Field label="Website (optional)"><input type="url" value={f.website || ''} onChange={set('website')} placeholder="https://" /></Field>
                      <Field label="LinkedIn (optional)"><input type="url" value={f.linkedinUrl || ''} onChange={set('linkedinUrl')} placeholder="https://" /></Field>
                      <Field label="Sectors of interest" hint="Separate with commas, e.g. HealthTech, AgriTech"><input value={f.sectors || ''} onChange={set('sectors')} /></Field>
                    </div>
                  )}

                  {choice.approval && (
                    <div className="lp-grid2">
                      <Field label="Department">
                        <select value={f.departmentId || ''} onChange={set('departmentId')} required>
                          <option value="">Select…</option>
                          {prefill.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Designation"><input value={f.designation || ''} onChange={set('designation')} required placeholder="e.g. Section Officer" /></Field>
                      <Field label="Official email" hint="Your government or department address"><input type="email" value={f.officialEmail || ''} onChange={set('officialEmail')} required /></Field>
                      <Field label="Employee ID (optional)"><input value={f.employeeId || ''} onChange={set('employeeId')} /></Field>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <Field label="Why do you need access?" hint="At least 20 characters. The administrator reads this."><textarea value={f.reason || ''} onChange={set('reason')} required minLength={20} /></Field>
                      </div>
                      {prefill.departments.length === 0 && <div className="lp-error" style={{ gridColumn: '1 / -1' }}>No departments exist yet. Ask the platform administrator to create yours first.</div>}
                    </div>
                  )}

                  <label className="lp-check">
                    <input type="checkbox" checked={!!f.acceptTerms} onChange={(e) => setF((x) => ({ ...x, acceptTerms: e.target.checked }))} required />
                    <span>I agree to the terms of use and understand how my details are used to run this service.</span>
                  </label>
                  <button type="submit" className="lp-primary" disabled={busy}>{busy ? <><Loader2 size={16} className="spin" /> Creating…</> : choice.approval ? 'Send access request' : 'Create my account'}</button>
                </>
              )}
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

/** Shown instead of the app while an access request is pending or was not approved. */
export function AccessPending() {
  const { user, logout, refreshUser } = useAuth();
  const { navigate } = useApp();
  const [req, setReq] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const load = () => authApi.accessRequest().then((r) => setReq(r.request)).catch(() => setReq(null));
  useEffect(() => { load(); }, []);
  const rejected = user.status === 'REJECTED';
  const recheck = async () => {
    setBusy(true);
    const u = await refreshUser(); await load();
    setBusy(false);
    if (u && (u.status || 'ACTIVE') === 'ACTIVE') navigate(`/${u.role}/dashboard`);
  };
  return (
    <div className="lp-page">
      <header className="lp-top"><Logo size={38} nameSize={21} /><ThemeControls /></header>
      <main style={{ display: 'flex', justifyContent: 'center', padding: '8px 20px 48px' }}>
        <div className="lp-card" style={{ maxWidth: 560 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {rejected ? <XCircle size={30} color="var(--danger-text)" /> : <Clock size={30} color="var(--warning-text)" />}
            <h2>{rejected ? 'Your request was not approved' : 'Waiting for administrator approval'}</h2>
          </div>
          <p className="lp-sub">
            {rejected
              ? 'An administrator reviewed your request and could not approve it. The reason is below. If you think this is a mistake, contact your department or the platform administrator.'
              : `Thanks, ${user.name}. Your request is with the platform administrator. You will see your workspace here as soon as it is approved. Until then no data is available to you.`}
          </p>
          {req && (
            <dl style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '8px 12px', fontSize: 14, margin: 0 }}>
              {[['Requested role', req.requested_role], ['Department', req.department_name], ['Designation', req.designation], ['Official email', req.official_email], ['Submitted', String(req.created_at).slice(0, 10)], ['Decision note', req.review_note]].map(([k, v]) => v && (
                <React.Fragment key={k}><dt style={{ color: 'var(--slate-500)' }}>{k}</dt><dd style={{ margin: 0, wordBreak: 'break-word' }}>{v}</dd></React.Fragment>
              ))}
            </dl>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="lp-secondary" onClick={logout}><LogOut size={14} style={{ verticalAlign: '-2px' }} /> Sign out</button>
            {!rejected && <button className="lp-primary" style={{ flex: 1 }} disabled={busy} onClick={recheck}><RefreshCw size={15} className={busy ? 'spin' : ''} /> Check again</button>}
          </div>
        </div>
      </main>
    </div>
  );
}
