import React, { useState } from 'react';
import { useApp, useAuth } from '../../store';
import { authApi } from '../../api';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { PageHeader, useBusy } from './ui';
import { cardStyle } from './Profile';

export function AccountSecurity() {
  const { toast } = useApp();
  const { user } = useAuth();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [busy, run] = useBusy();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const staff = ['government', 'finance', 'inspector', 'admin'].includes(user.role);
  const save = (e) => {
    e.preventDefault();
    if (f.next !== f.again) { toast.error('The two new passwords do not match.'); return; }
    run(async () => {
      try { await authApi.changePassword(f.current, f.next); toast.success('Password changed'); setF({ current: '', next: '', again: '' }); }
      catch (ex) { toast.error([ex.message, ...(Array.isArray(ex.details) ? ex.details : [])].join(' • ')); }
    });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 720 }}>
      <PageHeader title="Account security" subtitle="Your password and two-step verification." />
      <section style={cardStyle}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {user.mfaEnabled ? <ShieldCheck color="var(--success-text)" /> : <ShieldAlert color={staff ? 'var(--warning-text)' : 'var(--slate-500)'} />}
          <strong>Two-step verification is {user.mfaEnabled ? 'on' : 'off'}</strong>
        </div>
        {!user.mfaEnabled && <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--slate-600)' }}>{staff ? 'Staff accounts handle public money, so please turn this on: ' : 'You can add an extra step at sign-in: '}open your name menu (top right) and choose the two-step verification option to scan a code with an authenticator app.</p>}
      </section>
      <form style={cardStyle} onSubmit={save}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Change password</h2>
        {user.hasPassword === false && <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--slate-600)' }}>You sign in with Google or GitHub and have no password yet. Use "Forgot password?" on the sign-in page to create one.</p>}
        <label className="lp-field">Current password<input type="password" value={f.current} onChange={set('current')} autoComplete="current-password" required /></label>
        <div className="lp-grid2">
          <label className="lp-field">New password<input type="password" value={f.next} onChange={set('next')} autoComplete="new-password" required /></label>
          <label className="lp-field">Repeat new password<input type="password" value={f.again} onChange={set('again')} autoComplete="new-password" required /></label>
        </div>
        <small style={{ color: 'var(--slate-500)' }}>At least 10 characters with upper and lower case, a number and a symbol.</small>
        <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
      </form>
    </div>
  );
}
