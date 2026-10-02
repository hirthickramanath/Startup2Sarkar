import React from 'react';
import { useApp } from '../../../store';
import { StatusBadge, DataTable, PageHeader, EmptyState, inrPaise } from '../../common/ui';

export function FinanceStalledPilots() {
  const { state, navigate } = useApp();
  const rows = state.stalledPilots;
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const columns = [
    { key: 'pilotName', header: 'Pilot', render: (v, r) => <div><strong>{v}</strong><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{r.startup}</div></div> },
    { key: 'reason', header: 'Why flagged' },
    { key: 'daysStalled', header: 'Days', width: '80px' },
    { key: 'amountPaidPaise', header: 'Paid', width: '120px', render: inrPaise },
    { key: 'amountRecoverablePaise', header: 'Recoverable', width: '130px', render: inrPaise },
    { key: 'amountRecoveredPaise', header: 'Recovered', width: '120px', render: inrPaise },
    { key: 'recoveryStatus', header: 'Status', width: '150px', render: (v) => <StatusBadge status={v} size="sm" /> },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Stalled pilots & recovery" subtitle="The background sentinel flags pilots with overdue milestones and tracks the financial exposure." />
      {rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '1rem' }}>
          {[['Paid out', 'amountPaidPaise'], ['Recoverable', 'amountRecoverablePaise'], ['Recovered', 'amountRecoveredPaise']].map(([l, k]) => (
            <div key={k} className="card"><div style={{ fontSize: '.72rem', color: 'var(--slate-500)', textTransform: 'uppercase' }}>{l}</div><div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{inrPaise(sum(k))}</div></div>
          ))}
        </div>
      )}
      {rows.length === 0 ? <EmptyState title="No stalled pilots">Pilots that miss milestone dates are flagged here automatically.</EmptyState>
        : <div className="card"><DataTable columns={columns} data={rows} onRowClick={(r) => navigate(`/government/pilots/${r.pilotId}`)} /></div>}
    </div>
  );
}
