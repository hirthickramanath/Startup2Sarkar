import React, { useEffect, useState } from 'react';
import { useApp } from '../../../store';
import { teamApi } from '../../../api';
import { Copy, UserMinus, Mail, X } from 'lucide-react';
import { PageHeader, StatusBadge, useBusy, Modal } from '../../common/ui';
import { cardStyle } from '../../common/Profile';

export function StartupTeam() {
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [made, setMade] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, run] = useBusy();
  const load = () => teamApi.get().then(setData).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);
  const invite = () => run(async () => { try { const r = await teamApi.invite(email.trim()); setMade(r); setEmail(''); load(); } catch (e) { toast.error(e.message); } });
  const copy = (t) => { navigator.clipboard?.writeText(t); toast.success('Link copied'); };
  if (!data) return <div style={{ padding: '2rem' }}>Loading…</div>;
  const owner = data.canManage;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 760 }}>
      <PageHeader title="Your team" subtitle="Teammates can work on proposals, pilots, claims and messages. Only the account owner can change registration and bank details, upload verification documents, manage investor visibility and manage the team." />
      <section style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>People ({data.members.length} of {data.max})</h2>
        {data.members.map((m) => (
          <div key={m.id} className="row-card" style={{ alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}><strong>{m.name}</strong>{m.isYou && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>you</span>}<div style={{ fontSize: '.78rem', color: 'var(--slate-500)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</div></div>
            <StatusBadge status={m.orgRole === 'OWNER' ? 'Owner' : 'Teammate'} size="sm" />
            {owner && m.orgRole === 'MEMBER' && <button className="btn btn-outline btn-sm" aria-label={`Remove ${m.name}`} onClick={() => setRemoving(m)}><UserMinus size={13} /></button>}
          </div>
        ))}
      </section>
      {owner ? (
        <section style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', gap: 8, alignItems: 'center' }}><Mail size={18} /> Invite a teammate</h2>
          <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--slate-600)' }}>They get an email with a link that works for 7 days. They set their own password.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="form-control" style={{ flex: 1, minWidth: 220 }} type="email" aria-label="Teammate email" placeholder="teammate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn btn-primary" disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())} onClick={invite}>{busy ? 'Sending…' : 'Send invitation'}</button>
          </div>
          {made && (
            <div style={{ padding: '.7rem .9rem', borderRadius: 'var(--radius-md)', background: made.emailed ? 'var(--success-bg)' : 'var(--warning-bg)', border: '1px solid var(--slate-200)', fontSize: '.84rem', display: 'grid', gap: 6 }}>
              <span>{made.emailed ? 'Invitation sent. You can also share the link yourself:' : 'The email could not be sent. Share this link with your teammate instead:'}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><code style={{ flex: 1, wordBreak: 'break-all', fontSize: '.74rem' }}>{made.inviteLink}</code><button className="btn btn-outline btn-sm" onClick={() => copy(made.inviteLink)}><Copy size={13} /> Copy</button></div>
            </div>
          )}
          {data.invites.length > 0 && <strong style={{ fontSize: '.88rem' }}>Waiting to join</strong>}
          {data.invites.map((i) => (
            <div key={i.id} className="row-card" style={{ alignItems: 'center' }}>
              <div style={{ flex: 1 }}>{i.email}<div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>expires {String(i.expiresAt).slice(0, 10)}</div></div>
              <button className="btn btn-outline btn-sm" aria-label={`Cancel invitation for ${i.email}`} onClick={() => run(async () => { try { await teamApi.revoke(i.id); load(); } catch (e) { toast.error(e.message); } })}><X size={13} /></button>
            </div>
          ))}
        </section>
      ) : <section style={cardStyle}><p style={{ margin: 0, fontSize: '.88rem' }}>Only the account owner can invite or remove teammates.</p></section>}
      <Modal isOpen={!!removing} onClose={() => setRemoving(null)} title="Remove this teammate?" maxWidth="440px"
        footer={<><button className="btn btn-secondary" onClick={() => setRemoving(null)}>Keep them</button><button className="btn btn-danger" disabled={busy} onClick={() => run(async () => { try { await teamApi.remove(removing.id); setRemoving(null); toast.success('Removed. They are signed out now.'); load(); } catch (e) { toast.error(e.message); } })}>Remove</button></>}>
        <p style={{ fontSize: '.88rem', marginTop: 0 }}>{removing?.name} will be signed out immediately and cannot sign in again. Work they already did stays in the record.</p>
      </Modal>
    </div>
  );
}
