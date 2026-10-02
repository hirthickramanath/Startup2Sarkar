import React, { useState } from 'react';
import { useApp } from '../../../store';
import { ArrowLeft, Bot, CheckCircle2, PauseCircle, XCircle, Landmark, Printer, FileCheck2, Undo2 } from 'lucide-react';
import { StatusBadge, ConfirmationDialog, Modal, EmptyState, useBusy, inrPaise } from '../../common/ui';

const Row = ({ label, value, strong, minus }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.4rem 0', borderBottom: '1px dashed var(--slate-200)', fontWeight: strong ? 800 : 500 }}>
    <span>{label}</span><span style={{ fontFamily: 'var(--font-mono)' }}>{minus ? '− ' : ''}{inrPaise(value)}</span>
  </div>
);

export function FinancePaymentDetail({ paymentId }) {
  const { state, approvePayment, recordCheque, clearCheque, bounceCheque, recordDisbursement, putPaymentOnHold, rejectPayment, openAssistant, navigate, currentUser } = useApp();
  const p = state.payments.find((x) => x.id === paymentId);
  const [dlg, setDlg] = useState(null); // approve | hold | reject
  const [utrOpen, setUtrOpen] = useState(false);
  const [utr, setUtr] = useState('');
  const [chq, setChq] = useState(null); // cheque form
  const [clearDate, setClearDate] = useState(null);
  const [bounce, setBounce] = useState(null);
  const [busy, run] = useBusy();
  if (!p) return <EmptyState title="Claim not found">It may have been removed or you may not have access.</EmptyState>;

  const anoms = state.anomalies.filter((a) => a.claimId === p.id);
  const blocking = anoms.filter((a) => a.rawStatus === 'DETECTED' && ['HIGH', 'CRITICAL'].includes(a.severity));
  const pendingStates = ['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_PENDING', 'FINANCE_REVIEW', 'AWAITING_SECOND_APPROVAL'];
  const isFirstApprover = p.rawStatus === 'AWAITING_SECOND_APPROVAL' && p.firstReviewerId === currentUser?.id;
  const isMaker = p.requesterId === currentUser?.id;
  const canApprove = pendingStates.includes(p.rawStatus) && !isMaker && !isFirstApprover && blocking.length === 0;
  const today = new Date().toISOString().slice(0, 10);
  const printAdvice = () => {
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) return;
    const row = (l, v, b) => `<tr><td>${esc(l)}</td><td style="text-align:right;font-family:monospace;${b ? 'font-weight:700;border-top:2px solid #000' : ''}">${esc(v)}</td></tr>`;
    w.document.write(`<!doctype html><title>Payment advice ${esc(p.id)}</title><style>body{font:14px system-ui,sans-serif;margin:40px;color:#111}h1{font-size:20px;margin:0}td{padding:6px 0;border-bottom:1px solid #ddd}table{width:100%;border-collapse:collapse;margin:16px 0}small{color:#555}</style>
      <h1>Payment advice</h1><small>${esc(p.department)} · claim ${esc(p.id)}</small>
      <p><b>${esc(p.startupName)}</b><br>${esc(p.milestoneTitle)}<br>Invoice ${esc(p.invoiceNumber)} dated ${esc(p.invoiceDate)}</p>
      <table>${row('Gross claim', inrPaise(p.grossAmountPaise))}${row('Income tax deducted (TDS)', '− ' + inrPaise(p.tdsPaise))}${row('GST deducted (GST-TDS)', '− ' + inrPaise(p.gstTdsPaise))}${p.penaltyPaise > 0 ? row('Penalty', '− ' + inrPaise(p.penaltyPaise)) : ''}${row('Net payable', inrPaise(p.netPayablePaise), true)}</table>
      <p>${p.paymentMethod === 'CHEQUE' || p.chequeNumber ? `Payment by cheque no. <b>${esc(p.chequeNumber || p.disbursementReference)}</b>${p.draweeBank ? ' drawn on ' + esc(p.draweeBank) : ''}${p.chequeDate ? ', dated ' + esc(p.chequeDate) : ''}.${p.signatories ? '<br>Authorised signatories: ' + esc(p.signatories) : ''}` : p.disbursementReference ? `Paid by electronic transfer. Bank reference <b>${esc(p.disbursementReference)}</b>.` : 'Payment method not yet recorded.'}</p>
      <small>Generated ${esc(new Date().toISOString().slice(0, 10))} from the Startup2Sarkar audit trail.</small><script>window.onload=function(){window.print()}<\/script>`);
    w.document.close();
  };
  const canHold = !['PAID', 'REJECTED', 'ON_HOLD', 'PROCESSING'].includes(p.rawStatus);
  const dept = state.departments.find((d) => d.id === p.departmentId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 1000 }}>
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/finance/payments')}><ArrowLeft size={14} /> Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><code>{p.id}</code><StatusBadge status={p.status} /></div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '2px 0 0' }}>{p.startupName} — {p.milestoneTitle}</h1>
          <div style={{ fontSize: '.8rem', color: 'var(--slate-500)' }}>{p.pilotTitle} • invoice {p.invoiceNumber} dated {p.invoiceDate}</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => openAssistant({ paymentId: p.id })}><Bot size={14} /> Ask about this claim</button>
      </div>

      {isMaker && pendingStates.includes(p.rawStatus) && <div className="card" style={{ background: 'var(--warning-bg)', borderColor: 'var(--warning-border)', fontSize: '.84rem' }}>Maker-checker: you raised this claim, so someone else must approve it.</div>}
      {p.rawStatus === 'AWAITING_SECOND_APPROVAL' && <div className="card" style={{ background: 'var(--warning-bg)', borderColor: 'var(--warning-border)', fontSize: '.84rem' }}>First approval recorded. A payment this size needs a <strong>second approval from a different finance officer</strong>.{isFirstApprover && ' That cannot be you.'}</div>}
      {p.rawStatus === 'CHEQUE_ISSUED' && <div className="card" style={{ background: 'var(--info-bg)', borderColor: 'var(--info-border)', fontSize: '.84rem' }}>Cheque <strong>{p.chequeNumber}</strong> ({p.draweeBank}) is out. The money counts as <strong>spent only when it clears</strong>; until then it stays reserved.</div>}
      {blocking.length > 0 && <div className="card" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', fontSize: '.84rem' }}>Approval is blocked until {blocking.length} critical anomaly/anomalies are resolved. <button className="auth-link" style={{ color: 'var(--info-text)' }} onClick={() => navigate('/finance/anomalies')}>Open anomalies</button></div>}
      {p.holdReason && <div className="card" style={{ fontSize: '.84rem' }}><strong>{p.status}:</strong> {p.holdReason}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: '1.25rem' }}>
        <div className="card">
          <h3 style={{ fontSize: '.95rem', marginTop: 0 }}>Payable calculation</h3>
          <Row label="Gross claim" value={p.grossAmountPaise} />
          <Row label="TDS withheld" value={p.tdsPaise} minus />
          <Row label="GST-TDS withheld" value={p.gstTdsPaise} minus />
          {p.penaltyPaise > 0 && <Row label="Penalty" value={p.penaltyPaise} minus />}
          <Row label="Net payable" value={p.netPayablePaise} strong />
          <p style={{ fontSize: '.74rem', color: 'var(--slate-500)', marginBottom: 0 }}>Computed on the server in integer paise at the rates set by the administrator.</p>
        </div>
        <div className="card">
          <h3 style={{ fontSize: '.95rem', marginTop: 0 }}>Budget & control</h3>
          <p style={{ fontSize: '.84rem', margin: '.25rem 0' }}><strong>Department:</strong> {p.department}</p>
          {dept && <p style={{ fontSize: '.84rem', margin: '.25rem 0' }}><strong>Headroom:</strong> {inrPaise(dept.budgetAllocatedPaise - dept.budgetCommittedPaise - dept.budgetDisbursedPaise)} of {inrPaise(dept.budgetAllocatedPaise)}</p>}
          {p.disbursementReference && <p style={{ fontSize: '.84rem' }}><strong>Bank reference:</strong> <code>{p.disbursementReference}</code> • paid {p.paidDate}</p>}
          <h4 style={{ fontSize: '.84rem', marginBottom: '.25rem' }}>Anomalies on this claim</h4>
          {anoms.length === 0 ? <span style={{ fontSize: '.8rem', color: 'var(--slate-500)' }}>None recorded.</span> : anoms.map((a) => <div key={a.id} style={{ fontSize: '.8rem' }}>• {a.type} ({a.severity}, {a.status}) — {a.description}</div>)}
        </div>
      </div>

      {p.chequeHistory.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: '.95rem', marginTop: 0 }}>Cheque history</h3>
          {p.chequeHistory.map((h, i) => <div key={i} style={{ fontSize: '.82rem', padding: '.25rem 0' }}><code style={{ color: 'var(--slate-500)' }}>{String(h.at).slice(0, 10)}</code> — cheque <strong>{h.number}</strong> ({h.bank}) {String(h.event).toLowerCase()}{h.reason ? `: ${h.reason}` : ''}</div>)}
        </div>
      )}

      <div className="card">
        <h3 style={{ fontSize: '.95rem', marginTop: 0 }}>Timeline</h3>
        {p.timeline.map((t, i) => <div key={i} style={{ fontSize: '.82rem', padding: '.25rem 0' }}><code style={{ color: 'var(--slate-500)' }}>{t.time}</code> — <strong>{t.actor}</strong>: {t.action}</div>)}
      </div>

      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {canHold && <button className="btn btn-outline" onClick={() => setDlg('hold')}><PauseCircle size={15} /> Place on hold</button>}
        {canHold && <button className="btn btn-danger" onClick={() => setDlg('reject')}><XCircle size={15} /> Reject</button>}
        {pendingStates.includes(p.rawStatus) && <button className="btn btn-success" disabled={!canApprove} onClick={() => setDlg('approve')}><CheckCircle2 size={15} /> Approve</button>}
        {['APPROVED', 'CHEQUE_ISSUED', 'PAID'].includes(p.rawStatus) && <button className="btn btn-outline" onClick={printAdvice}><Printer size={15} /> Payment advice</button>}
        {p.rawStatus === 'CHEQUE_ISSUED' && <button className="btn btn-outline" onClick={() => setBounce('')}><Undo2 size={15} /> Cheque returned</button>}
        {p.rawStatus === 'CHEQUE_ISSUED' && <button className="btn btn-success" onClick={() => setClearDate(today)}><FileCheck2 size={15} /> Mark cheque cleared</button>}
        {p.rawStatus === 'APPROVED' && <button className="btn btn-outline" onClick={() => setChq({ chequeNumber: '', chequeDate: today, draweeBank: '', signatories: '' })}><Landmark size={15} /> Issue cheque</button>}
        {p.rawStatus === 'APPROVED' && <button className="btn btn-primary" onClick={() => setUtrOpen(true)}><Landmark size={15} /> Record electronic payment</button>}
      </div>

      <ConfirmationDialog isOpen={dlg === 'approve'} onClose={() => setDlg(null)} onConfirm={(r) => approvePayment(p.id, r)}
        title="Approve payment claim" confirmLabel="Approve claim" confirmVariant="success"
        message={p.rawStatus === 'AWAITING_SECOND_APPROVAL' ? `This is the second approval. It commits ${inrPaise(p.grossAmountPaise)} from the department budget.` : `Approving commits ${inrPaise(p.grossAmountPaise)} from the department budget. Large payments need a second approval from a different officer. Money counts as spent only when a bank reference is recorded or a cheque clears.`} remarksPlaceholder="Approval remarks (min 5 characters)…" warningText="This approval is a human decision recorded in the audit trail with your name." />
      <ConfirmationDialog isOpen={dlg === 'hold'} onClose={() => setDlg(null)} onConfirm={(r) => putPaymentOnHold(p.id, r)}
        title="Place claim on hold" confirmLabel="Place on hold" message="The startup is notified with your reason." remarksPlaceholder="Reason (min 5 characters)…" warningText="" />
      <ConfirmationDialog isOpen={dlg === 'reject'} onClose={() => setDlg(null)} onConfirm={(r) => rejectPayment(p.id, r)}
        title="Reject claim" confirmLabel="Reject claim" confirmVariant="danger" message="The milestone returns to “verified” so the startup can submit a corrected claim." remarksPlaceholder="Reason (min 5 characters)…" warningText="" />

      <Modal isOpen={utrOpen} onClose={() => setUtrOpen(false)} title="Record bank disbursement" maxWidth="480px"
        footer={<><button className="btn btn-secondary" onClick={() => setUtrOpen(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || utr.trim().length < 8} onClick={() => run(async () => { await recordDisbursement(p.id, utr.trim()); setUtrOpen(false); setUtr(''); })}>{busy ? 'Recording…' : 'Mark as paid'}</button></>}>
        <p style={{ fontSize: '.84rem' }}>Enter the UTR / PFMS reference from the completed transfer of <strong>{inrPaise(p.netPayablePaise)}</strong>. The platform never marks money as paid without a real reference.</p>
        <label className="form-label" htmlFor="utr">Bank reference (UTR / PFMS)</label>
        <input id="utr" className="form-control" value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="min 8 characters" autoComplete="off" />
      </Modal>

      <Modal isOpen={!!chq} onClose={() => setChq(null)} title="Issue cheque" maxWidth="520px"
        footer={<><button className="btn btn-secondary" onClick={() => setChq(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !chq || !/^[0-9]{6,10}$/.test(chq.chequeNumber) || chq.draweeBank.trim().length < 3 || chq.signatories.trim().length < 3} onClick={() => run(async () => { await recordCheque(p.id, chq); setChq(null); })}>{busy ? 'Saving…' : 'Record cheque'}</button></>}>
        {chq && (<>
          <p style={{ fontSize: '.84rem', marginTop: 0 }}>Cheque for <strong>{inrPaise(p.netPayablePaise)}</strong> (net payable). It counts as paid only once it clears.</p>
          <div className="form-group"><label className="form-label" htmlFor="cn">Cheque number (6-10 digits)</label><input id="cn" className="form-control" value={chq.chequeNumber} onChange={(e) => setChq({ ...chq, chequeNumber: e.target.value })} inputMode="numeric" autoComplete="off" /></div>
          <div className="form-group"><label className="form-label" htmlFor="cd">Cheque date</label><input id="cd" type="date" className="form-control" value={chq.chequeDate} onChange={(e) => setChq({ ...chq, chequeDate: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="cb">Drawee bank</label><input id="cb" className="form-control" value={chq.draweeBank} onChange={(e) => setChq({ ...chq, draweeBank: e.target.value })} placeholder="e.g. State Bank of India, Main Branch" /></div>
          <div className="form-group"><label className="form-label" htmlFor="cs">Authorised signatories</label><input id="cs" className="form-control" value={chq.signatories} onChange={(e) => setChq({ ...chq, signatories: e.target.value })} placeholder="Names of the people who signed" /></div>
        </>)}
      </Modal>
      <Modal isOpen={clearDate !== null} onClose={() => setClearDate(null)} title="Mark cheque as cleared" maxWidth="440px"
        footer={<><button className="btn btn-secondary" onClick={() => setClearDate(null)}>Cancel</button>
          <button className="btn btn-success" disabled={busy || !clearDate} onClick={() => run(async () => { await clearCheque(p.id, clearDate); setClearDate(null); })}>{busy ? 'Saving…' : 'Confirm cleared'}</button></>}>
        <p style={{ fontSize: '.84rem', marginTop: 0 }}>Confirm from the bank statement that cheque <strong>{p.chequeNumber}</strong> cleared. The department budget moves from reserved to spent, and the tax deducted goes on the tax ledger.</p>
        <label className="form-label" htmlFor="cdt">Date it cleared</label><input id="cdt" type="date" className="form-control" max={today} value={clearDate || ''} onChange={(e) => setClearDate(e.target.value)} />
      </Modal>
      <Modal isOpen={bounce !== null} onClose={() => setBounce(null)} title="Cheque returned" maxWidth="460px"
        footer={<><button className="btn btn-secondary" onClick={() => setBounce(null)}>Cancel</button>
          <button className="btn btn-danger" disabled={busy || (bounce || '').trim().length < 5} onClick={() => run(async () => { await bounceCheque(p.id, bounce.trim()); setBounce(null); })}>{busy ? 'Saving…' : 'Mark as returned'}</button></>}>
        <p style={{ fontSize: '.84rem', marginTop: 0 }}>The claim goes back to approved and the money stays reserved. This cheque number can never be used again.</p>
        <label className="form-label" htmlFor="br">Reason (min 5 characters)</label><input id="br" className="form-control" value={bounce || ''} onChange={(e) => setBounce(e.target.value)} />
      </Modal>
    </div>
  );
}
