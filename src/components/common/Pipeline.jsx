import React, { useEffect, useState } from 'react';
import { useApp } from '../../store';
import { pipelineApi } from '../../api';
import { TrendingUp, Gavel, Download, Plus, Trash2 } from 'lucide-react';
import { Modal, useBusy, StatusBadge, PageHeader, EmptyState, inrPaise } from './ui';
import { cardStyle } from './Profile';

const label = (s) => ({ RECOMMENDED: 'Recommended', APPROVED: 'Approved', DECLINED: 'Declined', OPEN: 'Open', UPHELD: 'Upheld', DISMISSED: 'Dismissed' }[s] || s);

/* ───────── Government pilot page: recommend a scale-up ───────── */
export function ScaleupRecommend({ pilot }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ rationale: '', value: '' });
  const [existing, setExisting] = useState(null);
  const [busy, run] = useBusy();
  const load = () => pipelineApi.scaleups().then((r) => setExisting(r.plans.find((p) => p.pilotId === pilot.id) || false)).catch(() => setExisting(false));
  useEffect(() => { load(); }, [pilot.id]);
  if (!['VALIDATED', 'COMPLETED', 'FINANCE_PENDING'].includes(pilot.rawStatus)) return null;
  const submit = () => run(async () => {
    try { await pipelineApi.recommendScaleup({ pilotId: pilot.id, rationale: f.rationale.trim(), proposedValuePaise: Math.round(Number(f.value || 0) * 100) }); toast.success('Recommended. A second person now decides.'); setOpen(false); load(); }
    catch (e) { toast.error(e.message); }
  });
  return (
    <section style={cardStyle}>
      <h2 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', gap: 8, alignItems: 'center' }}><TrendingUp size={18} /> Scale-up</h2>
      {existing ? <div style={{ fontSize: '.88rem' }}>Recommended: <StatusBadge status={label(existing.status)} size="sm" /> {existing.decisionNote && <span style={{ color: 'var(--slate-600)' }}>· {existing.decisionNote}</span>}</div> : (
        <>
          <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--slate-600)' }}>This pilot has been validated. Recommend taking it to full rollout; a different officer or an administrator approves.</p>
          <div><button className="btn btn-primary" onClick={() => setOpen(true)}>Recommend scale-up</button></div>
        </>
      )}
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Recommend scale-up" maxWidth="520px"
        footer={<><button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy || f.rationale.trim().length < 30} onClick={submit}>{busy ? 'Saving…' : 'Send for decision'}</button></>}>
        <div className="form-group"><label className="form-label" htmlFor="sr">Why should it scale up? (min 30 characters)</label><textarea id="sr" className="form-control" rows={4} value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="sv">Proposed value (₹, optional)</label><input id="sv" type="number" min="0" className="form-control" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>
      </Modal>
    </section>
  );
}

/* ───────── Scale-up list: government and admin decide, startups see ───────── */
export function ScaleupPage() {
  const { currentUser, toast } = useApp();
  const [rows, setRows] = useState(null);
  const [target, setTarget] = useState(null);
  const [note, setNote] = useState('');
  const [busy, run] = useBusy();
  const load = () => pipelineApi.scaleups().then((r) => setRows(r.plans)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const canDecide = ['government', 'admin'].includes(currentUser?.role);
  const decide = (decision) => run(async () => { try { await pipelineApi.decideScaleup(target.id, decision, note.trim()); toast.success('Decision recorded'); setTarget(null); setNote(''); load(); } catch (e) { toast.error(e.message); } });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Scale-up pipeline" subtitle="Validated pilots recommended for full rollout. The person who recommends cannot be the one who decides." />
      {rows && rows.length === 0 ? <EmptyState title="Nothing recommended yet">Open a validated pilot and choose “Recommend scale-up”.</EmptyState> : (rows || []).map((p) => (
        <div key={p.id} className="card" style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{p.pilotName}</strong><StatusBadge status={label(p.status)} size="sm" /><span style={{ fontSize: '.8rem', color: 'var(--slate-500)' }}>{p.startupName} · {p.department}</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>{Number(p.proposedValuePaise) > 0 ? inrPaise(Number(p.proposedValuePaise)) : ''}</span>
          </div>
          <div style={{ fontSize: '.86rem' }}>{p.rationale}</div>
          {p.decisionNote && <div style={{ fontSize: '.82rem', color: 'var(--slate-600)' }}>Decision: {p.decisionNote}</div>}
          {canDecide && p.status === 'RECOMMENDED' && p.recommendedBy !== currentUser.id && <div><button className="btn btn-primary btn-sm" onClick={() => setTarget(p)}>Decide</button></div>}
          {canDecide && p.status === 'RECOMMENDED' && p.recommendedBy === currentUser.id && <small style={{ color: 'var(--slate-500)' }}>You recommended this, so someone else decides.</small>}
        </div>
      ))}
      <Modal isOpen={!!target} onClose={() => setTarget(null)} title="Decide on scale-up" maxWidth="480px"
        footer={<><button className="btn btn-danger" disabled={busy || note.trim().length < 10} onClick={() => decide('DECLINED')}>Decline</button><button className="btn btn-success" disabled={busy || note.trim().length < 10} onClick={() => decide('APPROVED')}>Approve</button></>}>
        <div className="form-group"><label className="form-label" htmlFor="sd">Note (min 10 characters, the startup sees it)</label><textarea id="sd" className="form-control" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </Modal>
    </div>
  );
}

