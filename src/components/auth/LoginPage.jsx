import React, { useState, useEffect, useRef } from 'react';
import { useAuth, useApp, useTheme } from '../../store';
import { authApi } from '../../api';
import { Logo, ThemeControls } from '../common/ui';
import { Lock, Eye, EyeOff, AlertCircle, Info, Loader2, Building2, Rocket, Search, Wallet, TrendingUp, Shield, ArrowLeft, CheckCircle2 } from 'lucide-react';

const ROLES = [
  { key: 'government', label: 'Government', icon: Building2, desc: 'Officers who post challenges and select startups' },
  { key: 'startup', label: 'Startup', icon: Rocket, desc: 'DPIIT-recognised startups bidding on challenges' },
  { key: 'inspector', label: 'Inspector', icon: Search, desc: 'Field verifiers who check pilot results on site' },
  { key: 'finance', label: 'Finance', icon: Wallet, desc: 'Officers who approve and record payments' },
  { key: 'investor', label: 'Investor', icon: TrendingUp, desc: 'Private investors and funders exploring startups' },
  { key: 'admin', label: 'Admin', icon: Shield, desc: 'Platform administrators, set up by invitation' },
];

const SIGNUP = {
  startup: { lead: 'New here?', link: 'Register your startup', tail: '' },
  investor: { lead: 'New here?', link: 'Register as an investor', tail: '' },
  government: { lead: 'New official?', link: 'Request access', tail: 'An administrator approves every request.' },
  finance: { lead: 'New official?', link: 'Request access', tail: 'An administrator approves every request.' },
  inspector: { lead: 'New official?', link: 'Request access', tail: 'An administrator approves every request.' },
  admin: { lead: 'Administrator accounts are created by an existing administrator.', link: '', tail: '' },
};

export function GoogleG({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function GitHubMark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** Google's own rendered button (so the logo and behaviour follow Google's rules), pill-shaped, themed light/dark.
 *  If Google sign-in is not configured on this server, a disabled look-alike explains why. */
export function GoogleButton({ clientId, onCredential, width = 240, text = 'signin_with' }) {
  const ref = useRef(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const { mode } = useTheme();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    const init = () => {
      if (cancelled || !window.google?.accounts?.id || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => cb.current(r.credential), ux_mode: 'popup', auto_select: false });
      ref.current.innerHTML = '';
      window.google.accounts.id.renderButton(ref.current, { theme: mode === 'dark' ? 'filled_black' : 'outline', size: 'large', shape: 'pill', text, width, logo_alignment: 'left' });
    };
    if (window.google?.accounts?.id) init();
    else {
      let s = document.getElementById('gsi-script');
      if (!s) {
        s = document.createElement('script');
        s.id = 'gsi-script'; s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
        s.onerror = () => setFailed(true);
        document.head.appendChild(s);
      }
      s.addEventListener('load', init);
      return () => { cancelled = true; s.removeEventListener('load', init); };
    }
    return () => { cancelled = true; };
  }, [clientId, mode, width, text]);

  if (!clientId || failed) {
    return (
      <button type="button" className="lp-pill" disabled title={failed ? 'Google could not load (blocked network or extension)' : 'Google sign-in is not set up on this server yet'}>
        <GoogleG /> Sign in with Google
      </button>
    );
  }
  return <div ref={ref} className="lp-gwrap" aria-label="Sign in with Google" style={{ colorScheme: 'light' }} />;
}

const REG_FIELDS = [
  ['startupName', 'Startup name', 'text'], ['founderName', 'Founder name', 'text'], ['email', 'Work email', 'email'], ['phone', 'Mobile number', 'tel'],
  ['sector', 'Sector', 'text'], ['website', 'Website (optional)', 'url'],
  ['dpiitNumber', 'DPIIT recognition no.', 'text'], ['cinLlpin', 'CIN / LLPIN', 'text'],
  ['pan', 'Company PAN', 'text'], ['gstin', 'GSTIN', 'text'],
  ['bankAccountNumber', 'Bank account number', 'text'], ['ifscCode', 'Bank IFSC', 'text'],
];

