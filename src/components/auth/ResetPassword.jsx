import React, { useState } from 'react';
import { authApi } from '../../api';
import { useApp } from '../../store';
import { Logo, ThemeControls } from '../common/ui';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

/** Opened from the link in the password-reset email. */
export function ResetPassword() {
  const { navigate } = useApp();
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (pw !== pw2) { setErr('The two passwords do not match.'); return; }
    setBusy(true);
    try { await authApi.resetPassword(token, pw); setDone(true); window.history.replaceState({}, '', '/reset-password'); }
    catch (ex) { setErr([ex.message, ...(Array.isArray(ex.details) ? ex.details : [])].join(' • ')); }
    finally { setBusy(false); }
  };
  return (
    <div className="lp-page">
      <header className="lp-top"><Logo size={38} nameSize={21} /><ThemeControls /></header>
      <main style={{ display: 'flex', justifyContent: 'center', padding: '8px 20px 48px' }}>
        <form className="lp-card" style={{ maxWidth: 460 }} onSubmit={submit}>
          {done ? (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><CheckCircle2 color="var(--success-text)" /><h2>Password changed</h2></div>
              <p className="lp-sub">You were signed out everywhere. Sign in with your new password.</p>
              <button type="button" className="lp-primary" onClick={() => { window.location.href = '/'; }}>Go to sign in</button>
            </>
          ) : (
            <>
              <h2>Choose a new password</h2>
              {!token && <div className="lp-error"><AlertCircle size={16} /> This page needs the link from your email.</div>}
              {err && <div className="lp-error" role="alert"><AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{err}</span></div>}
              <label className="lp-field">New password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required /><small>At least 10 characters with upper and lower case, a number and a symbol.</small></label>
              <label className="lp-field">Repeat it<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required /></label>
              <button type="submit" className="lp-primary" disabled={busy || !token}>{busy ? <Loader2 size={16} className="spin" /> : null} Change password</button>
              <button type="button" className="lp-link" style={{ alignSelf: 'center' }} onClick={() => navigate('/')}>Back to sign in</button>
            </>
          )}
        </form>
      </main>
    </div>
  );
}
