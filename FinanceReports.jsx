import React from 'react';
import { useApp } from '../../../store';
import { financeApi } from '../../../api';
import { Download, FileText } from 'lucide-react';
import { StatusBadge, PageHeader, EmptyState } from '../../common/ui';

export function FinanceReports() {
  const { state, toast } = useApp();
  const get = async (url, name) => {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed');
      const href = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement('a'), { href, download: name }).click();
      URL.revokeObjectURL(href);
    } catch (e) { toast.error(e.message); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Case files & exports" subtitle="Audit-ready dossiers generated on the server from live records."
        actions={<>
          <button className="btn btn-outline btn-sm" onClick={() => get(financeApi.claimsCsvUrl(), 'payment-claims.csv')}><Download size={14} /> All claims (CSV)</button>
          <button className="btn btn-outline btn-sm" onClick={() => get(financeApi.budgetCsvUrl(), 'budget-ledger.csv')}><Download size={14} /> Budget ledger (CSV)</button>
        </>} />
      {state.pilots.length === 0 ? <EmptyState title="No pilots yet">A case file is available for every pilot.</EmptyState> : (
        <div className="card" style={{ display: 'grid', gap: '.6rem' }}>
          {state.pilots.map((p) => (
            <div key={p.id} className="row-card">
              <div style={{ flex: 1 }}><FileText size={14} /> <strong>{p.name}</strong> <StatusBadge status={p.status} size="sm" /><div style={{ fontSize: '.76rem', color: 'var(--slate-500)' }}>{p.startupName} • {p.id}</div></div>
              <button className="btn btn-primary btn-sm" onClick={() => get(financeApi.caseFileUrl(p.id, 'pdf'), `case-file-${p.id}.pdf`)}>PDF</button>
              <button className="btn btn-outline btn-sm" onClick={() => get(financeApi.caseFileUrl(p.id, 'csv'), `case-file-${p.id}.csv`)}>CSV</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
