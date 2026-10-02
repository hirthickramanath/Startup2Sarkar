import React, { useEffect, useState } from 'react';
import { useApp } from '../../../store';
import { networkApi } from '../../../api';
import { Lock, ShieldCheck, Clock, ExternalLink, Send } from 'lucide-react';
import { LinkedAccounts, ProfileLinks, cardStyle } from '../../common/Profile';
import { Modal, PageHeader, EmptyState, StatusBadge, useBusy } from '../../common/ui';

const TYPES = [['ANGEL', 'Angel investor'], ['VENTURE_CAPITAL', 'Venture capital fund'], ['CSR_FUNDER', 'CSR funder'], ['CORPORATE', 'Corporate investor'], ['FAMILY_OFFICE', 'Family office'], ['BANK_OR_NBFC', 'Bank or NBFC'], ['OTHER', 'Other']];
const pretty = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function useProfile() {
  const [p, setP] = useState(null);
  const load = () => networkApi.me().then((r) => setP(r)).catch(() => setP({ profile: null, links: [] }));
  useEffect(() => { load(); }, []);
  return [p, load];
}

function VerificationCard({ profile }) {
  if (!profile) return null;
  const v = profile.verificationStatus;
  const map = { VERIFIED: ['var(--success-bg)', 'var(--success-text)', ShieldCheck, 'Your profile is verified. You can browse startups and request introductions.'], PENDING: ['var(--warning-bg)', 'var(--warning-text)', Clock, 'Verification pending. An administrator is reviewing your profile. The startup directory opens as soon as you are verified.'], REJECTED: ['var(--danger-bg)', 'var(--danger-text)', Lock, 'Your profile was not verified.'] };
  const [bg, fg, Icon, text] = map[v] || map.PENDING;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 'var(--radius-lg)', background: bg, color: fg, fontSize: '0.9rem', lineHeight: 1.5 }}>
      <Icon size={20} style={{ flexShrink: 0, marginTop: 2 }} />
      <div><strong>{pretty(v)}.</strong> {text}{profile.verificationNotes && <div style={{ marginTop: 4 }}>Reviewer note: {profile.verificationNotes}</div>}</div>
    </div>
  );
}

export function InvestorDashboard() {
  const { navigate, currentUser } = useApp();
  const [p] = useProfile();
  const [intros, setIntros] = useState([]);
  useEffect(() => { networkApi.intros().then((r) => setIntros(r.intros)).catch(() => {}); }, []);
  const count = (s) => intros.filter((i) => i.status === s).length;
  const verified = p?.profile?.verificationStatus === 'VERIFIED';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 980 }}>
      <PageHeader title={`Welcome, ${(currentUser?.name || '').split(' ')[0]}`} subtitle="Discover verified startups and request introductions." />
      <VerificationCard profile={p?.profile} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '1rem' }}>
        {[['Pending requests', count('PENDING')], ['Accepted', count('ACCEPTED')], ['Declined', count('DECLINED')]].map(([l, n]) => (
          <div key={l} className="card"><div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{n}</div><div style={{ fontSize: '0.78rem', color: 'var(--slate-500)' }}>{l}</div></div>
        ))}
      </div>
      <section style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>How it works</h2>
        <ol style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.88rem', color: 'var(--slate-700)', lineHeight: 1.7 }}>
          <li>An administrator verifies your profile.</li>
          <li>You browse startups that are verified and have chosen to appear here. You see only what they publish.</li>
          <li>You send a short introduction request. The startup decides whether to accept.</li>
          <li>Only after they accept are contact details shared, both ways. Administrators cannot read your requests.</li>
        </ol>
        <div><button className="btn btn-primary" disabled={!verified} onClick={() => navigate('/investor/startups')}>Browse startups</button></div>
      </section>
    </div>
  );
}

