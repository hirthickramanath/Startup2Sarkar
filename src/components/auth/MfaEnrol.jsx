import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../store';
import { authApi } from '../../api';
import { Logo, ThemeControls } from '../common/ui';
import { AlertCircle, Loader2, ShieldCheck, LogOut, Copy, Clock } from 'lucide-react';

// The set-up secret survives this screen re-mounting, so a code from the app you already scanned always matches
let cachedSetup = null;

/** Full-screen: staff must turn on two-step verification, or postpone it a limited number of times. */
export function MfaEnrol() {
  const { user, logout, refreshUser } = useAuth();
  const [setup, setSetup] = useState(cachedSetup);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const errRef = useRef(null);
  const skipsLeft = user.mfaSkipsLeft ?? 0;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const show = async (r) => {
      setSetup(r);
      try { const QR = await import('qrcode'); setQr(await (QR.default || QR).toDataURL(r.otpauthUrl, { margin: 1, width: 220 })); } catch { /* the typed key still works */ }
    };
    if (cachedSetup) { show(cachedSetup); return; }
    authApi.setupMfa().then((r) => { cachedSetup = r; return show(r); }).catch((e) => setErr(e.message));
  }, []);

  // An error is shown right above the button and scrolled into view, so it is never missed
  const fail = (msg) => { setErr(msg); setTimeout(() => errRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50); };

  const confirm = async (e) => {
    e.preventDefault(); setErr(null);
    if (!saved) { fail('Tick the box above to confirm you have saved your recovery codes.'); return; }
    if (code.length !== 6) { fail('Type the 6-digit code that your authenticator app shows right now.'); return; }
    setBusy(true);
    try { await authApi.enableMfa(code.trim()); cachedSetup = null; await refreshUser(); }
    catch (ex) { fail(`${ex.message} Codes change every 30 seconds, so type the newest one. If it keeps failing, check that your phone's date and time are set to automatic.`); }
    finally { setBusy(false); }
  };

  const skip = async () => {
    setErr(null); setBusy(true);
    try { await authApi.skipMfa(); await refreshUser(); }
    catch (ex) { fail(ex.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="lp-page">
      <header className="lp-top"><Logo size={38} nameSize={21} /><ThemeControls /></header>
      <main style={{ display: 'flex', justifyContent: 'center', padding: '8px 20px 48px' }}>
        <form className="lp-card" style={{ maxWidth: 560 }} onSubmit={confirm} noValidate>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><ShieldCheck color="var(--success-text)" /><h2>Turn on two-step verification</h2></div>
          <p className="lp-sub">{user.name}, your account can approve and record public money, so a code from your phone is asked for every time you sign in. This takes about two minutes.</p>
          {!setup && err && <div className="lp-error" role="alert"><AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{err}</span></div>}
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
                  <label className="lp-check" style={{ marginTop: 8 }}><input type="checkbox" checked={saved} onChange={(e) => { setSaved(e.target.checked); setErr(null); }} /><span>I have saved my recovery codes.</span></label>
                </li>
                <li>Type the 6-digit code the app shows now.</li>
              </ol>
              <label className="lp-field">6-digit code<input className="lp-code" value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(null); }} inputMode="numeric" autoComplete="one-time-code" /></label>
              <div ref={errRef}>{err && <div className="lp-error" role="alert"><AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{err}</span></div>}</div>
              <button type="submit" className="lp-primary" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={15} />} Turn on and continue</button>
            </>
          )}
          <div style={{ display: 'grid', gap: 6, justifyItems: 'center', marginTop: 4 }}>
            {skipsLeft > 0
              ? <button type="button" className="lp-secondary" disabled={busy} onClick={skip} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Clock size={14} /> Skip for now</button>
              : <small style={{ color: 'var(--warning-text)' }}>You have used all your skips, so two-step verification is now required.</small>}
            {skipsLeft > 0 && <small style={{ color: 'var(--slate-500)', textAlign: 'center' }}>We will ask again in 24 hours. You can skip {skipsLeft} more time{skipsLeft > 1 ? 's' : ''}. Until you turn it on, your account is less protected.</small>}
            <button type="button" className="lp-link" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={logout}><LogOut size={13} /> Sign out</button>
          </div>
        </form>
      </main>
    </div>
  );
}
