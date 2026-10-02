import React, { useEffect, useState } from 'react';
import { useApp } from '../../../store';
import { financeApi } from '../../../api';
import { Download } from 'lucide-react';
import { PageHeader, EmptyState, DataTable, StatusBadge, Modal, useBusy, inrPaise } from '../../common/ui';

export function FinanceTaxLedger() {
  const { toast } = useApp();
  const [filter, setFilter] = useState('DEDUCTED');
  const [data, setData] = useState(null);
  const [target, setTarget] = useState(null);
  const [f, setF] = useState({ challanNumber: '', challanDate: new Date().toISOString().slice(0, 10) });
  const [busy, run] = useBusy();
  const load = () => financeApi.taxLedger(filter).then(setData).catch(() => setData({ entries: [], totals: { deductedPaise: '0', remittedPaise: '0' } }));
  useEffect(() => { load(); }, [filter]);
  const columns = [
    { key: 'deducted_day', header: 'Deducted', width: '110px' },
    { key: 'tax_type', header: 'Tax', width: '110px', render: (v) => (v === 'TDS' ? 'TDS' : 'GST-TDS') },
    { key: 'startup_name', header: 'Startup', render: (v, r) => <div><strong>{v}</strong><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{r.department_name} • invoice {r.invoice_number}</div></div> },
    { key: 'amount_paise', header: 'Amount', width: '130px', render: (v) => <strong>{inrPaise(Number(v))}</strong> },
    { key: 'status', header: 'Status', width: '130px', render: (v, r) => <div><StatusBadge status={v === 'REMITTED' ? 'Remitted' : 'Deducted'} size="sm" />{r.challan_number && <div style={{ fontSize: '.7rem', color: 'var(--slate-500)' }}>{r.challan_number} • {r.challan_day}</div>}</div> },
    { key: 'act', header: '', width: '120px', render: (_, r) => r.status === 'DEDUCTED' ? <button className="btn btn-outline btn-sm" onClick={() => { setTarget(r); setF((x) => ({ ...x, challanNumber: '' })); }}>Mark remitted</button> : null },
  ];
  const submit = () => run(async () => {
    try { await financeApi.remitTax(target.id, f.challanNumber.trim(), f.challanDate); toast.success('Recorded as remitted'); setTarget(null); load(); }
    catch (e) { toast.error([e.message, ...(e.details || [])].join(' • ')); }
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Tax ledger" subtitle="Tax deducted from each payment, and whether the department has paid it on to the government. Record the challan once remitted."
        actions={<a className="btn btn-outline btn-sm" href={financeApi.taxLedgerCsvUrl()}><Download size={14} /> Export CSV</a>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '1rem' }}>
        <div className="card"><div style={{ fontSize: '.78rem', color: 'var(--slate-500)' }}>Deducted, not yet remitted</div><div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{inrPaise(Number(data?.totals.deductedPaise || 0))}</div></div>
        <div className="card"><div style={{ fontSize: '.78rem', color: 'var(--slate-500)' }}>Remitted (in this view)</div><div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{inrPaise(Number(data?.totals.remittedPaise || 0))}</div></div>
      </div>
      <div style={{ display: 'flex', gap: '.4rem' }}>
        {[['DEDUCTED', 'To remit'], ['REMITTED', 'Remitted'], ['ALL', 'All']].map(([k, l]) => <button key={k} className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      {data && data.entries.length === 0 ? <EmptyState title="Nothing here">Tax appears on this ledger when a payment is marked paid or a cheque clears.</EmptyState>
        : <div className="card"><DataTable columns={columns} data={data?.entries || []} searchable={false} /></div>}
      <Modal isOpen={!!target} onClose={() => setTarget(null)} title="Record tax remittance" maxWidth="460px"
        footer={<><button className="btn btn-secondary" onClick={() => setTarget(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || f.challanNumber.trim().length < 6} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button></>}>
        {target && <p style={{ fontSize: '.84rem', marginTop: 0 }}>{target.tax_type === 'TDS' ? 'TDS' : 'GST-TDS'} of <strong>{inrPaise(Number(target.amount_paise))}</strong> deducted on invoice {target.invoice_number}.</p>}
        <div className="form-group"><label className="form-label" htmlFor="ch">Challan number</label><input id="ch" className="form-control" value={f.challanNumber} onChange={(e) => setF({ ...f, challanNumber: e.target.value })} autoComplete="off" /></div>
        <div className="form-group"><label className="form-label" htmlFor="chd">Challan date</label><input id="chd" type="date" className="form-control" max={new Date().toISOString().slice(0, 10)} value={f.challanDate} onChange={(e) => setF({ ...f, challanDate: e.target.value })} /></div>
      </Modal>
    </div>
  );
}
