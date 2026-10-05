import React, { useEffect, useState } from 'react';
import { authApi } from '../../api';
import { useAuth, useApp } from '../../store';
import { Logo, ThemeControls } from '../common/ui';
import { Captcha } from '../common/Captcha';
import { AlertCircle, Loader2, Users } from 'lucide-react';

/** Opened from the link in a team invitation. */
export function JoinTeam() {
  const { joinTeam, config } = useAuth();
  const { navigate } = useApp();
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [info, setInfo] = useState(null);
  const [bad, setBad] = useState(false);
  const [f, setF] = useState({ name: '', password: '', again: '', phone: '' });
  const [captcha, setCaptcha] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { authApi.joinInfo(token).then(setInfo).catch(() => setBad(true)); }, [token]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (f.password !== f.again) { setErr('The two passwords do not match.'); return; }
    setBusy(true);
    try { await joinTeam({ token, name: f.name.trim(), password: f.password, phone: f.phone.trim() || undefined, captchaToken: captcha }); window.history.replaceState({}, '', '/'); navigate('/startup/dashboard'); }
    catch (ex) { setErr([ex.message, ...(Array.isArray(ex.details) ? ex.details : [])].join(' • ')); }
    finally { setBusy(false); }
  };
  return (
    <div className="lp-page">
      <header className="lp-top"><Logo size={38} nameSize={21} /><ThemeControls /></header>
      <main style={{ display: 'flex', justifyContent: 'center', padding: '8px 20px 48px' }}>
        <form className="lp-card" style={{ maxWidth: 480 }} onSubmit={submit}>
          {bad || !token ? (
            <>
              <h2>This invitation can't be used</h2>
              <div className="lp-error"><AlertCircle size={16} /> It is invalid, already used, or has expired. Ask the account owner to send a new one.</div>
              <button type="button" className="lp-link" style={{ alignSelf: 'center' }} onClick={() => { window.location.href = '/'; }}>Go to sign in</button>
            </>
          ) : !info ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Loader2 size={16} className="spin" /> Checking your invitation…</div> : (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Users color="var(--accent-text)" /><h2>Join {info.organizationName}</h2></div>
              <p className="lp-sub">{info.invitedBy} invited <strong>{info.email}</strong> to work on this startup's proposals, pilots and payments. Choose a password to create your account.</p>
              {err && <div className="lp-error" role="alert"><AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{err}</span></div>}
              <label className="lp-field">Your full name<input value={f.name} onChange={set('name')} autoComplete="name" required /></label>
              <label className="lp-field">Mobile number (optional)<input value={f.phone} onChange={set('phone')} autoComplete="tel" inputMode="tel" /></label>
              <label className="lp-field">Password<input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" required /><small>At least 10 characters with upper and lower case, a number and a symbol.</small></label>
              <label className="lp-field">Repeat it<input type="password" value={f.again} onChange={set('again')} autoComplete="new-password" required /></label>
              {config.turnstileSiteKey && <Captcha onToken={setCaptcha} />}
              <button type="submit" className="lp-primary" disabled={busy || f.name.trim().length < 2}>{busy ? <Loader2 size={16} className="spin" /> : null} Join the team</button>
            </>
          )}
        </form>
      </main>
    </div>
  );
}
