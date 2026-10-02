import React, { useEffect, useState } from 'react';
import { useApp } from '../../store';
import { managementApi } from '../../api';
import { CalendarPlus, Megaphone, StopCircle, Undo2 } from 'lucide-react';
import { Modal, useBusy } from './ui';
import { cardStyle } from './Profile';

const input = { width: '100%' };

/** Extend or terminate a pilot (government of the owning department). */
export function PilotActions({ pilot }) {
  const { act } = useApp();
  const [dlg, setDlg] = useState(null); // 'extend' | 'terminate'
  const [months, setMonths] = useState(1);
  const [reason, setReason] = useState('');
  const [busy, run] = useBusy();
  if (!['LAUNCHED', 'IN_PROGRESS', 'UNDER_INSPECTION', 'STALLED'].includes(pilot.rawStatus)) return null;
  const close = () => { setDlg(null); setReason(''); setMonths(1); };
  const submit = () => run(async () => {
    try {
      if (dlg === 'extend') await act(() => managementApi.extendPilot(pilot.id, Number(months), reason.trim()), 'Pilot extended. The startup was notified.');
      else await act(() => managementApi.terminatePilot(pilot.id, reason.trim()), 'Pilot terminated. The startup was notified.');
      close();
    } catch { /* the store already showed the server's message */ }
  });
  return (
    <section style={cardStyle}>
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Manage this pilot</h2>
      <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--slate-600)' }}>Extending adds months to the pilot. Terminating ends it and needs a written reason; it is blocked while money is committed on a claim.</p>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <button className="btn btn-outline" onClick={() => setDlg('extend')}><CalendarPlus size={15} /> Extend pilot</button>
        <button className="btn btn-danger" onClick={() => setDlg('terminate')}><StopCircle size={15} /> Terminate pilot</button>
      </div>
      <Modal isOpen={!!dlg} onClose={close} title={dlg === 'extend' ? 'Extend pilot' : 'Terminate pilot'} maxWidth="480px"
        footer={<><button className="btn btn-secondary" onClick={close}>Cancel</button><button className={`btn ${dlg === 'extend' ? 'btn-primary' : 'btn-danger'}`} disabled={busy || reason.trim().length < 10} onClick={submit}>{busy ? 'Saving…' : 'Confirm'}</button></>}>
        {dlg === 'extend' && <div className="form-group"><label className="form-label" htmlFor="pm">Extra months (1-12)</label><input id="pm" type="number" min="1" max="12" className="form-control" style={input} value={months} onChange={(e) => setMonths(e.target.value)} /></div>}
        <div className="form-group"><label className="form-label" htmlFor="pr">Reason (min 10 characters, the startup sees it)</label><textarea id="pr" className="form-control" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </Modal>
    </section>
  );
}

