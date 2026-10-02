import React, { useState } from 'react';
import { useApp } from '../../../store';
import { ArrowLeft, Bot, CheckCircle2, PauseCircle, XCircle, Landmark } from 'lucide-react';
import { StatusBadge, ConfirmationDialog, Modal, EmptyState, useBusy, inrPaise } from '../../common/ui';

const Row = ({ label, value, strong, minus }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.4rem 0', borderBottom: '1px dashed var(--slate-200)', fontWeight: strong ? 800 : 500 }}>
    <span>{label}</span><span style={{ fontFamily: 'var(--font-mono)' }}>{minus ? '− ' : ''}{inrPaise(value)}</span>
  </div>
);

export function FinancePaymentDetail({ paymentId }) {
  const { state, approvePayment, recordDisbursement, putPaymentOnHold, rejectPayment, openAssistant, navigate, currentUser } = useApp();
  const p = state.payments.find((x) => x.id === paymentId);
  const [dlg, setDlg] = useState(null); // approve | hold | reject
  const [utrOpen, setUtrOpen] = useState(false);
  const [utr, setUtr] = useState('');
  const [busy, run] = useBusy();
  if (!p) return <EmptyState title="Claim not found">It may have been removed or you may not have access.</EmptyState>;

  const anoms = state.anomalies.filter((a) => a.claimId === p.id);
  const blocking = anoms.filter((a) => a.rawStatus === 'DETECTED' && ['HIGH', 'CRITICAL'].includes(a.severity));
  const pendingStates = ['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_PENDING', 'FINANCE_REVIEW'];
  const isMaker = p.requesterId === currentUser?.id;
  const canApprove = pendingStates.includes(p.rawStatus) && !isMaker && blocking.length === 0;
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

      <div className="card">
        <h3 style={{ fontSize: '.95rem', marginTop: 0 }}>Timeline</h3>
        {p.timeline.map((t, i) => <div key={i} style={{ fontSize: '.82rem', padding: '.25rem 0' }}><code style={{ color: 'var(--slate-500)' }}>{t.time}</code> — <strong>{t.actor}</strong>: {t.action}</div>)}
      </div>

      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {canHold && <button className="btn btn-outline" onClick={() => setDlg('hold')}><PauseCircle size={15} /> Place on hold</button>}
        {canHold && <button className="btn btn-danger" onClick={() => setDlg('reject')}><XCircle size={15} /> Reject</button>}
        {pendingStates.includes(p.rawStatus) && <button className="btn btn-success" disabled={!canApprove} onClick={() => setDlg('approve')}><CheckCircle2 size={15} /> Approve</button>}
        {p.rawStatus === 'APPROVED' && <button className="btn btn-primary" onClick={() => setUtrOpen(true)}><Landmark size={15} /> Record bank disbursement</button>}
      </div>

      <ConfirmationDialog isOpen={dlg === 'approve'} onClose={() => setDlg(null)} onConfirm={(r) => approvePayment(p.id, r)}
        title="Approve payment claim" confirmLabel="Approve claim" confirmVariant="success"
        message={`Approving commits ${inrPaise(p.grossAmountPaise)} from the department budget. Money moves only when you record the bank reference afterwards.`} remarksPlaceholder="Approval remarks (min 5 characters)…" warningText="This approval is a human decision recorded in the audit trail with your name." />
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
    </div>
  );
}
