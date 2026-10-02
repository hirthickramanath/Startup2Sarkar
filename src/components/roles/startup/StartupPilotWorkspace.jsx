import React, { useState } from 'react';
import { useApp } from '../../../store';
import { Upload, Send, FileText, Receipt } from 'lucide-react';
import { StatusBadge, Modal, EmptyState, PageHeader, useBusy, inr, inrPaise } from '../../common/ui';

export function StartupPilotWorkspace({ pilotId }) {
  const { state, navigate, submitKpiEvidence, submitMilestone, submitClaim } = useApp();
  const mine = state.pilots;
  const pilot = (pilotId ? mine.find((p) => p.id === pilotId) : mine[0]);
  const [tab, setTab] = useState('milestones');
  const [dlg, setDlg] = useState(null); // { type: 'kpi'|'milestone'|'claim', item }
  const [f, setF] = useState({});
  const [busy, run] = useBusy();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const close = () => { setDlg(null); setF({}); };

  if (!pilot) {
    return (
      <>
        <PageHeader title="Pilot workspace" />
        <EmptyState title="No active pilot yet">When a department selects your proposal, the pilot — with its milestones and KPIs — appears here.</EmptyState>
      </>
    );
  }

  const claims = state.payments.filter((p) => p.pilotId === pilot.id);
  const claimFor = (msId) => claims.find((c) => c.milestoneId === msId && c.rawStatus !== 'REJECTED');
  const locked = ['VALIDATED', 'FINANCE_PENDING', 'TERMINATED'].includes(pilot.rawStatus);

  const openClaim = (m) => { setF({ invoiceNumber: '', invoiceDate: new Date().toISOString().slice(0, 10), grossRupees: String(m.amount) }); setDlg({ type: 'claim', item: m }); };

  const confirm = () => run(async () => {
    if (dlg.type === 'kpi') await submitKpiEvidence(pilot.id, dlg.item.id, f.value, f.source, f.notes);
    if (dlg.type === 'milestone') await submitMilestone(pilot.id, dlg.item.id, f.notes);
    if (dlg.type === 'claim') await submitClaim({ pilotId: pilot.id, milestoneId: dlg.item.id, invoiceNumber: f.invoiceNumber, invoiceDate: f.invoiceDate, grossRupees: f.grossRupees });
    close();
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {mine.length > 1 && !pilotId && (
        <select className="form-control" style={{ maxWidth: 420 }} value={pilot.id} onChange={(e) => navigate(`/startup/pilots/${e.target.value}`)} aria-label="Select pilot">
          {mine.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}

      <div className="hero-band">
        <div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4 }}>
            <code style={{ background: 'rgba(255,255,255,.18)', padding: '0.1rem 0.45rem', borderRadius: 4, fontSize: '0.74rem' }}>{pilot.id}</code>
            <StatusBadge status={pilot.status} />
          </div>
          <h1 style={{ color: '#fff', fontSize: '1.3rem', fontWeight: 800, margin: 0 }}>{pilot.name}</h1>
          <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginTop: 4 }}>
            {pilot.department || 'Department'} • Inspector: {pilot.assignedInspectorName || 'not yet assigned'} • {pilot.progress}% of milestones verified
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Contract value</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{inr(pilot.totalBudget)}</div>
          <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>Paid out (net): {inrPaise(pilot.fundsDisbursedPaise)}</div>
        </div>
      </div>

      <div role="tablist" style={{ display: 'flex', borderBottom: '1px solid var(--slate-200)', gap: '1rem' }}>
        {[['milestones', 'Milestones & payment claims'], ['kpis', 'KPI evidence']].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab-btn ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'milestones' && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {pilot.milestones.map((m) => {
            const claim = claimFor(m.id);
            return (
              <div key={m.id} className="row-card">
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{m.name}</strong><StatusBadge status={m.status} size="sm" />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--slate-600)', margin: '0.2rem 0' }}>{m.deliverable}</div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--slate-500)', fontFamily: 'var(--font-mono)' }}>
                    Due {m.dueDate}{m.paidDate && ` • Paid ${m.paidDate}`}{claim && ` • Claim ${claim.id}: ${claim.status}`}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, fontFamily: 'var(--font-mono)', fontSize: '1.1rem' }}>{inr(m.amount)}</div>
                  {!locked && ['PENDING', 'RETURNED'].includes(m.rawStatus) && (
                    <button className="btn btn-primary btn-sm" style={{ marginTop: 6 }} onClick={() => setDlg({ type: 'milestone', item: m })}><Send size={13} /> Submit deliverable</button>
                  )}
                  {m.rawStatus === 'SUBMITTED' && <span style={{ fontSize: '0.74rem', color: 'var(--info-text)' }}>Awaiting inspector</span>}
                  {m.rawStatus === 'VERIFIED' && !claim && (
                    <button className="btn btn-success btn-sm" style={{ marginTop: 6 }} onClick={() => openClaim(m)}><Receipt size={13} /> Raise payment claim</button>
                  )}
                </div>
              </div>
            );
          })}
          {pilot.milestones.length === 0 && <span style={{ color: 'var(--slate-500)' }}>No milestones were generated for this pilot.</span>}
        </div>
      )}

      {tab === 'kpis' && (
        <div className="card">
          <p style={{ fontSize: '0.8rem', color: 'var(--slate-500)', marginTop: 0 }}>Every submission is stored as a new version — earlier values are never overwritten. The inspector verifies each KPI on site.</p>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>KPI</th><th>Baseline</th><th>Target</th><th>Latest reported</th><th>Version</th><th>Verification</th><th /></tr></thead>
              <tbody>
                {pilot.kpiResults.map((k) => (
                  <tr key={k.id}>
                    <td><strong>{k.metric}</strong></td><td>{k.baseline}</td><td>{k.target}</td>
                    <td>{k.hasEvidence ? k.current : '—'}</td><td><code>{k.version}</code></td>
                    <td><StatusBadge status={k.status} size="sm" /></td>
                    <td>{!locked && <button className="btn btn-outline btn-sm" onClick={() => { setF({ value: '' }); setDlg({ type: 'kpi', item: k }); }}><Upload size={13} /> Submit</button>}</td>
                  </tr>
                ))}
                {pilot.kpiResults.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--slate-500)' }}>The challenge defined no KPIs for this pilot.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        isOpen={!!dlg} onClose={close}
        title={dlg?.type === 'kpi' ? `Submit evidence — ${dlg.item.metric}` : dlg?.type === 'milestone' ? `Submit deliverable — ${dlg.item.name}` : `Payment claim — ${dlg?.item?.name}`}
        footer={<>
          <button className="btn btn-secondary" onClick={close}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={confirm}>{busy ? 'Submitting…' : 'Submit'}</button>
        </>}
      >
        {dlg?.type === 'kpi' && (<>
          <div className="form-group"><label className="form-label" htmlFor="v">Measured value ({dlg.item.unit || 'with unit'})</label><input id="v" className="form-control" value={f.value || ''} onChange={set('value')} /></div>
          <div className="form-group"><label className="form-label" htmlFor="s">Data source</label><input id="s" className="form-control" value={f.source || ''} onChange={set('source')} placeholder="e.g. Device telemetry, hospital audit sheet" /></div>
          <div className="form-group"><label className="form-label" htmlFor="n">Notes (min 5 characters)</label><textarea id="n" className="form-control" rows={3} value={f.notes || ''} onChange={set('notes')} /></div>
        </>)}
        {dlg?.type === 'milestone' && (
          <div className="form-group"><label className="form-label" htmlFor="mn">What was delivered? (min 10 characters)</label><textarea id="mn" className="form-control" rows={4} value={f.notes || ''} onChange={set('notes')} /></div>
        )}
        {dlg?.type === 'claim' && (<>
          <div className="form-group"><label className="form-label" htmlFor="inv">Invoice number</label><input id="inv" className="form-control" value={f.invoiceNumber || ''} onChange={set('invoiceNumber')} /></div>
          <div className="form-group"><label className="form-label" htmlFor="id">Invoice date</label><input id="id" type="date" className="form-control" value={f.invoiceDate || ''} onChange={set('invoiceDate')} /></div>
          <div className="form-group"><label className="form-label" htmlFor="g">Gross amount (₹) — at most {inr(dlg.item.amount)}</label><input id="g" type="number" className="form-control" value={f.grossRupees || ''} onChange={set('grossRupees')} /></div>
          <p style={{ fontSize: '0.78rem', color: 'var(--slate-500)' }}><FileText size={12} /> TDS and GST-TDS are withheld automatically at the platform rates; you will see the net payable after submitting.</p>
        </>)}
      </Modal>
    </div>
  );
}