/** Extend a challenge's deadline and post addenda (government). */
export function ChallengeActions({ challenge }) {
  const { act } = useApp();
  const [dlg, setDlg] = useState(null);
  const [f, setF] = useState({ deadline: '', reason: '', title: '', body: '' });
  const [busy, run] = useBusy();
  if (!['PUBLISHED', 'PROPOSALS_RECEIVED', 'AI_EVALUATION', 'SHORTLISTED'].includes(challenge.rawStatus || challenge.status)) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const close = () => { setDlg(null); setF({ deadline: '', reason: '', title: '', body: '' }); };
  const submit = () => run(async () => {
    try {
      if (dlg === 'deadline') await act(() => managementApi.extendDeadline(challenge.id, new Date(`${f.deadline}T23:59:00`).toISOString(), f.reason.trim()), 'Deadline extended and announced to bidders');
      else await act(() => managementApi.addAddendum(challenge.id, f.title.trim(), f.body.trim()), 'Addendum posted for all bidders');
      close();
    } catch { /* shown */ }
  });
  const ok = dlg === 'deadline' ? f.deadline && f.reason.trim().length >= 10 : f.title.trim().length >= 3 && f.body.trim().length >= 10;
  return (
    <section style={cardStyle}>
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Keep bidders informed</h2>
      <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--slate-600)' }}>Changes are announced as addenda that every bidder can read.</p>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <button className="btn btn-outline" onClick={() => setDlg('deadline')}><CalendarPlus size={15} /> Extend deadline</button>
        <button className="btn btn-outline" onClick={() => setDlg('addendum')}><Megaphone size={15} /> Post an addendum</button>
      </div>
      <AddendaList challengeId={challenge.id} refreshKey={busy} />
      <Modal isOpen={!!dlg} onClose={close} title={dlg === 'deadline' ? 'Extend deadline' : 'Post an addendum'} maxWidth="500px"
        footer={<><button className="btn btn-secondary" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={busy || !ok} onClick={submit}>{busy ? 'Saving…' : 'Publish'}</button></>}>
        {dlg === 'deadline' ? (<>
          <div className="form-group"><label className="form-label" htmlFor="nd">New deadline</label><input id="nd" type="date" className="form-control" style={input} min={new Date().toISOString().slice(0, 10)} value={f.deadline} onChange={set('deadline')} /></div>
          <div className="form-group"><label className="form-label" htmlFor="nr">Reason (min 10 characters)</label><textarea id="nr" className="form-control" rows={3} value={f.reason} onChange={set('reason')} /></div>
        </>) : (<>
          <div className="form-group"><label className="form-label" htmlFor="at">Title</label><input id="at" className="form-control" style={input} value={f.title} onChange={set('title')} maxLength={120} /></div>
          <div className="form-group"><label className="form-label" htmlFor="ab">Message (min 10 characters)</label><textarea id="ab" className="form-control" rows={4} value={f.body} onChange={set('body')} maxLength={2000} /></div>
        </>)}
      </Modal>
    </section>
  );
}

/** Official clarifications for a challenge, newest first. */
export function AddendaList({ challengeId, refreshKey }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { managementApi.addenda(challengeId).then((r) => setRows(r.addenda)).catch(() => setRows([])); }, [challengeId, refreshKey]);
  if (!rows || rows.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <strong style={{ fontSize: '.88rem' }}>Addenda</strong>
      {rows.map((a) => (
        <div key={a.id} style={{ padding: '.6rem .8rem', borderRadius: 'var(--radius-md)', background: 'var(--info-bg)', border: '1px solid var(--info-border)', color: 'var(--info-text)', fontSize: '.84rem' }}>
          <div style={{ fontWeight: 700 }}>{a.title} <span style={{ fontWeight: 400, opacity: .8 }}>· {String(a.created_at).slice(0, 10)}</span></div>
          <div style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{a.body}</div>
        </div>
      ))}
    </div>
  );
}

/** A startup withdraws one of its own open proposals. */
export function WithdrawProposal() {
  const { state, act, currentUser } = useApp();
  const [target, setTarget] = useState(null);
  const [busy, run] = useBusy();
  const open = state.proposals.filter((p) => ['SUBMITTED', 'UNDER_REVIEW', 'AI_EVALUATED', 'SHORTLISTED', 'NOT_SHORTLISTED'].includes(p.rawStatus));
  if (open.length === 0) return null;
  return (
    <section style={cardStyle}>
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Withdraw a proposal</h2>
      <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--slate-600)' }}>You can withdraw a proposal until it is selected. This cannot be undone; you would need to submit a new one.</p>
      {open.map((p) => (
        <div key={p.id} className="row-card" style={{ alignItems: 'center' }}>
          <div style={{ flex: 1 }}><strong>{p.solutionTitle}</strong><div style={{ fontSize: '.76rem', color: 'var(--slate-500)' }}>{p.id}</div></div>
          <button className="btn btn-outline btn-sm" onClick={() => setTarget(p)}><Undo2 size={13} /> Withdraw</button>
        </div>
      ))}
      <Modal isOpen={!!target} onClose={() => setTarget(null)} title="Withdraw this proposal?" maxWidth="440px"
        footer={<><button className="btn btn-secondary" onClick={() => setTarget(null)}>Keep it</button><button className="btn btn-danger" disabled={busy} onClick={() => run(async () => { try { await act(() => managementApi.withdrawProposal(target.id), 'Proposal withdrawn'); setTarget(null); } catch { /* shown */ } })}>{busy ? 'Withdrawing…' : 'Withdraw'}</button></>}>
        <p style={{ fontSize: '.86rem', marginTop: 0 }}>“{target?.solutionTitle}” will no longer be considered.</p>
      </Modal>
    </section>
  );
}
