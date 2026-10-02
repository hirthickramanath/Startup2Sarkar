import React from 'react';
import { useApp } from '../../../store';
import { StatusBadge, DataTable, PageHeader, EmptyState } from '../../common/ui';

export function InspectorRisks() {
  const { state, navigate } = useApp();
  const rows = state.pilots.flatMap((p) => p.risks.map((r) => ({ ...r, pilotId: p.id, pilotName: p.name, startupName: p.startupName })));
  const columns = [
    { key: 'category', header: 'Category', width: '140px' },
    { key: 'description', header: 'Risk', render: (v, r) => (<div><strong>{v}</strong><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{r.pilotName} • {r.startupName}</div></div>) },
    { key: 'severity', header: 'Severity', width: '100px', render: (v) => <StatusBadge status={v} size="sm" /> },
    { key: 'status', header: 'Status', width: '110px', render: (v) => <StatusBadge status={v} size="sm" /> },
    { key: 'mitigation', header: 'Mitigation' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Risk register" subtitle="Risks you have registered across your assigned pilots. Add new ones from a pilot's docket." />
      {rows.length === 0 ? <EmptyState title="No risks registered">Open a pilot docket and use “Register risk”.</EmptyState>
        : <div className="card"><DataTable columns={columns} data={rows} onRowClick={(r) => navigate(`/inspector/pilots/${r.pilotId}`)} /></div>}
    </div>
  );
}
