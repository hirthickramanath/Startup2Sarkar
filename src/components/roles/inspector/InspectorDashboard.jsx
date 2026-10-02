import React from 'react';
import { useApp } from '../../../store';
import { MapPin, ClipboardCheck, ListChecks, AlertTriangle, ShieldCheck } from 'lucide-react';
import { StatusBadge, DataTable, PageHeader, EmptyState } from '../../common/ui';

const Stat = ({ icon: Icon, label, value, color }) => (
  <div className="card" style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
    <span style={{ width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', background: `${color}1a` }}><Icon size={20} color={color} /></span>
    <div><div style={{ fontSize: '1.5rem', fontWeight: 800, lineHeight: 1 }}>{value}</div><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{label}</div></div>
  </div>
);

export function InspectorDashboard() {
  const { state, navigate } = useApp();
  const pilots = state.pilots;
  const awaitingKpi = pilots.reduce((a, p) => a + p.kpiResults.filter((k) => k.hasEvidence && k.status === 'Under Review').length, 0);
  const awaitingMs = pilots.reduce((a, p) => a + p.milestones.filter((m) => m.rawStatus === 'SUBMITTED').length, 0);
  const noDocket = pilots.filter((p) => !p.validationReport && !['TERMINATED'].includes(p.rawStatus)).length;
  const openRisks = pilots.reduce((a, p) => a + p.risks.filter((r) => r.status === 'Open').length, 0);

  const columns = [
    { key: 'id', header: 'Pilot', width: '170px', render: (v) => <code>{v}</code> },
    { key: 'name', header: 'Pilot & location', render: (v, r) => (<div><strong>{v}</strong><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}><MapPin size={11} /> {r.location}</div></div>) },
    { key: 'startupName', header: 'Startup' },
    { key: 'kpis', header: 'KPIs to verify', width: '130px', render: (_, r) => { const n = r.kpiResults.filter((k) => k.hasEvidence && k.status === 'Under Review').length; return n ? <span className="badge badge-warning">{n} awaiting</span> : <span className="badge badge-neutral">none</span>; } },
    { key: 'status', header: 'Status', width: '130px', render: (v) => <StatusBadge status={v} size="sm" /> },
    { key: 'open', header: '', width: '110px', render: (_, r) => <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); navigate(`/inspector/pilots/${r.id}`); }}>Open docket</button> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Assigned pilots" subtitle="Pilots a department has assigned to you for field verification." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '1rem' }}>
        <Stat icon={ListChecks} label="KPIs awaiting verification" value={awaitingKpi} color="#7c3aed" />
        <Stat icon={ShieldCheck} label="Milestones to review" value={awaitingMs} color="#2563eb" />
        <Stat icon={ClipboardCheck} label="Pilots with no docket yet" value={noDocket} color="#b45309" />
        <Stat icon={AlertTriangle} label="Open risks" value={openRisks} color="#b91c1c" />
      </div>
      {pilots.length === 0
        ? <EmptyState title="Nothing assigned to you yet">When a government officer assigns you to a pilot, it shows up here.</EmptyState>
        : <div className="card"><DataTable columns={columns} data={pilots} searchPlaceholder="Search pilots…" onRowClick={(r) => navigate(`/inspector/pilots/${r.id}`)} /></div>}
    </div>
  );
}
