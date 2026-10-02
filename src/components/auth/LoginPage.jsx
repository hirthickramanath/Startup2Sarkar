import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../store';
import { authApi } from '../../api';
import { Shield, Lock, ChevronRight, Eye, EyeOff, AlertCircle, Loader2, Building2, Rocket, Search, Wallet, Settings, ArrowLeft, CheckCircle2 } from 'lucide-react';

const ROLES = [
  { key: 'government', label: 'Government Official', icon: Building2, color: '#60a5fa', desc: 'Department officers & mission directors' },
  { key: 'startup', label: 'Startup Founder', icon: Rocket, color: '#34d399', desc: 'DPIIT-recognised innovators' },
  { key: 'inspector', label: 'Field Inspector', icon: Search, color: '#a78bfa', desc: 'Independent pilot verifiers' },
  { key: 'finance', label: 'Finance Officer', icon: Wallet, color: '#fbbf24', desc: 'Treasury & integrated finance' },
  { key: 'admin', label: 'Super Admin', icon: Settings, color: '#cbd5e1', desc: 'Platform administrators' },
];

/** Loads Google Identity Services once and renders the official "Continue with Google" button. */
function GoogleButton({ clientId, role, onCredential }) {
  const ref = useRef(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    const init = () => {
      if (cancelled || !window.google?.accounts?.id || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => cb.current(r.credential), ux_mode: 'popup', auto_select: false });
      ref.current.innerHTML = '';
      window.google.accounts.id.renderButton(ref.current, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 340, logo_alignment: 'left' });
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
  }, [clientId, role]);

  if (!clientId) return null;
  return (
    <div className="g-wrap">
      <div className="g-or"><span>or</span></div>
      <div ref={ref} className="g-btn" aria-label="Continue with Google" />
      {failed && <p className="auth-hint">Google sign-in could not load (blocked network or extension). Use your email and password instead.</p>}
    </div>
  );
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
      const body = { ...v, pan: (v.pan || '').toUpperCase(), gstin: (v.gstin || '').toUpperCase(), ifscCode: (v.ifscCode || '').toUpperCase(), website: v.website || '' };
      await authApi.registerStartup(body);
      setDone(true);
    } catch (ex) {
      const d = ex.details && Object.entries(ex.details).filter(([k]) => k !== '_errors').map(([k, x]) => `${k}: ${(x._errors || []).join(', ')}`).join(' • ');
      setErr(Array.isArray(ex.details) ? `${ex.message}: ${ex.details.join('; ')}` : d ? `${ex.message} — ${d}` : ex.message);
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <CheckCircle2 size={40} color="#34d399" />
        <h2 className="auth-h2">Registration received</h2>
        <p className="auth-hint">Your DPIIT, CIN, PAN and GSTIN details are pending review by a platform administrator. You can sign in now and browse challenges; bidding unlocks after verification.</p>
        <button className="auth-primary" onClick={onDone}>Go to sign in</button>
      </div>
    );
  }
  return (
    <form className="auth-card" onSubmit={submit}>
      <h2 className="auth-h2">Register your startup</h2>
      <p className="auth-hint">Statutory identifiers are format-checked on submission. PAN and bank account are encrypted at rest.</p>
      {err && <div className="auth-error" role="alert"><AlertCircle size={16} /> <span>{err}</span></div>}
      <div className="reg-grid">
        {REG_FIELDS.map(([k, label, type]) => (
          <label key={k} className="auth-field">{label}
            <input type={type} value={v[k] || ''} onChange={set(k)} required={!label.includes('optional')} autoComplete="off" />
          </label>
        ))}
      </div>
      <label className="auth-field">Password (min 10 characters, upper & lower case, a number and a symbol)
        <div className="pw-wrap">
          <input type={show ? 'text' : 'password'} value={v.password} onChange={set('password')} required autoComplete="new-password" />
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
      </label>
      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
        <button type="button" className="auth-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="auth-primary" disabled={busy} style={{ flex: 1 }}>{busy ? <Loader2 size={16} className="spin" /> : null} Register</button>
      </div>
    </form>
  );
}

