import React, { useState, useEffect } from 'react';
import { useApp } from '../../../store';
import { pilotsApi } from '../../../api';
import { ArrowLeft, Send, Printer, MapPin, UserCheck, Download } from 'lucide-react';
import { StatusBadge, ConfirmationDialog, EmptyState, PageHeader, inr, inrPaise } from '../../common/ui';

export function GovernmentPilotDetail({ pilotId }) {
  const { state, forwardPilotToFinance, assignInspector, navigate, toast } = useApp();
  const pilot = state.pilots.find((p) => p.id === pilotId);
  const [tab, setTab] = useState('kpis');
  const [confirm, setConfirm] = useState(false);
  const [inspectors, setInspectors] = useState([]);
  const [pick, setPick] = useState('');

  useEffect(() => { pilotsApi.inspectors().then((r) => setInspectors(r.inspectors || [])).catch(() => {}); }, []);

  if (!pilot) return <EmptyState title="Pilot not found">It may belong to another department.</EmptyState>;

  const verifiedAll = pilot.kpiResults.length > 0 && pilot.kpiResults.every((k) => k.verifiedByInspector);
  const insp = pilot.validationReport;
  const checks = [
    ['An inspector is assigned', !!pilot.assignedInspectorId],
    ['A field inspection docket is filed with a Verified / Partially verified verdict', ['VERIFIED', 'PARTIALLY_VERIFIED'].includes(insp?.rawStatus)],
    ['All KPIs are verified by the inspector', verifiedAll],
    ['Contract value is recorded', pilot.totalBudget > 0],
  ];
  // The server enforces the docket rule; the other checks are advisory guidance for the officer
  const canForward = checks[1][1] && pilot.rawStatus !== 'FINANCE_PENDING';

  const download = async (fmt) => {
    try {
      const res = await fetch(pilotsApi.reportUrl(pilot.id, fmt), { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed');
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: `pilot-report-${pilot.id}.${fmt}` });
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/government/pilots')}><ArrowLeft size={14} /> Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><code>{pilot.id}</code><StatusBadge status={pilot.status} /></div>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 800, margin: '2px 0 0' }}>{pilot.name}</h1>
          <div style={{ fontSize: '.8rem', color: 'var(--slate-500)' }}><MapPin size={12} /> {pilot.location} • {pilot.startupName} • contract {inr(pilot.totalBudget)} • paid (net) {inrPaise(pilot.fundsDisbursedPaise)}</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => download('pdf')}><Download size={14} /> Report (PDF)</button>
        <button className="btn btn-outline btn-sm" onClick={() => download('csv')}><Printer size={14} /> CSV</button>
        <button className="btn btn-primary" disabled={!canForward} onClick={() => setConfirm(true)}><Send size={15} /> Forward to Finance</button>
      </div>

      <div className="card" style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <UserCheck size={18} color="var(--gov-navy-600)" />
        <div style={{ flex: 1, minWidth: 220 }}>
          <strong>Field inspector:</strong> {pilot.assignedInspectorName || <span style={{ color: 'var(--warning-text)' }}>not assigned yet</span>}
        </div>
        <select className="form-control" aria-label="Choose inspector" style={{ maxWidth: 260 }} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{pilot.assignedInspectorId ? 'Reassign to…' : 'Assign inspector…'}</option>
          {inspectors.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.active_pilots} active)</option>)}
        </select>
        <button className="btn btn-primary btn-sm" disabled={!pick} onClick={async () => { await assignInspector(pilot.id, pick).catch(() => {}); setPick(''); }}>Assign</button>
        {inspectors.length === 0 && <span style={{ fontSize: '.76rem', color: 'var(--slate-500)', flexBasis: '100%' }}>No active inspectors exist yet — ask the platform administrator to create one.</span>}
      </div>

      <div className="card">
        <h3 style={{ fontSize: '.95rem', marginTop: 0 }}>Readiness for Finance</h3>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '.35rem', fontSize: '.84rem' }}>
          {checks.map(([label, ok]) => <li key={label} style={{ color: ok ? 'var(--success-text)' : 'var(--slate-500)' }}>{ok ? '✓' : '○'} {label}</li>)}
        </ul>
      </div>

      <div role="tablist" style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--slate-200)' }}>
        {[['kpis', 'KPI results'], ['milestones', 'Milestones'], ['inspection', 'Inspection'], ['risks', 'Risks']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab-btn ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'kpis' && (
        <div className="card table-container"><table className="data-table">
          <thead><tr><th>KPI</th><th>Baseline</th><th>Target</th><th>Reported</th><th>Version</th><th>Verification</th></tr></thead>
          <tbody>{pilot.kpiResults.map((k) => (<tr key={k.id}><td><strong>{k.metric}</strong></td><td>{k.baseline}</td><td>{k.target}</td><td>{k.hasEvidence ? k.current : '—'}</td><td><code>{k.version}</code></td><td><StatusBadge status={k.status} size="sm" /></td></tr>))}
            {pilot.kpiResults.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--slate-500)' }}>No KPIs defined for this pilot.</td></tr>}</tbody>
        </table></div>
      )}
      {tab === 'milestones' && (
        <div className="card" style={{ display: 'grid', gap: '.6rem' }}>
          {pilot.milestones.map((m) => (<div key={m.id} className="row-card"><div style={{ flex: 1 }}><strong>{m.name}</strong> <StatusBadge status={m.status} size="sm" /><div style={{ fontSize: '.8rem', color: 'var(--slate-600)' }}>{m.deliverable}</div><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>Due {m.dueDate}</div></div><strong>{inr(m.amount)}</strong></div>))}
        </div>
      )}
      {tab === 'inspection' && (insp ? (
        <div className="card"><StatusBadge status={insp.status} /> <span style={{ fontSize: '.8rem', color: 'var(--slate-500)' }}>{insp.date} • {insp.inspectorName}</span><p style={{ fontSize: '.88rem' }}>{insp.summary}</p>
          <ul style={{ listStyle: 'none', padding: 0, fontSize: '.84rem', display: 'grid', gap: '.25rem' }}>{Object.entries(insp.checklistResults || {}).map(([k, v]) => <li key={k}>{v === 'PASS' ? '✓' : v === 'FAIL' ? '✗' : '•'} {k} — {String(v).toLowerCase().replace('_', ' ')}</li>)}</ul></div>
      ) : <EmptyState title="No inspection filed yet">The assigned inspector files the docket after a site visit.</EmptyState>)}
      {tab === 'risks' && (
        <div className="card" style={{ display: 'grid', gap: '.5rem' }}>
          {pilot.risks.map((r) => (<div key={r.id} className="row-card"><div><strong>{r.category}</strong> • {r.severity} <StatusBadge status={r.status} size="sm" /><div style={{ fontSize: '.82rem' }}>{r.description}</div></div></div>))}
          {pilot.risks.length === 0 && <span style={{ color: 'var(--slate-500)', fontSize: '.85rem' }}>No risks registered.</span>}
        </div>
      )}

      <ConfirmationDialog
        isOpen={confirm} onClose={() => setConfirm(false)} onConfirm={() => forwardPilotToFinance(pilot.id)}
        title="Forward to Finance?" confirmLabel="Forward dossier" requireRemarks={false}
        message={`The inspection docket and pilot dossier for “${pilot.name}” will be sent to the Finance Division. This is recorded in the audit trail under your name.`}
      />
    </div>
  );
}
