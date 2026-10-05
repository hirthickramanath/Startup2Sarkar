import React, { useEffect, useState } from 'react';
import { emailApi } from '../../../api';
import { CheckCircle2, XCircle, Send, MailWarning } from 'lucide-react';
import { PageHeader, StatusBadge, useBusy } from '../../common/ui';
import { cardStyle } from '../../common/Profile';

/** Is email working? What failed, why, and a test button. */
export function AdminEmail() {
  const [st, setSt] = useState(null);
  const [to, setTo] = useState('');
  const [result, setResult] = useState(null);
  const [busy, run] = useBusy();
  const load = () => emailApi.status().then(setSt).catch(() => setSt({ recent: [], last24h: { sent: 0, failed: 0 }, provider: 'development', delivers: false, lastFailureHints: [] }));
  useEffect(() => { load(); }, []);
  const test = () => run(async () => { try { setResult(await emailApi.test(to.trim() || undefined)); } catch (e) { setResult({ ok: false, error: e.message, hints: [] }); } await load(); });
  if (!st) return <div style={{ padding: '2rem' }}>Loading…</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 860 }}>
      <PageHeader title="Email" subtitle="Confirmation links, password resets, invitations and decisions are sent by email. This page shows whether that is working and why a message failed." />
      <section style={cardStyle}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {st.delivers ? <CheckCircle2 color="var(--success-text)" /> : <MailWarning color="var(--warning-text)" />}
          <strong>{st.delivers ? 'Connected to Brevo' : 'Not connected: messages are NOT being delivered'}</strong>
        </div>
        {!st.delivers && <p style={{ margin: 0, fontSize: '.86rem', color: 'var(--warning-text)' }}>Set BREVO_API_KEY and EMAIL_FROM in the host's environment settings. Until then nobody receives confirmation links or password resets.</p>}
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: '.86rem', color: 'var(--slate-700)' }}>
          <span>Sender: <strong>{st.sender || 'not set'}</strong></span>
          <span>API key: <strong>{st.keySet ? 'set' : 'not set'}</strong></span>
          <span>Last 24 hours: <strong style={{ color: 'var(--success-text)' }}>{st.last24h.sent} sent</strong>, <strong style={{ color: st.last24h.failed ? 'var(--danger-text)' : 'inherit' }}>{st.last24h.failed} failed</strong></span>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Send a test email</h2>
        <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--slate-600)' }}>Leave the box empty to send it to your own address. If it fails, the exact reason from the email provider appears below.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="form-control" style={{ flex: 1, minWidth: 220 }} type="email" aria-label="Send the test to" placeholder="your own address" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn btn-primary" disabled={busy} onClick={test}><Send size={14} /> {busy ? 'Sending…' : 'Send test email'}</button>
        </div>
        {result && (result.ok ? (
          <div style={{ padding: '.7rem .9rem', borderRadius: 'var(--radius-md)', background: 'var(--success-bg)', color: 'var(--success-text)', fontSize: '.86rem' }}>
            <strong>Test email sent</strong> to {result.to}. {result.delivers ? 'Check the inbox and the spam folder.' : 'This server is in development mode, so nothing was actually delivered.'}
          </div>
        ) : (
          <div style={{ padding: '.7rem .9rem', borderRadius: 'var(--radius-md)', background: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: '.86rem', display: 'grid', gap: 6 }}>
            <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}><XCircle size={15} /> The email could not be sent</strong>
            <span>{result.error}</span>
            {(result.hints || []).map((h, i) => <span key={i}>• {h}</span>)}
          </div>
        ))}
      </section>

      {st.lastFailureHints.length > 0 && (
        <section style={{ ...cardStyle, background: 'var(--warning-bg)' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>What to fix</h2>
          {st.lastFailureHints.map((h, i) => <p key={i} style={{ margin: 0, fontSize: '.86rem' }}>• {h}</p>)}
        </section>
      )}

      <section style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Recent messages</h2>
        {st.recent.length === 0 ? <span style={{ fontSize: '.86rem', color: 'var(--slate-500)' }}>Nothing sent yet.</span> : st.recent.map((m) => (
          <div key={m.id} className="row-card" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '.88rem' }}>{m.subject}</div>
              <div style={{ fontSize: '.76rem', color: 'var(--slate-500)' }}>to {m.to} · {String(m.at).slice(0, 16).replace('T', ' ')}</div>
              {m.error && <div style={{ fontSize: '.78rem', color: 'var(--danger-text)', overflowWrap: 'anywhere' }}>{m.error}</div>}
            </div>
            <StatusBadge status={m.status === 'SENT' ? 'Sent' : 'Failed'} size="sm" />
          </div>
        ))}
      </section>
    </div>
  );
}