export function LoginPage({ initialRole = null }) {
  const { login, loginWithGoogle, verifyMfa, cancelMfa, mfaChallenge, loginError, setLoginError, config } = useAuth();
  const [role, setRole] = useState(initialRole);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('signin'); // signin | register

  const step = mfaChallenge ? 'mfa' : role ? 'credentials' : 'role';
  const roleInfo = ROLES.find((r) => r.key === role);

  useEffect(() => { if (initialRole) setRole(initialRole); }, [initialRole]);

  const pick = (k) => { setRole(k); setLoginError(null); setMode('signin'); window.history.pushState({}, '', `/login/${k}`); };
  const back = () => {
    setLoginError(null); setMode('signin');
    if (mfaChallenge) { cancelMfa(); return; }
    setRole(null); setEmail(''); setPassword('');
    window.history.pushState({}, '', '/');
  };

  const submit = async (e) => { e.preventDefault(); if (!email || !password) return; setBusy(true); await login(email.trim(), password, role); setBusy(false); };
  const submitMfa = async (e) => { e.preventDefault(); if (!code) return; setBusy(true); await verifyMfa(code.trim()); setBusy(false); };
  const onGoogle = async (credential) => { setBusy(true); await loginWithGoogle(credential, role); setBusy(false); };

  return (
    <div className="auth-page">
      <div className="auth-bg" aria-hidden="true" />
      <header className="auth-top">
        <div className="brand"><span className="brand-chip">S2S</span><span>Startup2Sarkar</span></div>
        <span className="auth-top-note"><Shield size={13} /> Role-based • audited • encrypted</span>
      </header>

      <main className="auth-main">
        <div style={{ width: '100%', maxWidth: step === 'role' ? 760 : mode === 'register' ? 640 : 440, transition: 'max-width .3s ease' }}>
          {step !== 'role' && !(mode === 'register') && (
            <button className="auth-back" onClick={back}><ArrowLeft size={15} /> {step === 'mfa' ? 'Back' : 'Change role'}</button>
          )}

          {mode === 'register' ? (
            <RegisterStartup onDone={() => setMode('signin')} onCancel={() => setMode('signin')} />
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
                <h1 className="auth-h1">
                  {step === 'role' && 'Choose how you sign in'}
                  {step === 'credentials' && `${roleInfo.label} sign in`}
                  {step === 'mfa' && 'Two-step verification'}
                </h1>
                <p className="auth-hint">
                  {step === 'role' && 'Each role has its own gateway and sees only its own data.'}
                  {step === 'credentials' && 'Use the account issued to you.'}
                  {step === 'mfa' && (mfaChallenge?.message || 'Enter the 6-digit code from your authenticator app, or a recovery code.')}
                </p>
              </div>

              {loginError && <div className="auth-error" role="alert"><AlertCircle size={16} /> <span>{loginError}</span></div>}

              {step === 'role' && (
                <div className="role-grid">
                  {ROLES.map((r) => {
                    const Icon = r.icon;
                    return (
                      <button key={r.key} className="role-card" style={{ '--c': r.color }} onClick={() => pick(r.key)}>
                        <span className="role-ico"><Icon size={20} color={r.color} /></span>
                        <span className="role-name">{r.label}</span>
                        <span className="role-desc">{r.desc}</span>
                        <span className="role-go">Enter <ChevronRight size={14} /></span>
                      </button>
                    );
                  })}
                </div>
              )}

              {step === 'credentials' && (
                <form className="auth-card" onSubmit={submit}>
                  <label className="auth-field">Email
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
                  </label>
                  <label className="auth-field">Password
                    <div className="pw-wrap">
                      <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                    </div>
                  </label>
                  <button type="submit" className="auth-primary" disabled={busy}>
                    {busy ? <><Loader2 size={16} className="spin" /> Signing in…</> : <><Lock size={15} /> Sign in</>}
                  </button>
                  <GoogleButton clientId={config.googleClientId} role={role} onCredential={onGoogle} />
                  {role === 'startup' && (
                    <p className="auth-hint" style={{ textAlign: 'center', marginBottom: 0 }}>
                      New here? <button type="button" className="auth-link" onClick={() => { setLoginError(null); setMode('register'); }}>Register your startup</button>
                    </p>
                  )}
                  {role !== 'startup' && <p className="auth-hint" style={{ textAlign: 'center', marginBottom: 0 }}>Accounts for this role are created by your platform administrator.</p>}
                </form>
              )}

              {step === 'mfa' && (
                <form className="auth-card" onSubmit={submitMfa}>
                  <label className="auth-field">Authentication code
                    <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="text" autoComplete="one-time-code" maxLength={24} autoFocus required className="code-input" />
                  </label>
                  <button type="submit" className="auth-primary" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <Shield size={15} />} Verify</button>
                </form>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
