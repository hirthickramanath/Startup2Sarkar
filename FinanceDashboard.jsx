import React from 'react';
import { useApp } from '../../../store';
import { Bot, Wallet, Clock, AlertTriangle, PauseCircle } from 'lucide-react';
import { StatusBadge, DataTable, PageHeader, EmptyState, inr, inrPaise } from '../../common/ui';

const Stat = ({ icon: Icon, label, value, sub, color = '#2563eb', onClick }) => (
  <div className="card" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default', display: 'flex', gap: '.75rem', alignItems: 'center' }}>
    <span style={{ width: 42, height: 42, borderRadius: 10, display: 'grid', placeItems: 'center', background: `${color}1a` }}><Icon size={20} color={color} /></span>
    <div><div style={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1.1 }}>{value}</div><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{label}</div>{sub && <div style={{ fontSize: '.7rem', color: 'var(--slate-400)' }}>{sub}</div>}</div>
  </div>
);

const PENDING = ['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_PENDING', 'FINANCE_REVIEW'];

export function FinanceDashboard() {
  const { state, navigate, openAssistant } = useApp();
  const sum = (k) => state.departments.reduce((a, d) => a + d[k], 0);
  const allocated = sum('budgetAllocated'), committed = sum('budgetCommitted'), disbursed = sum('budgetDisbursed');
  const pending = state.payments.filter((p) => PENDING.includes(p.rawStatus));
  const approved = state.payments.filter((p) => p.rawStatus === 'APPROVED');
  const hold = state.payments.filter((p) => p.rawStatus === 'ON_HOLD');
  const openAnoms = state.anomalies.filter((a) => ['DETECTED', 'INVESTIGATING'].includes(a.rawStatus));
  const pendingNet = pending.reduce((a, p) => a + p.netPayablePaise, 0);
  const util = allocated ? Math.round(((committed + disbursed) / allocated) * 100) : 0;

  const columns = [
    { key: 'id', header: 'Claim', width: '160px', render: (v) => <code>{v}</code> },
    { key: 'startupName', header: 'Startup / milestone', render: (v, r) => <div><strong>{v}</strong><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{r.milestoneTitle}</div></div> },
    { key: 'netPayablePaise', header: 'Net payable', width: '130px', render: (v) => <strong>{inrPaise(v)}</strong> },
    { key: 'slaDaysRemaining', header: 'SLA', width: '100px', render: (v) => v == null ? '—' : <span style={{ color: v <= 2 ? 'var(--danger-text)' : undefined }}>{v < 0 ? `${-v}d overdue` : `${v}d left`}</span> },
    { key: 'status', header: 'Status', width: '130px', render: (v) => <StatusBadge status={v} size="sm" /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Treasury dashboard" subtitle="Department budgets and payment claims across the platform."
        actions={<button className="btn btn-outline" onClick={() => openAssistant()}><Bot size={15} /> Ask the assistant</button>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '1rem' }}>
        <Stat icon={Wallet} label="Allocated" value={inr(allocated)} sub={`${inr(allocated - committed - disbursed)} available`} />
        <Stat icon={Wallet} label="Committed (approved, unpaid)" value={inr(committed)} sub={`${util}% of allocation used or committed`} color="#b45309" />
        <Stat icon={Wallet} label="Disbursed" value={inr(disbursed)} color="#15803d" />
        <Stat icon={Clock} label="Claims awaiting review" value={pending.length} sub={pending.length ? `net ${inrPaise(pendingNet)}` : undefined} color="#7c3aed" onClick={() => navigate('/finance/payments')} />
        <Stat icon={PauseCircle} label="Approved, awaiting bank reference" value={approved.length} color="#2563eb" onClick={() => navigate('/finance/payments')} />
        <Stat icon={AlertTriangle} label="Open anomalies" value={openAnoms.length} color="#b91c1c" onClick={() => navigate('/finance/anomalies')} />
      </div>
      {hold.length > 0 && <div className="card" style={{ background: 'var(--warning-bg)', borderColor: 'var(--warning-border)', fontSize: '.84rem' }}>{hold.length} claim(s) are on hold.</div>}
      <div className="card">
        <h3 style={{ fontSize: '1rem', marginTop: 0 }}>Claims needing action</h3>
        {pending.length + approved.length === 0
          ? <EmptyState title="Nothing waiting">New claims from startups appear here for review.</EmptyState>
          : <DataTable columns={columns} data={[...pending, ...approved]} searchable={false} onRowClick={(r) => navigate(`/finance/payments/${r.id}`)} />}
      </div>
    </div>
  );
}
