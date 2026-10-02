import React from 'react';
import { useApp } from '../../../store';
import { ShieldCheck, Clock, XCircle } from 'lucide-react';

const STATUS = {
  VERIFIED: { cls: 'badge-success', icon: ShieldCheck, text: 'Verified by the platform administrator' },
  PENDING: { cls: 'badge-warning', icon: Clock, text: 'Verification pending — an administrator is reviewing your credentials' },
  REJECTED: { cls: 'badge-danger', icon: XCircle, text: 'Verification rejected' },
};

const Field = ({ label, children }) => (
  <div>
    <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)', textTransform: 'uppercase' }}>{label}</span>
    <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{children || <span style={{ color: 'var(--slate-400)' }}>Not provided</span>}</div>
  </div>
);

export function StartupProfile() {
  const { state } = useApp();
  const s = state.startups[0];
  const st = STATUS[s.verificationStatus] || STATUS.PENDING;
  const Icon = st.icon;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Startup Profile</h1>
        <span style={{ fontSize: '0.8rem', color: 'var(--slate-500)' }}>
          The credentials below are reused on every proposal and payment claim. Sensitive identifiers are masked.
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0 }}>{s.name}</h3>
            <span className={`badge ${st.cls}`}><Icon size={12} /> {s.verificationStatus || 'PENDING'}</span>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--slate-600)', marginTop: 0 }}>{st.text}.</p>
          {s.verificationNotes && <p style={{ fontSize: '0.8rem', background: 'var(--slate-50)', padding: '0.6rem', borderRadius: 6 }}>Reviewer note: {s.verificationNotes}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.84rem' }}>
            <Field label="Founder">{s.founders}</Field>
            <Field label="Sector">{s.sector !== 'Unspecified' ? s.sector : ''}</Field>
            <Field label="DPIIT number">{s.dpiitReg}</Field>
            <Field label="CIN / LLPIN">{s.cin}</Field>
            <Field label="PAN">{s.pan}</Field>
            <Field label="GSTIN">{s.gstin}</Field>
            <Field label="Contact">{[s.founderEmail, s.phone].filter(Boolean).join(' • ')}</Field>
            <Field label="Website">{s.website && <a href={s.website} target="_blank" rel="noreferrer">{s.website}</a>}</Field>
          </div>
          {(!s.dpiitReg || !s.cin) && s.verificationStatus !== 'VERIFIED' && (
            <p style={{ fontSize: '0.78rem', color: 'var(--warning-text)', marginBottom: 0 }}>
              Your statutory details are incomplete (you may have signed in with Google). Contact the platform administrator to complete verification.
            </p>
          )}
        </div>

        <div className="card">
          <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem', marginBottom: '0.85rem' }}>Bank mandate</h3>
          <div style={{ fontSize: '0.84rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div><strong>Account:</strong> {s.bankDetails.accountMasked || 'Not provided'}</div>
            <div><strong>IFSC:</strong> <code>{s.bankDetails.ifsc || '—'}</code></div>
            <div style={{ color: 'var(--slate-500)', fontSize: '0.76rem' }}>
              The full account number is encrypted at rest (AES-256-GCM) and is never shown again. A change of bank details places payments on hold until re-verified.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