function RegisterStartup({ onDone, onCancel }) {
  const [v, setV] = useState({ password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [show, setShow] = useState(false);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      await authApi.registerStartup({ ...v, pan: (v.pan || '').toUpperCase(), gstin: (v.gstin || '').toUpperCase(), ifscCode: (v.ifscCode || '').toUpperCase(), website: v.website || '' });
      setDone(true);
    } catch (ex) {
      const d = ex.details && !Array.isArray(ex.details) && Object.entries(ex.details).filter(([k]) => k !== '_errors').map(([k, x]) => `${k}: ${(x._errors || []).join(', ')}`).join(' • ');
      setErr(Array.isArray(ex.details) ? `${ex.message}: ${ex.details.join('; ')}` : d ? `${ex.message} — ${d}` : ex.message);
    } finally { setBusy(false); }
  };
  if (done) {
    return (
      <div className="lp-card" style={{ textAlign: 'center', alignItems: 'center' }}>
        <CheckCircle2 size={40} color="var(--success-text)" />
        <h2>Registration received</h2>
        <p className="lp-sub">Your DPIIT, CIN, PAN and GSTIN details are pending review by a platform administrator. You can sign in now and browse challenges; bidding unlocks after verification.</p>
        <button className="lp-primary" style={{ width: '100%' }} onClick={onDone}>Go to sign in</button>
      </div>
    );
  }
  return (
    <form className="lp-card" onSubmit={submit} style={{ maxWidth: 640 }}>
      <h2>Register your startup</h2>
      <p className="lp-sub">Registering with Google or GitHub is quicker: you answer fewer questions now and add the rest later. Use this form if you prefer an email and password.</p>
      {err && <div className="lp-error" role="alert"><AlertCircle size={16} /> <span>{err}</span></div>}
      <div className="lp-grid2">
        {REG_FIELDS.map(([k, label, type]) => (
          <label key={k} className="lp-field">{label}
            <input type={type} value={v[k] || ''} onChange={set(k)} required={!label.includes('optional')} autoComplete="off" />
          </label>
        ))}
      </div>
      <label className="lp-field">Password (min 10 characters, upper & lower case, a number and a symbol)
        <div className="lp-pw">
          <input type={show ? 'text' : 'password'} value={v.password} onChange={set('password')} required autoComplete="new-password" />
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
      </label>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="lp-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="lp-primary" disabled={busy} style={{ flex: 1 }}>{busy ? <Loader2 size={16} className="spin" /> : null} Register</button>
      </div>
    </form>
  );
}

