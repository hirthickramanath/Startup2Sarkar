import React from 'react';
import { useApp } from '../../../store';
import { PageHeader, EmptyState, DataTable, inr } from '../../common/ui';

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function FinanceBudget() {
  const { state } = useApp();
  const columns = [
    { key: 'name', header: 'Department', render: (v, r) => <div><strong>{v}</strong><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{r.code} • {r.ministry}</div></div> },
    { key: 'budgetAllocated', header: 'Allocated', width: '140px', render: (v) => <strong>{inr(v)}</strong> },
    { key: 'budgetCommitted', header: 'Committed', width: '140px', render: (v) => inr(v) },
    { key: 'budgetDisbursed', header: 'Disbursed', width: '140px', render: (v) => <span style={{ color: 'var(--success-text)' }}>{inr(v)}</span> },
    { key: 'avail', header: 'Available', width: '140px', render: (_, r) => { const a = r.budgetAllocated - r.budgetCommitted - r.budgetDisbursed; return <strong style={{ color: a < 0 ? 'var(--danger-text)' : undefined }}>{inr(a)}</strong>; } },
    { key: 'util', header: 'Used + committed', width: '160px', render: (_, r) => {
      const p = pct(r.budgetCommitted + r.budgetDisbursed, r.budgetAllocated);
      const color = p >= 100 ? 'var(--danger-text)' : p >= 85 ? '#b45309' : p >= 70 ? '#ca8a04' : 'var(--success-text)';
      return <div><div style={{ fontSize: '.78rem', fontWeight: 700, color }}>{r.budgetAllocated ? `${p}%` : 'no allocation'}</div><div style={{ height: 5, background: 'var(--slate-200)', borderRadius: 3 }}><div style={{ height: '100%', width: `${Math.min(100, p)}%`, background: color, borderRadius: 3 }} /></div></div>;
    } },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Department budgets" subtitle="Committed = approved claims awaiting transfer. The server blocks approvals that would exceed the allocation. Allocations are set by the Super Admin." />
      {state.departments.length === 0 ? <EmptyState title="No departments yet">The Super Admin creates departments and their budgets.</EmptyState>
        : <div className="card"><DataTable columns={columns} data={state.departments} searchable={false} /></div>}
    </div>
  );
}
