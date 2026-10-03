import React, { useEffect, useState } from 'react';
import { useApp } from '../../../store';
import { adminApi, platformApi } from '../../../api';
import { AlertTriangle, CheckCircle2, Download, ShieldCheck } from 'lucide-react';
import { PageHeader, EmptyState, StatusBadge, Modal, useBusy } from '../../common/ui';

/** Verifying a startup: documents, a checklist of what was checked, and warnings about shared details. */
export function AdminStartups() {
  const { state, act, toast, fetchLiveData } = useApp();
  const [filter, setFilter] = useState('PENDING');
  const [open, setOpen] = useState(null);
  const [data, setData] = useState(null);
  const [note, setNote] = useState('');
  const [busy, run] = useBusy();
  const rows = state.startups.filter((s) => filter === 'ALL' || s.verificationStatus === filter);
  const load = (id) => platformApi.startupReview(id).then(setData).catch((e) => toast.error(e.message));
  useEffect(() => { if (open) { setData(null); setNote(''); load(open.id); } }, [open]);
  const setCheck = (key, done) => run(async () => { try { await platformApi.setCheck(open.id, key, done); await load(open.id); } catch (e) { toast.error(e.message); } });
  const review = (id, status, notes) => run(async () => { try { await platformApi.reviewDocument(id, status, notes); await load(open.id); } catch (e) { toast.error(e.message); } });
  const decide = (status) => run(async () => { try { await act(() => adminApi.verifyStartup(open.id, status, note.trim()), status === 'VERIFIED' ? 'Startup verified' : 'Startup not verified'); setOpen(null); await fetchLiveData(); } catch { /* shown */ } });
  const incomplete = data ? data.checklist.filter((c) => !c.done).length : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Startup verification" subtitle="Check the documents and registration details, tick off what you verified, then decide." />
      <div style={{ display: 'flex', gap: 6 }}>{[['PENDING', 'Waiting'], ['VERIFIED', 'Verified'], ['REJECTED', 'Not verified'], ['ALL', 'All']].map(([k, l]) => <button key={k} className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
      {rows.length === 0 ? <EmptyState title="Nothing here">Startups appear here when they register.</EmptyState> : rows.map((s) => (
        <div key={s.id} className="card" style={{ display: 'flex', gap: '1rem', justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
          <div><strong>{s.name}</strong> <StatusBadge status={s.verificationStatus === 'VERIFIED' ? 'Verified' : s.verificationStatus === 'REJECTED' ? 'Rejected' : 'Pending'} size="sm" /><div style={{ fontSize: '.78rem', color: 'var(--slate-500)' }}>{s.founders} · {s.sector}</div></div>
          <button className="btn btn-primary btn-sm" onClick={() => setOpen(s)}><ShieldCheck size={14} /> Review</button>
        </div>
      ))}

      <Modal isOpen={!!open} onClose={() => setOpen(null)} title={open ? `Review: ${open.name}` : ''} maxWidth="720px"
        footer={<><button className="btn btn-secondary" onClick={() => setOpen(null)}>Close</button>
          <button className="btn btn-danger" disabled={busy || note.trim().length < 5} onClick={() => decide('REJECTED')}>Do not verify</button>
          <button className="btn btn-success" disabled={busy || note.trim().length < 5} onClick={() => decide('VERIFIED')}>Verify startup</button></>}>
        {!data ? 'Loading…' : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {data.flags.length > 0 && (
              <div style={{ padding: '.7rem .9rem', borderRadius: 'var(--radius-md)', background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger-text)', fontSize: '.85rem' }}>
                <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={15} /> Look closely before verifying</strong>
                {data.flags.map((f, i) => <div key={i}>• {f.message}</div>)}
              </div>
            )}
            {data.missingDetails.length > 0 && <div style={{ fontSize: '.84rem', color: 'var(--warning-text)' }}>Not yet provided: {data.missingDetails.join(', ')}.</div>}
            <div>
              <strong style={{ fontSize: '.9rem' }}>Documents</strong>
              {data.documents.length === 0 && <div style={{ fontSize: '.84rem', color: 'var(--slate-500)' }}>None uploaded yet.</div>}
              {data.documents.map((d) => (
                <div key={d.id} className="row-card" style={{ alignItems: 'center', marginTop: 6 }}>
                  <div style={{ flex: 1 }}><strong style={{ fontSize: '.86rem' }}>{d.doc_type.replace(/_/g, ' ').toLowerCase()}</strong><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{d.filename}.pdf · {(Number(d.size_bytes) / 1024).toFixed(0)} KB · {d.status.toLowerCase()}</div></div>
                  <a className="btn btn-outline btn-sm" href={platformApi.documentUrl(d.id)}><Download size={13} /> Open</a>
                  <button className="btn btn-outline btn-sm" disabled={busy || d.status === 'ACCEPTED'} onClick={() => review(d.id, 'ACCEPTED')}>Accept</button>
                  <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => { const r = window.prompt('Why is this document not acceptable? (min 5 characters)'); if (r && r.trim().length >= 5) review(d.id, 'REJECTED', r.trim()); }}>Reject</button>
                </div>
              ))}
            </div>
            <div>
              <strong style={{ fontSize: '.9rem' }}>What I have checked</strong>
              {data.checklist.map((c) => (
                <label key={c.key} className="lp-check" style={{ marginTop: 6 }}>
                  <input type="checkbox" checked={c.done} disabled={busy} onChange={(e) => setCheck(c.key, e.target.checked)} />
                  <span>{c.label}{c.done && c.at && <small style={{ color: 'var(--slate-500)' }}> · {String(c.at).slice(0, 10)}</small>}</span>
                </label>
              ))}
              {incomplete > 0 && <div style={{ fontSize: '.78rem', color: 'var(--warning-text)', marginTop: 6 }}>{incomplete} item{incomplete > 1 ? 's' : ''} not ticked yet. You can still decide, but the audit trail records what was checked.</div>}
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="vn">Decision notes (min 5 characters, kept in the audit trail)</label>
              <textarea id="vn" className="form-control" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