export function LoginPage({ initialRole = null }) {
  const { login, loginWithGoogle, verifyMfa, cancelMfa, mfaChallenge, loginError, setLoginError, config } = useAuth();
  const { navigate } = useApp();
  const [role, setRole] = useState(initialRole);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('signin'); // signin | register
  const [hint, setHint] = useState(null);
  const [forgot, setForgot] = useState(null); // null | { sent: bool }

  const step = mfaChallenge ? 'mfa' : role ? 'form' : 'role';
  const info = ROLES.find((r) => r.key === role);
  const su = SIGNUP[role] || { lead: '', link: '', tail: '' };
  useEffect(() => { if (initialRole) setRole(initialRole); }, [initialRole]);

  const pick = (k) => { setRole(k); setLoginError(null); setHint(null); setView('signin'); window.history.pushState({}, '', `/login/${k}`); };
  const back = () => {
    setLoginError(null); setHint(null); setView('signin');
    if (mfaChallenge) { cancelMfa(); return; }
    setRole(null); setEmail(''); setPassword(''); window.history.pushState({}, '', '/');
  };
  const submit = async (e) => { e.preventDefault(); if (!email || !password) return; setBusy(true); await login(email.trim(), password, role); setBusy(false); };
  const submitMfa = async (e) => { e.preventDefault(); if (!code) return; setBusy(true); await verifyMfa(code.trim()); setBusy(false); };
  const onGoogle = async (credential) => {
    setBusy(true);
    try { if (role) sessionStorage.setItem('s2s_signup_role', role); } catch { /* private mode */ }
    const r = await loginWithGoogle(credential, role || undefined);
    setBusy(false);
    if (r?.needsOnboarding) navigate('/signup');
  };
  const startSignup = () => {
    if (role === 'startup') { setView('register'); return; }
    // Everyone else signs up through Google (which has already verified their email), then answers a few questions.
    setHint(role === 'investor' ? 'To register as an investor, sign in with Google below. We will ask a few quick questions next.' : 'To request access, sign in with Google below. We will ask for your department and designation, and an administrator will approve the request.');
  };

  return (
    <div className="lp-page">
      <header className="lp-top">
        <Logo size={38} nameSize={21} />
        <ThemeControls />
      </header>

      <main className="lp-main">
        <section className="lp-hero">
          <span className="lp-eyebrow lp-rise">Public innovation procurement</span>
          <h1 className="lp-rise" style={{ animationDelay: '.1s' }}>From pilot to payment, every step on record.</h1>
          <p className="lp-rise" style={{ animationDelay: '.2s' }}>Post a challenge, review startup proposals, run a monitored pilot, verify results on site and release milestone payments, all in one system.</p>
          <div className="lp-loop" aria-hidden="true">
            <svg viewBox="0 0 520 200" style={{ width: '100%', height: 'auto', display: 'block' }}>
              <path d="M10 170 H510" style={{ stroke: 'var(--slate-200)' }} strokeWidth="3" strokeLinecap="round" fill="none" />
              <path d="M40 170 A220 140 0 0 1 480 170" style={{ stroke: 'var(--brand)' }} strokeWidth="5" strokeLinecap="round" fill="none" />
              <g strokeWidth="2" strokeLinecap="round" style={{ stroke: 'var(--slate-500)' }}>
                {[[95, 77.4], [150, 48.8], [205, 34.4], [260, 30], [315, 34.4], [370, 48.8], [425, 77.4]].map(([x, y]) => <line key={x} x1={x} y1={y} x2={x} y2="170" />)}
              </g>
              <polygon points="446,152 514,152 480,130" style={{ fill: 'var(--ink)' }} />
              {[454, 468, 482, 496].map((x) => <rect key={x} x={x} y="154" width="8" height="16" style={{ fill: 'var(--ink)' }} />)}
              <circle className="lp-pulse" cx="26" cy="140" r="7" style={{ fill: 'var(--accent)' }} />
              <circle className="lp-spark" cx="40" cy="170" r="7" style={{ fill: 'var(--accent)' }} />
            </svg>
          </div>
          <div className="lp-chips">
            <span className="lp-rise" style={{ animationDelay: '.5s' }}>Access limited by role</span>
            <span className="lp-rise" style={{ animationDelay: '.6s' }}>Audit log that flags any alteration</span>
            <span className="lp-rise" style={{ animationDelay: '.7s' }}>Bank details encrypted</span>
          </div>
        </section>

        {view === 'register' && step !== 'mfa' ? (
          <RegisterStartup onDone={() => setView('signin')} onCancel={() => setView('signin')} />
        ) : (
          <section className="lp-card lp-rise" style={{ animationDelay: '.25s' }}>
            {loginError && <div className="lp-error" role="alert"><AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{loginError}</span></div>}

            {step === 'role' && (
              <>
                <div>
                  <h2>Choose how you sign in</h2>
                  <p className="lp-sub">Each role opens its own workspace and sees only its own data.</p>
                </div>
                <div className="lp-roles">
                  {ROLES.map((r) => {
                    const Icon = r.icon;
                    return (
                      <button key={r.key} type="button" className="lp-role" onClick={() => pick(r.key)}>
                        <span className="ico"><Icon size={20} /></span>
                        <b>{r.label}</b>
                        <span>{r.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {step === 'form' && (
              <form onSubmit={submit} style={{ display: 'contents' }}>
                <button type="button" className="lp-back" onClick={back}><ArrowLeft size={16} /> Change role</button>
                <h2>{info.label} sign in</h2>
                <label className="lp-field">Email
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus placeholder="you@example.com" />
                </label>
                <label className="lp-field">Password
                  <div className="lp-pw">
                    <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required placeholder="Your password" />
                    <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                  </div>
                </label>
                <button type="submit" className="lp-primary" disabled={busy}>{busy ? <><Loader2 size={16} className="spin" /> Signing in…</> : <><Lock size={15} /> Sign in</>}</button>
                {config.emailEnabled ? (
                  forgot?.sent
                    ? <div className="lp-info" role="status"><Info size={16} style={{ flexShrink: 0, marginTop: 2 }} /><span>If that email belongs to an account, a reset link is on its way. It works once and expires in 30 minutes.</span></div>
                    : <button type="button" className="lp-link" style={{ alignSelf: 'center' }} onClick={async () => { if (!email.trim()) { setLoginError('Type your email above first, then choose "Forgot password?".'); return; } setLoginError(null); await authApi.forgotPassword(email.trim()).catch(() => {}); setForgot({ sent: true }); }}>Forgot password?</button>
                ) : <p className="lp-note" style={{ textAlign: 'center' }}>Forgot your password? Ask your administrator to reset it.</p>}
                <div className="lp-divider"><span>or</span></div>
                {hint && <div className="lp-info" role="status"><Info size={16} style={{ flexShrink: 0, marginTop: 2 }} /><span>{hint}</span></div>}
                <div className={role === 'startup' ? 'lp-social' : ''} style={role === 'startup' ? undefined : { display: 'flex', justifyContent: 'center' }}>
                  <GoogleButton clientId={config.googleClientId} onCredential={onGoogle} width={role === 'startup' ? 240 : 300} />
                  {role === 'startup' && (config.githubEnabled
                    ? <a className="lp-pill gh" href={authApi.githubLoginUrl} onClick={() => { try { sessionStorage.setItem('s2s_signup_role', 'startup'); } catch { /* private mode */ } }}><GitHubMark /> Sign in with GitHub</a>
                    : <button type="button" className="lp-pill gh" disabled title="GitHub sign-in is not set up on this server yet"><GitHubMark /> Sign in with GitHub</button>)}
                </div>
                <p className="lp-note">New here? Signing in with Google{role === 'startup' ? ' or GitHub' : ''} creates your account after a few quick questions.</p>
                <div className="lp-foot">
                  {su.lead} {su.link && <button type="button" className="lp-link" onClick={startSignup}>{su.link}</button>} {su.tail}
                </div>
              </form>
            )}

            {step === 'mfa' && (
              <form onSubmit={submitMfa} style={{ display: 'contents' }}>
                <button type="button" className="lp-back" onClick={back}><ArrowLeft size={16} /> Back</button>
                <h2>Two-step verification</h2>
                <p className="lp-sub">{mfaChallenge?.message || 'Enter the 6-digit code from your authenticator app, or a recovery code.'}</p>
                <label className="lp-field">Authentication code
                  <input className="lp-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={24} autoFocus required />
                </label>
                <button type="submit" className="lp-primary" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <Shield size={15} />} Verify</button>
              </form>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
