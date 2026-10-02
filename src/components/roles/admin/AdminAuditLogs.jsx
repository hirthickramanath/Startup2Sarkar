import React, { useEffect, useState } from 'react';
import { adminApi } from '../../../api';
import { ShieldCheck, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader } from '../../common/ui';

export function AdminAuditLogs() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState(null);
  useEffect(() => { adminApi.auditLogs({ page: String(page), limit: '25' }).then(setData).catch((e) => setErr(e.message)); }, [page]);

  const ok = data?.integrity?.valid;
  const pages = data ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.limit)) : 1;
  const rows = (data?.logs || []).filter((l) => !q || JSON.stringify(l).toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Audit logs" subtitle="Append-only. Each entry's hash includes the previous entry's hash, so any alteration breaks the chain." />
      {err && <div className="card" style={{ color: 'var(--danger-text)' }}>{err}</div>}
      {data && (
        <div className="card" style={{ display: 'flex', gap: '.7rem', alignItems: 'center', background: ok ? 'var(--success-bg)' : 'var(--danger-bg)', borderColor: ok ? 'var(--success-border)' : 'var(--danger-border)' }}>
          {ok ? <ShieldCheck color="var(--success-text)" /> : <ShieldAlert color="var(--danger-text)" />}
          <span style={{ fontSize: '.86rem' }}>{ok ? `Chain verified: ${data.integrity.totalEntries} entries, no tampering detected.` : `CHAIN BROKEN at entry ${data.integrity.brokenAtId}. Investigate immediately.`}</span>
        </div>
      )}
      <input className="form-control" style={{ maxWidth: 360 }} placeholder="Filter this page…" aria-label="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card table-container">
        <table className="data-table">
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td style={{ whiteSpace: 'nowrap', fontSize: '.76rem' }}>{String(l.timestamp).slice(0, 19).replace('T', ' ')}</td>
                <td>{l.actor_name}<div style={{ fontSize: '.7rem', color: 'var(--slate-500)' }}>{l.actor_role}</div></td>
                <td><code style={{ fontSize: '.74rem' }}>{l.action}</code></td>
                <td style={{ fontSize: '.76rem' }}>{l.entity_type}<div style={{ color: 'var(--slate-500)' }}>{l.entity_id}</div></td>
                <td style={{ fontSize: '.72rem', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={typeof l.details === 'string' ? l.details : JSON.stringify(l.details)}>{typeof l.details === 'string' ? l.details : JSON.stringify(l.details)}</td>
                <td style={{ fontSize: '.72rem' }}>{l.ip_address}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--slate-500)' }}>No entries.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', justifyContent: 'flex-end' }}>
        <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
        <span style={{ fontSize: '.8rem' }}>Page {page} of {pages}</span>
        <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
      </div>
    </div>
  );
}
