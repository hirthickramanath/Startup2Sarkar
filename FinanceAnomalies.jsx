import React, { useState } from 'react';
import { useApp } from '../../../store';
import { StatusBadge, DataTable, Modal, PageHeader, EmptyState, useBusy } from '../../common/ui';

export function FinanceAnomalies() {
  const { state, resolveAnomaly, navigate } = useApp();
  const [sel, setSel] = useState(null);
  const [notes, setNotes] = useState('');
  const [busy, run] = useBusy();
  const columns = [
    { key: 'id', header: 'ID', width: '170px', render: (v) => <code style={{ color: 'var(--danger-text)' }}>{v}</code> },
    { key: 'type', header: 'Pattern', render: (v, r) => <div><strong>{String(v).replace(/_/g, ' ')}</strong><div style={{ fontSize: '.76rem', color: 'var(--slate-500)' }}>{r.description}</div></div> },
    { key: 'severity', header: 'Severity', width: '100px', render: (v) => <StatusBadge status={v} size="sm" /> },
    { key: 'status', header: 'Status', width: '120px', render: (v) => <StatusBadge status={v} size="sm" /> },
    { key: 'date', header: 'Detected', width: '110px' },
    { key: 'act', header: '', width: '120px', render: (_, r) => (<button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); setSel(r); setNotes(''); }}>{r.rawStatus === 'RESOLVED' ? 'View' : 'Investigate'}</button>) },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Financial anomalies" subtitle="Duplicate invoices, bank-detail changes and similar red flags. High-severity anomalies block approval until resolved." />
      {state.anomalies.length === 0 ? <EmptyState title="No anomalies">The system flags duplicate invoice numbers and other irregularities automatically.</EmptyState>
        : <div className="card"><DataTable columns={columns} data={state.anomalies} /></div>}
      <Modal isOpen={!!sel} onClose={() => setSel(null)} title={sel ? `Anomaly ${sel.id}` : ''}
        footer={sel?.rawStatus !== 'RESOLVED' && <>
          {sel?.claimId && <button className="btn btn-secondary" onClick={() => navigate(`/finance/payments/${sel.claimId}`)}>Open claim</button>}
          <button className="btn btn-primary" disabled={busy || notes.trim().length < 5} onClick={() => run(async () => { await resolveAnomaly(sel.id, notes.trim()); setSel(null); })}>{busy ? 'Saving…' : 'Mark resolved'}</button></>}>
        {sel && <>
          <p style={{ fontSize: '.88rem' }}>{sel.description}</p>
          <p style={{ fontSize: '.8rem', color: 'var(--slate-500)' }}>{sel.type} • severity {sel.severity} • detected {sel.date}</p>
          {sel.rawStatus === 'RESOLVED' ? <p><strong>Resolution:</strong> {sel.resolutionNotes}</p> : (<>
            <label className="form-label" htmlFor="rn">Resolution notes (min 5 characters)</label>
            <textarea id="rn" className="form-control" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you verify, and why is this safe to proceed?" />
          </>)}
        </>}
      </Modal>
    </div>
  );
}