/* ───────── Startup: appeal a rejected proposal ───────── */
export function AppealsPanel() {
  const { state, toast } = useApp();
  const [appeals, setAppeals] = useState(null);
  const [plans, setPlans] = useState([]);
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, run] = useBusy();
  const load = () => { pipelineApi.appeals().then((r) => setAppeals(r.appeals)).catch(() => setAppeals([])); pipelineApi.scaleups().then((r) => setPlans(r.plans)).catch(() => {}); };
  useEffect(() => { load(); }, []);
  const eligible = state.proposals.filter((p) => ['NOT_SHORTLISTED', 'REJECTED'].includes(p.rawStatus) && !(appeals || []).some((a) => a.proposalId === p.id));
  if ((appeals || []).length === 0 && eligible.length === 0 && plans.length === 0) return null;
  const file = () => run(async () => { try { await pipelineApi.fileAppeal(target.id, reason.trim()); toast.success('Appeal sent to an administrator'); setTarget(null); setReason(''); load(); } catch (e) { toast.error(e.message); } });
  return (
    <section style={cardStyle}>
      {plans.length > 0 && <>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Scale-up decisions</h2>
        {plans.map((p) => <div key={p.id} className="row-card" style={{ alignItems: 'center' }}><div style={{ flex: 1 }}><strong>{p.pilotName}</strong>{p.decisionNote && <div style={{ fontSize: '.78rem', color: 'var(--slate-500)' }}>{p.decisionNote}</div>}</div><StatusBadge status={label(p.status)} size="sm" /></div>)}
      </>}
      {(eligible.length > 0 || (appeals || []).length > 0) && <h2 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', gap: 8, alignItems: 'center' }}><Gavel size={18} /> Appeals</h2>}
      {eligible.length > 0 && <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--slate-600)' }}>If you believe a decision was wrong, you can appeal it once within 15 days. An administrator outside the department reviews it.</p>}
      {eligible.map((p) => <div key={p.id} className="row-card" style={{ alignItems: 'center' }}><div style={{ flex: 1 }}><strong>{p.solutionTitle}</strong><div style={{ fontSize: '.76rem', color: 'var(--slate-500)' }}>{p.status}</div></div><button className="btn btn-outline btn-sm" onClick={() => setTarget(p)}>Appeal</button></div>)}
      {(appeals || []).map((a) => <div key={a.id} className="row-card" style={{ alignItems: 'center' }}><div style={{ flex: 1 }}><strong>{a.solutionTitle}</strong><div style={{ fontSize: '.78rem', color: 'var(--slate-500)' }}>{a.decisionNote || 'Waiting for an administrator'}</div></div><StatusBadge status={label(a.status)} size="sm" /></div>)}
      <Modal isOpen={!!target} onClose={() => setTarget(null)} title="Appeal this decision" maxWidth="520px"
        footer={<><button className="btn btn-secondary" onClick={() => setTarget(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || reason.trim().length < 30} onClick={file}>{busy ? 'Sending…' : 'Send appeal'}</button></>}>
        <p style={{ fontSize: '.84rem', marginTop: 0 }}>Say what the evaluation missed or got wrong. Stick to facts that are in your proposal.</p>
        <div className="form-group"><label className="form-label" htmlFor="ar">Your reasons (min 30 characters)</label><textarea id="ar" className="form-control" rows={5} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </Modal>
    </section>
  );
}

/* ───────── Admin: decide appeals ───────── */
export function AdminAppeals() {
  const { toast } = useApp();
  const [rows, setRows] = useState(null);
  const [target, setTarget] = useState(null);
  const [note, setNote] = useState('');
  const [busy, run] = useBusy();
  const load = () => pipelineApi.appeals().then((r) => setRows(r.appeals)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const decide = (decision) => run(async () => { try { await pipelineApi.decideAppeal(target.id, decision, note.trim()); toast.success(decision === 'UPHELD' ? 'Upheld. The proposal returns to review.' : 'Dismissed'); setTarget(null); setNote(''); load(); } catch (e) { toast.error(e.message); } });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Appeals" subtitle="Startups can appeal a rejection once within 15 days. Upholding sends the proposal back to the department for another look." />
      {rows && rows.length === 0 ? <EmptyState title="No appeals">Appeals from startups appear here.</EmptyState> : (rows || []).map((a) => (
        <div key={a.id} className="card" style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><strong>{a.solutionTitle}</strong><StatusBadge status={label(a.status)} size="sm" /><span style={{ fontSize: '.8rem', color: 'var(--slate-500)' }}>{a.startupName} · {a.challengeTitle}</span></div>
          <div style={{ fontSize: '.86rem' }}>{a.reason}</div>
          {a.decisionNote && <div style={{ fontSize: '.82rem', color: 'var(--slate-600)' }}>Decision: {a.decisionNote}</div>}
          {a.status === 'OPEN' && <div><button className="btn btn-primary btn-sm" onClick={() => setTarget(a)}>Review</button></div>}
        </div>
      ))}
      <Modal isOpen={!!target} onClose={() => setTarget(null)} title="Decide the appeal" maxWidth="480px"
        footer={<><button className="btn btn-outline" disabled={busy || note.trim().length < 10} onClick={() => decide('DISMISSED')}>Dismiss</button><button className="btn btn-success" disabled={busy || note.trim().length < 10} onClick={() => decide('UPHELD')}>Uphold</button></>}>
        <div className="form-group"><label className="form-label" htmlFor="ad">Reasons (min 10 characters, shared with the startup)</label><textarea id="ad" className="form-control" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </Modal>
    </div>
  );
}

/* ───────── Finance: export a bank payment file ───────── */
export function PaymentFileExport() {
  const { state, toast, fetchLiveData } = useApp();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [tpl, setTpl] = useState('builtin-generic');
  const [picked, setPicked] = useState({});
  const [busy, run] = useBusy();
  const ready = state.payments.filter((p) => p.rawStatus === 'APPROVED' && p.paymentMethod !== 'CHEQUE');
  useEffect(() => { if (open) pipelineApi.fileTemplates().then((r) => setTemplates(r.templates)).catch(() => {}); }, [open]);
  const ids = Object.keys(picked).filter((k) => picked[k]);
  const go = () => run(async () => {
    try {
      const csv = await pipelineApi.paymentFile(tpl, ids);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `payment-file-${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success(`File created for ${ids.length} payment${ids.length > 1 ? 's' : ''}. Upload it to your bank, then record the bank reference on each claim.`);
      setOpen(false); setPicked({}); await fetchLiveData();
    } catch (e) { toast.error(e.message); }
  });
  return (
    <>
      <button className="btn btn-outline btn-sm" onClick={() => setOpen(true)}><Download size={14} /> Bank payment file</button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Bank payment file" maxWidth="640px"
        footer={<><button className="btn btn-secondary" onClick={() => setOpen(false)}>Close</button><button className="btn btn-primary" disabled={busy || ids.length === 0} onClick={go}>{busy ? 'Preparing…' : `Download file (${ids.length})`}</button></>}>
        <p style={{ fontSize: '.84rem', marginTop: 0 }}>Choose the layout your bank accepts for bulk transfers and the approved claims to include. The file contains account numbers, so keep it safe. Cheques are not included.</p>
        <div className="form-group"><label className="form-label" htmlFor="pf">File layout</label>
          <select id="pf" className="form-control" value={tpl} onChange={(e) => setTpl(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        {ready.length === 0 ? <EmptyState title="No approved electronic payments">Approved claims that are not paid by cheque appear here.</EmptyState> : ready.map((p) => (
          <label key={p.id} className="row-card" style={{ alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!picked[p.id]} onChange={(e) => setPicked((x) => ({ ...x, [p.id]: e.target.checked }))} />
            <div style={{ flex: 1 }}><strong>{p.startupName}</strong><div style={{ fontSize: '.76rem', color: 'var(--slate-500)' }}>{p.id} · invoice {p.invoiceNumber}{p.exportedAt ? ' · file already created' : ''}</div></div>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{inrPaise(p.netPayablePaise)}</span>
          </label>
        ))}
      </Modal>
    </>
  );
}

/* ───────── Admin: define bank file layouts ───────── */
export function PaymentFormats() {
  const { toast } = useApp();
  const [data, setData] = useState({ templates: [], fields: [] });
  const [draft, setDraft] = useState(null);
  const [busy, run] = useBusy();
  const load = () => pipelineApi.fileTemplates().then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  const start = () => setDraft({ name: '', delimiter: ',', dateFormat: 'YYYY-MM-DD', includeHeader: true, columns: [{ header: 'Account number', field: 'accountNumber', value: '' }, { header: 'IFSC', field: 'ifsc', value: '' }, { header: 'Amount', field: 'amountRupees', value: '' }] });
  const setCol = (i, k, v) => setDraft((d) => ({ ...d, columns: d.columns.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const save = () => run(async () => { try { await pipelineApi.addFileTemplate({ ...draft, columns: draft.columns.map((c) => ({ header: c.header, field: c.field, ...(c.field === 'fixed' ? { value: c.value } : {}) })) }); toast.success('Layout saved'); setDraft(null); load(); } catch (e) { toast.error([e.message, ...(e.details || [])].join(' • ')); } });
  const names = { beneficiaryName: 'Beneficiary name', accountNumber: 'Account number', ifsc: 'IFSC', amountRupees: 'Amount (₹ with paise)', amountPaise: 'Amount (paise)', narration: 'Narration', reference: 'Reference', paymentDate: 'Payment date', invoiceNumber: 'Invoice number', claimId: 'Claim id', email: 'Founder email', fixed: 'Fixed text' };
  return (
    <section style={cardStyle}>
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Bank payment file layouts</h2>
      <p style={{ margin: 0, fontSize: '.82rem', color: 'var(--slate-600)' }}>Banks accept bulk transfers in different layouts. Add one for each bank you use, copying the column order your bank's template asks for. Finance then picks a layout when exporting.</p>
      {data.templates.map((t) => (
        <div key={t.id} className="row-card" style={{ alignItems: 'center' }}>
          <div style={{ flex: 1 }}><strong>{t.name}</strong><div style={{ fontSize: '.76rem', color: 'var(--slate-500)' }}>{t.columns.map((c) => c.header || names[c.field]).join(' · ')}</div></div>
          {t.builtin ? <span className="badge badge-neutral">built in</span> : <button className="btn btn-outline btn-sm" aria-label={`Delete ${t.name}`} onClick={() => run(async () => { try { await pipelineApi.deleteFileTemplate(t.id); load(); } catch (e) { toast.error(e.message); } })}><Trash2 size={13} /></button>}
        </div>
      ))}
      {!draft ? <div><button className="btn btn-outline btn-sm" onClick={start}><Plus size={14} /> Add a layout</button></div> : (
        <div style={{ display: 'grid', gap: 10, padding: 12, border: '1px solid var(--slate-200)', borderRadius: 'var(--radius-md)', background: 'var(--slate-50)' }}>
          <div className="form-group" style={{ margin: 0 }}><label className="form-label" htmlFor="tn">Layout name (e.g. the bank's name)</label><input id="tn" className="form-control" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label className="form-label" style={{ display: 'grid', gap: 4 }}>Separator<select className="form-control" value={draft.delimiter} onChange={(e) => setDraft({ ...draft, delimiter: e.target.value })}><option value=",">comma</option><option value=";">semicolon</option><option value="|">pipe |</option><option value={'\t'}>tab</option></select></label>
            <label className="form-label" style={{ display: 'grid', gap: 4 }}>Date format<select className="form-control" value={draft.dateFormat} onChange={(e) => setDraft({ ...draft, dateFormat: e.target.value })}><option>YYYY-MM-DD</option><option>DD/MM/YYYY</option><option>DDMMYYYY</option></select></label>
            <label className="lp-check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={draft.includeHeader} onChange={(e) => setDraft({ ...draft, includeHeader: e.target.checked })} /><span>First row has column names</span></label>
          </div>
          {draft.columns.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select className="form-control" style={{ maxWidth: 220 }} aria-label={`Column ${i + 1} content`} value={c.field} onChange={(e) => setCol(i, 'field', e.target.value)}>{data.fields.map((f) => <option key={f} value={f}>{names[f] || f}</option>)}</select>
              <input className="form-control" style={{ maxWidth: 200 }} aria-label={`Column ${i + 1} heading`} placeholder="Column heading" value={c.header} onChange={(e) => setCol(i, 'header', e.target.value)} />
              {c.field === 'fixed' && <input className="form-control" style={{ maxWidth: 160 }} aria-label={`Column ${i + 1} fixed text`} placeholder="Text on every row" value={c.value} onChange={(e) => setCol(i, 'value', e.target.value)} />}
              <button className="btn btn-outline btn-sm" aria-label="Remove column" disabled={draft.columns.length < 2} onClick={() => setDraft({ ...draft, columns: draft.columns.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" disabled={draft.columns.length >= 20} onClick={() => setDraft({ ...draft, columns: [...draft.columns, { header: '', field: 'narration', value: '' }] })}><Plus size={13} /> Column</button>
            <button className="btn btn-primary btn-sm" disabled={busy || draft.name.trim().length < 3} onClick={save}>Save layout</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
