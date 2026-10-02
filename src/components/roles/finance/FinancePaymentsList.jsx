import React, { useState } from 'react';
import { useApp } from '../../../store';
import { StatusBadge, DataTable, PageHeader, EmptyState, inrPaise } from '../../common/ui';

const FILTERS = [['ALL', 'All'], ['PENDING', 'Needs review'], ['APPROVED', 'Approved'], ['CHEQUE_ISSUED', 'Cheques out'], ['ON_HOLD', 'On hold'], ['PAID', 'Paid'], ['REJECTED', 'Rejected']];
const PENDING = ['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_PENDING', 'FINANCE_REVIEW', 'AWAITING_SECOND_APPROVAL'];

export function FinancePaymentsList() {
  const { state, navigate } = useApp();
  const [f, setF] = useState('ALL');
  const rows = state.payments.filter((p) => f === 'ALL' || (f === 'PENDING' ? PENDING.includes(p.rawStatus) : p.rawStatus === f));
  const columns = [
    { key: 'id', header: 'Claim', width: '160px', render: (v) => <code>{v}</code> },
    { key: 'startupName', header: 'Startup', render: (v, r) => <div><strong>{v}</strong><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{r.milestoneTitle} • {r.invoiceNumber}</div></div> },
    { key: 'grossAmountPaise', header: 'Gross', width: '120px', render: (v) => inrPaise(v) },
    { key: 'ded', header: 'TDS + GST-TDS', width: '140px', render: (_, r) => <span style={{ color: 'var(--danger-text)' }}>− {inrPaise(r.tdsPaise + r.gstTdsPaise)}</span> },
    { key: 'netPayablePaise', header: 'Net payable', width: '130px', render: (v) => <strong>{inrPaise(v)}</strong> },
    { key: 'slaDaysRemaining', header: 'SLA', width: '100px', render: (v) => v == null ? '—' : <span style={{ color: v <= 2 ? 'var(--danger-text)' : undefined }}>{v < 0 ? `${-v}d overdue` : `${v}d left`}</span> },
    { key: 'status', header: 'Status', width: '130px', render: (v) => <StatusBadge status={v} size="sm" /> },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Payment claims" subtitle="Maker-checker applies. Large payments need two different approvers, and a third person records the payment." />
      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
        {FILTERS.map(([k, l]) => <button key={k} className={`btn btn-sm ${f === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => setF(k)}>{l}</button>)}
      </div>
      {rows.length === 0 ? <EmptyState title="No claims here">Claims raised by startups appear in this list.</EmptyState>
        : <div className="card"><DataTable columns={columns} data={rows} onRowClick={(r) => navigate(`/finance/payments/${r.id}`)} /></div>}
    </div>
  );
}
