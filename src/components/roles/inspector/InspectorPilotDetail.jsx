import React, { useState } from 'react';
import { useApp } from '../../../store';
import { pilotsApi } from '../../../api';
import { ArrowLeft, MapPin, CheckCircle2, ClipboardCheck, ShieldAlert } from 'lucide-react';
import { StatusBadge, Modal, EmptyState, useBusy, inr } from '../../common/ui';

// The standard five-point docket (spec §37). Items are fixed; the verdict on each is the inspector's.
const CHECKLIST = [
  ['deployment', 'Solution is physically deployed at the stated sites'],
  ['systems', 'Systems operate and report live data'],
  ['training', 'End users have been trained'],
  ['security', 'Security and data-protection controls are in place'],
  ['kpis', 'Reported KPI values match what was observed'],
];
const VERDICTS = ['Verified', 'Partially Verified', 'Requires Further Evidence', 'Not Verified'];
const RISK_CATS = ['TECHNICAL', 'OPERATIONAL', 'FINANCIAL', 'CYBERSECURITY', 'DATA', 'SCALABILITY'];

export function InspectorPilotDetail({ pilotId }) {
  const { state, navigate, verifyKpiEvidence, verifyMilestone, submitInspectionReport, act } = useApp();
  const pilot = state.pilots.find((p) => p.id === pilotId);
  const [tab, setTab] = useState('kpis');
  const [dlg, setDlg] = useState(null);
  const [f, setF] = useState({});
  const [busy, run] = useBusy();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const close = () => { setDlg(null); setF({}); };

  if (!pilot) return <EmptyState title="Pilot not found">It may not be assigned to you.</EmptyState>;
  const final = ['VALIDATED', 'FINANCE_PENDING'].includes(pilot.rawStatus);

  const openInspection = () => {
    setF({ ...Object.fromEntries(CHECKLIST.map(([k]) => [k, 'PASS'])), verdict: 'Verified', findings: '', address: '' });
    setDlg({ type: 'inspection' });
  };

  const confirm = () => run(async () => {
    if (dlg.type === 'kpi') await verifyKpiEvidence(pilot.id, dlg.item.id, f.verdict, f.notes);
    if (dlg.type === 'milestone') await verifyMilestone(pilot.id, dlg.item.id, f.decision, f.notes);
    if (dlg.type === 'inspection') {
      const checklist = Object.fromEntries(CHECKLIST.map(([k]) => [k, f[k]]));
      await submitInspectionReport(pilot.id, checklist, f.verdict, f.findings, f.address ? { gpsAddress: f.address } : {});
    }
    if (dlg.type === 'risk') await act(() => pilotsApi.addRisk(pilot.id, { category: f.category || 'OPERATIONAL', severity: f.severity || 'MEDIUM', description: f.description || '', mitigation: f.mitigation || undefined, owner: f.owner || undefined }), 'Risk registered');
    close();
  });

  const setRiskStatus = (r, status) => act(() => pilotsApi.updateRisk(pilot.id, r.id, { status }), 'Risk updated');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/inspector/pilots')}><ArrowLeft size={14} /> Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><code>{pilot.id}</code><StatusBadge status={pilot.status} /></div>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 800, margin: '2px 0 0' }}>{pilot.name}</h1>
          <div style={{ fontSize: '.8rem', color: 'var(--slate-500)' }}><MapPin size={12} /> {pilot.location} • {pilot.startupName} • contract {inr(pilot.totalBudget)}</div>
        </div>
        {!final && <button className="btn btn-primary" onClick={openInspection}><ClipboardCheck size={15} /> File inspection docket</button>}
      </div>

      <div role="tablist" style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--slate-200)' }}>
        {[['kpis', 'KPI verification'], ['milestones', 'Milestones'], ['risks', 'Risk register'], ['history', 'Inspection history']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab-btn ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'kpis' && (
        <div className="card table-container">
          <table className="data-table">
            <thead><tr><th>KPI</th><th>Baseline</th><th>Target</th><th>Reported</th><th>Version</th><th>Status</th><th /></tr></thead>
            <tbody>
              {pilot.kpiResults.map((k) => (
                <tr key={k.id}>
                  <td><strong>{k.metric}</strong><div style={{ fontSize: '.72rem', color: 'var(--slate-500)' }}>{k.measurementMethod}</div></td>
                  <td>{k.baseline}</td><td>{k.target}</td><td>{k.hasEvidence ? k.current : '—'}</td><td><code>{k.version}</code></td>
                  <td><StatusBadge status={k.status} size="sm" /></td>
                  <td>{k.hasEvidence && !final && <button className="btn btn-outline btn-sm" onClick={() => { setF({ verdict: 'Verified', notes: '' }); setDlg({ type: 'kpi', item: k }); }}>Verify</button>}</td>
                </tr>
              ))}
              {pilot.kpiResults.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--slate-500)' }}>No KPIs defined.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'milestones' && (
        <div className="card" style={{ display: 'grid', gap: '.75rem' }}>
          {pilot.milestones.map((m) => (
            <div key={m.id} className="row-card">
              <div style={{ flex: 1 }}><strong>{m.name}</strong> <StatusBadge status={m.status} size="sm" /><div style={{ fontSize: '.8rem', color: 'var(--slate-600)' }}>{m.deliverable}</div><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>Due {m.dueDate} • {inr(m.amount)}</div></div>
              {m.rawStatus === 'SUBMITTED' && <button className="btn btn-primary btn-sm" onClick={() => { setF({ decision: 'VERIFIED', notes: '' }); setDlg({ type: 'milestone', item: m }); }}>Review deliverable</button>}
            </div>
          ))}
        </div>
      )}

      {tab === 'risks' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.75rem' }}>
            <span style={{ fontSize: '.82rem', color: 'var(--slate-500)' }}>{pilot.risks.length} registered</span>
            <button className="btn btn-outline btn-sm" onClick={() => { setF({ category: 'OPERATIONAL', severity: 'MEDIUM' }); setDlg({ type: 'risk' }); }}><ShieldAlert size={13} /> Register risk</button>
          </div>
          {pilot.risks.map((r) => (
            <div key={r.id} className="row-card" style={{ marginBottom: '.5rem' }}>
              <div style={{ flex: 1 }}><strong>{r.category}</strong> • {r.severity} <StatusBadge status={r.status} size="sm" /><div style={{ fontSize: '.82rem' }}>{r.description}</div>{r.mitigation && <div style={{ fontSize: '.76rem', color: 'var(--slate-500)' }}>Mitigation: {r.mitigation}</div>}</div>
              {r.status === 'Open' && <button className="btn btn-secondary btn-sm" onClick={() => setRiskStatus(r, 'MITIGATED')}>Mark mitigated</button>}
              {r.status === 'Mitigated' && <button className="btn btn-secondary btn-sm" onClick={() => setRiskStatus(r, 'CLOSED')}>Close</button>}
            </div>
          ))}
          {pilot.risks.length === 0 && <span style={{ color: 'var(--slate-500)', fontSize: '.85rem' }}>No risks registered for this pilot.</span>}
        </div>
      )}

      {tab === 'history' && (
        <div className="card" style={{ display: 'grid', gap: '.6rem' }}>
          {pilot.inspections.map((i) => (
            <div key={i.id} className="row-card"><div><strong>{i.id}</strong> <StatusBadge status={String(i.validation_status).replace(/_/g, ' ')} size="sm" /><div style={{ fontSize: '.82rem' }}>{i.findings}</div><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{String(i.completed_date || i.created_at).slice(0, 16).replace('T', ' ')} • {i.gps_address}</div></div></div>
          ))}
          {pilot.inspections.length === 0 && <span style={{ color: 'var(--slate-500)', fontSize: '.85rem' }}>No inspection has been filed yet.</span>}
        </div>
      )}

      <Modal isOpen={!!dlg} onClose={close} maxWidth="620px"
        title={dlg?.type === 'kpi' ? `Verify KPI — ${dlg.item.metric}` : dlg?.type === 'milestone' ? `Review — ${dlg.item.name}` : dlg?.type === 'risk' ? 'Register a risk' : 'Field inspection docket'}
        footer={<><button className="btn btn-secondary" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={confirm}><CheckCircle2 size={15} /> {busy ? 'Saving…' : 'Submit'}</button></>}>
        {dlg?.type === 'kpi' && (<>
          <p style={{ fontSize: '.84rem' }}>Reported value: <strong>{dlg.item.current}</strong> (target {dlg.item.target})</p>
          <div className="form-group"><label className="form-label" htmlFor="kv">Verdict</label>
            <select id="kv" className="form-control" value={f.verdict} onChange={set('verdict')}>{['Verified', 'Partially Verified', 'Needs Evidence', 'Not Verified'].map((v) => <option key={v}>{v}</option>)}</select></div>
          <div className="form-group"><label className="form-label" htmlFor="kn">Inspector notes (min 5 characters)</label><textarea id="kn" className="form-control" rows={3} value={f.notes} onChange={set('notes')} /></div>
        </>)}
        {dlg?.type === 'milestone' && (<>
          <p style={{ fontSize: '.84rem' }}><strong>Startup's description of delivery:</strong><br />{dlg.item.deliverable || '—'}</p>
          <div className="form-group"><label className="form-label" htmlFor="md">Decision</label>
            <select id="md" className="form-control" value={f.decision} onChange={set('decision')}><option value="VERIFIED">Verified — unlocks the payment claim</option><option value="RETURNED">Return for rework</option></select></div>
          <div className="form-group"><label className="form-label" htmlFor="mn">Notes (min 5 characters)</label><textarea id="mn" className="form-control" rows={3} value={f.notes} onChange={set('notes')} /></div>
        </>)}
        {dlg?.type === 'risk' && (<>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
            <div className="form-group"><label className="form-label" htmlFor="rc">Category</label><select id="rc" className="form-control" value={f.category} onChange={set('category')}>{RISK_CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div className="form-group"><label className="form-label" htmlFor="rs">Severity</label><select id="rs" className="form-control" value={f.severity} onChange={set('severity')}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((c) => <option key={c}>{c}</option>)}</select></div>
          </div>
          <div className="form-group"><label className="form-label" htmlFor="rd">What is the risk? (min 10 characters)</label><textarea id="rd" className="form-control" rows={3} value={f.description || ''} onChange={set('description')} /></div>
          <div className="form-group"><label className="form-label" htmlFor="rm">Mitigation</label><input id="rm" className="form-control" value={f.mitigation || ''} onChange={set('mitigation')} /></div>
          <div className="form-group"><label className="form-label" htmlFor="ro">Owner</label><input id="ro" className="form-control" value={f.owner || ''} onChange={set('owner')} /></div>
        </>)}
        {dlg?.type === 'inspection' && (<>
          {CHECKLIST.map(([k, label]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: '.75rem', alignItems: 'center', padding: '.35rem 0', borderBottom: '1px solid var(--slate-100)' }}>
              <span style={{ fontSize: '.84rem' }}>{label}</span>
              <select aria-label={label} className="form-control" style={{ width: 150 }} value={f[k]} onChange={set(k)}><option value="PASS">Pass</option><option value="FAIL">Fail</option><option value="NEEDS_REVIEW">Needs review</option></select>
            </div>
          ))}
          <div className="form-group" style={{ marginTop: '.75rem' }}><label className="form-label" htmlFor="ia">Site address / location</label><input id="ia" className="form-control" value={f.address} onChange={set('address')} /></div>
          <div className="form-group"><label className="form-label" htmlFor="if">Findings (min 10 characters)</label><textarea id="if" className="form-control" rows={4} value={f.findings} onChange={set('findings')} /></div>
          <div className="form-group"><label className="form-label" htmlFor="iv">Overall verdict</label><select id="iv" className="form-control" value={f.verdict} onChange={set('verdict')}>{VERDICTS.map((v) => <option key={v}>{v}</option>)}</select></div>
          <p style={{ fontSize: '.76rem', color: 'var(--slate-500)' }}>A “Verified” or “Partially verified” verdict is what allows the department to forward this pilot to Finance.</p>
        </>)}
      </Modal>
    </div>
  );
}
