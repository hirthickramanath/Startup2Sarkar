import React, { useEffect, useState } from 'react';
import { useApp } from '../../../store';
import { authApi, networkApi } from '../../../api';
import { ShieldCheck, Clock, XCircle } from 'lucide-react';
import { LinkedAccounts, ProfileLinks, cardStyle } from '../../common/Profile';
import { PageHeader, useBusy } from '../../common/ui';
import { DocumentsPanel } from '../../common/Platform';

const STATUS = {
  VERIFIED: { cls: 'badge-success', icon: ShieldCheck, text: 'Verified by the platform administrator' },
  PENDING: { cls: 'badge-warning', icon: Clock, text: 'Verification pending: an administrator is reviewing your credentials' },
  REJECTED: { cls: 'badge-danger', icon: XCircle, text: 'Verification rejected' },
};

const Field = ({ label, children }) => (
  <div>
    <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)', textTransform: 'uppercase' }}>{label}</span>
    <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{children || <span style={{ color: 'var(--warning-text)', fontWeight: 500 }}>Not added yet</span>}</div>
  </div>
);

function RegistrationForm({ s }) {
  const { toast, fetchLiveData } = useApp();
  const [f, setF] = useState({});
  const [busy, run] = useBusy();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]).filter(([, v]) => v));
    if (body.pan) body.pan = body.pan.toUpperCase();
    if (body.gstin) body.gstin = body.gstin.toUpperCase();
    if (body.ifscCode) body.ifscCode = body.ifscCode.toUpperCase();
    if (!Object.keys(body).length) { toast.info('Fill in at least one field to save.'); return; }
    run(async () => {
      try {
        const r = await authApi.updateOrganization(body);
        toast.success(r.reverificationRequired ? 'Saved. Because these details changed, an administrator must verify your startup again.' : 'Registration details saved');
        setF({}); await fetchLiveData();
      } catch (ex) { toast.error([ex.message, ...(ex.details || [])].join(' • ')); }
    });
  };
  const fields = [['cinLlpin', 'CIN / LLPIN', s.cin], ['pan', 'Company PAN', s.pan], ['gstin', 'GSTIN', s.gstin], ['bankAccountNumber', 'Bank account number', s.bankDetails.accountMasked], ['ifscCode', 'Bank IFSC', s.bankDetails.ifsc], ['founderPhone', 'Mobile number', s.phone], ['website', 'Website (https://)', s.website], ['sector', 'Sector', s.sector !== 'Unspecified' ? s.sector : ''], ['stage', 'Stage', s.stage]];
  return (
    <form style={cardStyle} onSubmit={save}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Registration details</h2>
        <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--slate-600)', maxWidth: 560 }}>
          Complete these before bidding. Format checks run when you save. The bank account number is encrypted and shown masked. Changing statutory or bank details after verification sends your startup back for re-verification, which protects payments from being redirected.
        </p>
      </div>
      <div className="lp-grid2">
        {fields.map(([k, label, current]) => (
          <label key={k} className="lp-field">{label}
            <input value={f[k] || ''} onChange={set(k)} placeholder={current ? `Current: ${current}` : 'Not added yet'} autoComplete="off" />
          </label>
        ))}
      </div>
      <div><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button></div>
    </form>
  );
}

function InvestorVisibility({ s }) {
  const { toast, fetchLiveData } = useApp();
  const [on, setOn] = useState(!!s.showcaseOptIn);
  const [summary, setSummary] = useState(s.showcaseSummary || '');
  const [intros, setIntros] = useState([]);
  const [busy, run] = useBusy();
  const load = () => networkApi.incoming().then((r) => setIntros(r.intros)).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { setOn(!!s.showcaseOptIn); setSummary(s.showcaseSummary || ''); }, [s.showcaseOptIn, s.showcaseSummary]);
  const save = () => run(async () => {
    try { await networkApi.showcase(on, summary.trim()); toast.success(on ? 'You now appear in the investor directory' : 'You are hidden from investors'); fetchLiveData(); } catch (e) { toast.error(e.message); }
  });
  const respond = (id, accept) => run(async () => { try { await networkApi.respond(id, accept); toast.success(accept ? 'Accepted. Their email is now visible to you, yours to them.' : 'Declined'); load(); } catch (e) { toast.error(e.message); } });
  return (
    <section style={cardStyle}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Investor visibility</h2>
        <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--slate-600)', maxWidth: 560 }}>Verified investors can see only the short summary below, your sector, stage and links. They can ask for an introduction, and your contact details stay hidden until you accept.</p>
      </div>
      <label className="lp-check"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /><span>Show my startup in the investor directory</span></label>
      <label className="lp-field">Public summary (20–400 characters)
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={400} />
      </label>
      <div><button type="button" className="btn btn-primary" disabled={busy} onClick={save}>Save visibility</button></div>
      {intros.length > 0 && (
        <div style={{ borderTop: '1px solid var(--slate-200)', paddingTop: 12, display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: '0.9rem' }}>Introduction requests</strong>
          {intros.map((i) => (
            <div key={i.id} className="row-card">
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong>{i.organisation}</strong> <span className="badge badge-neutral">{i.status.toLowerCase()}</span>
                <div style={{ fontSize: '0.82rem', color: 'var(--slate-700)', margin: '4px 0' }}>{i.message}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--slate-500)' }}>{i.investorName} · {String(i.investorType).replace(/_/g, ' ').toLowerCase()}{i.investorEmail && ` · ${i.investorEmail}`}</div>
              </div>
              {i.status === 'PENDING' && <div style={{ display: 'flex', gap: 6 }}><button className="btn btn-outline btn-sm" disabled={busy} onClick={() => respond(i.id, false)}>Decline</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => respond(i.id, true)}>Accept</button></div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function StartupProfile() {
  const { state } = useApp();
  const s = state.startups[0];
  const st = STATUS[s.verificationStatus] || STATUS.PENDING;
  const Icon = st.icon;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 980 }}>
      <PageHeader title="Startup profile" subtitle="Your registration details, linked accounts, public links and investor visibility." />
      <section style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{s.name}</h2>
          <span className={`badge ${st.cls}`}><Icon size={12} /> {s.verificationStatus || 'PENDING'}</span>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--slate-600)', margin: 0 }}>{st.text}.</p>
        {s.verificationNotes && <p style={{ fontSize: '0.8rem', background: 'var(--slate-100)', padding: '0.6rem', borderRadius: 6, margin: 0 }}>Reviewer note: {s.verificationNotes}</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem', fontSize: '0.84rem' }}>
          <Field label="Founder">{s.founders}</Field>
          <Field label="DPIIT number">{s.dpiitReg}</Field>
          <Field label="CIN / LLPIN">{s.cin}</Field>
          <Field label="PAN (masked)">{s.pan}</Field>
          <Field label="GSTIN">{s.gstin}</Field>
          <Field label="Bank account (masked)">{s.bankDetails.accountMasked}</Field>
          <Field label="IFSC">{s.bankDetails.ifsc}</Field>
          <Field label="Sector">{s.sector !== 'Unspecified' ? s.sector : ''}</Field>
        </div>
      </section>
      <RegistrationForm s={s} />
      <DocumentsPanel />
      <LinkedAccounts />
      <ProfileLinks />
      <InvestorVisibility s={s} />
    </div>
  );
}
