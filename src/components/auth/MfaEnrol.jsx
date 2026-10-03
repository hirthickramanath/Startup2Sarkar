import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../store';
import { authApi } from '../../api';
import { Logo, ThemeControls } from '../common/ui';
import { AlertCircle, Loader2, ShieldCheck, LogOut, Copy } from 'lucide-react';

/** Full-screen, unskippable: staff cannot reach any data until two-step verification is on. */
export function MfaEnrol() {
  const { user, logout, refreshUser } = useAuth();
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true; // set-up generates a fresh secret each time, so ask exactly once
    authApi.setupMfa().then(async (r) => {
      setSetup(r);
      try { const QR = await import('qrcode'); setQr(await (QR.default || QR).toDataURL(r.otpauthUrl, { margin: 1, width: 220 })); } catch { /* the text secret still works */ }
    }).catch((e) => setErr(e.message));
  }, []);

  const confirm = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await authApi.enableMfa(code.trim()); await refreshUser(); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="lp-page">
      <header className="lp-top"><Logo size={38} nameSize={21} /><ThemeControls /></header>
      <main style={{ display: 'flex', justifyContent: 'center', padding: '8px 20px 48px' }}>
        <form className="lp-card" style={{ maxWidth: 560 }} onSubmit={confirm}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><ShieldCheck color="var(--success-text)" /><h2>Turn on two-step verification</h2></div>
          <p className="lp-sub">{user.name}, your account can approve and record public money, so a code from your phone is required every time you sign in. This takes about two minutes.</p>
          {err && <div className="lp-error" role="alert"><AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{err}</span></div>}
          {!setup && !err && <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--slate-600)' }}><Loader2 size={16} className="spin" /> Preparing…</div>}
          {setup && (
            <>
              <ol style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: 10, fontSize: '.9rem', color: 'var(--slate-800)' }}>
                <li>Install an authenticator app (Google Authenticator, Microsoft Authenticator or Aegis).</li>
                <li>Scan this code, or type the key by hand.
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                    {qr && <img src={qr} alt="QR code for your authenticator app" width={160} height={160} style={{ borderRadius: 8, background: '#fff', padding: 6 }} />}
                    <div style={{ minWidth: 0 }}>
                      <code style={{ display: 'block', wordBreak: 'break-all', padding: '.5rem .7rem', background: 'var(--slate-100)', borderRadius: 8, fontSize: '.8rem' }}>{setup.secret}</code>
                      <button type="button" className="lp-link" style={{ marginTop: 6, display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={() => navigator.clipboard?.writeText(setup.secret)}><Copy size={13} /> Copy key</button>
                    </div>
                  </div>
                </li>
                <li>Save these one-time recovery codes somewhere safe. They are the only way in if you lose your phone.
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 6, marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: '.8rem' }}>
                    {setup.recoveryCodes.map((c) => <code key={c} style={{ padding: '.3rem .5rem', background: 'var(--slate-100)', borderRadius: 6 }}>{c}</code>)}
                  </div>
                  <label className="lp-check" style={{ marginTop: 8 }}><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /><span>I have saved my recovery codes.</span></label>
                </li>
                <li>Type the 6-digit code the app shows now.</li>
              </ol>
              <label className="lp-field">6-digit code<input className="lp-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required /></label>
              <button type="submit" className="lp-primary" disabled={busy || !saved || code.length !== 6}>{busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={15} />} Turn on and continue</button>
            </>
          )}
          <button type="button" className="lp-link" style={{ alignSelf: 'center', display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={logout}><LogOut size={13} /> Sign out</button>
        </form>
      </main>
    </div>
  );
}