export function InvestorStartups() {
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [locked, setLocked] = useState(null);
  const [q, setQ] = useState('');
  const [target, setTarget] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, run] = useBusy();
  const load = () => networkApi.startups(q ? { q } : {}).then((r) => { setData(r.startups); setLocked(null); }).catch((e) => { if (e.code === 'INVESTOR_NOT_VERIFIED') setLocked(e.message); else toast.error(e.message); setData([]); });
  useEffect(() => { load(); }, []);
  const send = () => run(async () => {
    try { await networkApi.requestIntro(target.id, msg.trim()); toast.success('Introduction request sent'); setTarget(null); setMsg(''); load(); } catch (e) { toast.error(e.message); }
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Startup directory" subtitle="Verified startups that chose to be visible to investors." actions={!locked && (
        <form onSubmit={(e) => { e.preventDefault(); load(); }} style={{ display: 'flex', gap: 8 }}>
          <input className="form-control" aria-label="Search startups" placeholder="Search name or summary" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
          <button className="btn btn-outline" type="submit">Search</button>
        </form>
      )} />
      {locked && <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Lock size={20} /> <span>{locked}</span></div>}
      {!locked && data && data.length === 0 && <EmptyState title="No startups to show yet">Startups appear here once an administrator verifies them and they opt in.</EmptyState>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: '1rem' }}>
        {(data || []).map((s) => (
          <div key={s.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong style={{ fontSize: '1.05rem' }}>{s.name}</strong>{s.verifiedPilots > 0 && <span className="badge badge-success">{s.verifiedPilots} verified pilot{s.verifiedPilots > 1 ? 's' : ''}</span>}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--slate-500)' }}>{s.sector} · {s.stage}</div>
            <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--slate-700)' }}>{s.summary}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[...(s.website ? [{ kind: 'website', url: s.website }] : []), ...s.links.filter((l) => l.kind !== 'website')].map((l) => (
                <a key={l.kind + l.url} href={l.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.78rem', display: 'inline-flex', gap: 4, alignItems: 'center' }}>{pretty(l.kind)} <ExternalLink size={11} /></a>
              ))}
            </div>
            <div style={{ marginTop: 'auto' }}>
              {s.introStatus ? <StatusBadge status={pretty(s.introStatus)} size="sm" /> : <button className="btn btn-primary btn-sm" onClick={() => { setTarget(s); setMsg(''); }}><Send size={13} /> Request introduction</button>}
            </div>
          </div>
        ))}
      </div>
      <Modal isOpen={!!target} onClose={() => setTarget(null)} title={`Introduction to ${target?.name || ''}`} maxWidth="520px"
        footer={<><button className="btn btn-secondary" onClick={() => setTarget(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || msg.trim().length < 20} onClick={send}>{busy ? 'Sending…' : 'Send request'}</button></>}>
        <p style={{ fontSize: '0.84rem', color: 'var(--slate-600)', marginTop: 0 }}>Say who you are and why you are interested (at least 20 characters). Your contact details are shared only if the startup accepts. You can send up to 10 requests a week.</p>
        <textarea className="form-control" rows={5} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={1000} aria-label="Message to the startup" />
      </Modal>
    </div>
  );
}

export function InvestorIntros() {
  const [rows, setRows] = useState(null);
  useEffect(() => { networkApi.intros().then((r) => setRows(r.intros)).catch(() => setRows([])); }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 900 }}>
      <PageHeader title="My introductions" subtitle="Requests you sent and where they stand." />
      {rows && rows.length === 0 && <EmptyState title="No requests yet">Find a startup in the directory and ask for an introduction.</EmptyState>}
      {(rows || []).map((i) => (
        <div key={i.id} className="row-card">
          <div style={{ flex: 1, minWidth: 220 }}>
            <strong>{i.startupName}</strong> <StatusBadge status={pretty(i.status)} size="sm" />
            <div style={{ fontSize: '0.82rem', color: 'var(--slate-700)', margin: '4px 0' }}>{i.message}</div>
            <div style={{ fontSize: '0.74rem', color: 'var(--slate-500)' }}>Sent {String(i.createdAt).slice(0, 10)}</div>
            {i.contact && <div style={{ fontSize: '0.84rem', marginTop: 6, color: 'var(--success-text)' }}>Contact: {i.contact.email}{i.contact.phone ? ` · ${i.contact.phone}` : ''}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function InvestorProfile() {
  const { toast } = useApp();
  const [p, reload] = useProfile();
  const [f, setF] = useState(null);
  const [busy, run] = useBusy();
  useEffect(() => { if (p?.profile) setF({ investorType: p.profile.investorType, organisation: p.profile.organisation, website: p.profile.website || '', linkedinUrl: p.profile.linkedinUrl || '', sectors: (p.profile.sectors || []).join(', ') }); }, [p]);
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      try {
        await networkApi.updateMe({ investorType: f.investorType, organisation: f.organisation, website: f.website, linkedinUrl: f.linkedinUrl, sectors: f.sectors.split(',').map((x) => x.trim()).filter(Boolean) });
        toast.success('Profile saved'); reload();
      } catch (ex) { toast.error([ex.message, ...(ex.details || [])].join(' • ')); }
    });
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 900 }}>
      <PageHeader title="Investor profile" subtitle="What the platform and startups know about you." />
      <VerificationCard profile={p?.profile} />
      {f && (
        <form style={cardStyle} onSubmit={save}>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Details</h2>
          <div className="lp-grid2">
            <label className="lp-field">Type of investor<select value={f.investorType} onChange={set('investorType')}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="lp-field">Organisation or fund<input value={f.organisation} onChange={set('organisation')} required /></label>
            <label className="lp-field">Website<input type="url" value={f.website} onChange={set('website')} placeholder="https://" /></label>
            <label className="lp-field">LinkedIn<input type="url" value={f.linkedinUrl} onChange={set('linkedinUrl')} placeholder="https://" /></label>
            <label className="lp-field">Sectors of interest<input value={f.sectors} onChange={set('sectors')} /><small>Separate with commas</small></label>
          </div>
          <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button></div>
        </form>
      )}
      <LinkedAccounts />
      <ProfileLinks />
    </div>
  );
}
