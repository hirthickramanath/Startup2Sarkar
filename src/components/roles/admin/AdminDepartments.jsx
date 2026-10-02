import React, { useState } from 'react';
import { useApp } from '../../../store';
import { adminApi } from '../../../api';
import { Plus } from 'lucide-react';
import { DataTable, Modal, PageHeader, EmptyState, useBusy, inr } from '../../common/ui';

export function AdminDepartments() {
  const { state, act } = useApp();
  const [dlg, setDlg] = useState(null); // 'new' | department
  const [f, setF] = useState({});
  const [busy, run] = useBusy();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const isNew = dlg === 'new';
  const toPaise = (rupees) => String(Math.round(parseFloat(rupees || '0') * 100));

  const save = () => run(async () => {
    if (isNew) await act(() => adminApi.createDepartment({ name: f.name, code: f.code, ministry: f.ministry, description: f.description || undefined, budgetAllocatedPaise: toPaise(f.budget) }), 'Department created');
    else await act(() => adminApi.updateDepartment(dlg.id, { name: f.name, description: f.description, isActive: f.active === 'true', budgetAllocatedPaise: toPaise(f.budget) }), 'Department updated');
    setDlg(null);
  });
  const open = (d) => { if (d === 'new') setF({ budget: '' }); else setF({ name: d.name, description: d.description, active: String(d.isActive), budget: String(d.budgetAllocated) }); setDlg(d); };

  const columns = [
    { key: 'name', header: 'Department', render: (v, r) => <div><strong>{v}</strong><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{r.code} • {r.ministry}</div></div> },
    { key: 'budgetAllocated', header: 'Allocated', width: '140px', render: (v) => <strong>{inr(v)}</strong> },
    { key: 'budgetCommitted', header: 'Committed', width: '140px', render: inr },
    { key: 'budgetDisbursed', header: 'Disbursed', width: '140px', render: inr },
    { key: 'isActive', header: 'Active', width: '80px', render: (v) => (v ? 'Yes' : 'No') },
    { key: 'edit', header: '', width: '90px', render: (_, r) => <button className="btn btn-outline btn-sm" onClick={() => open(r)}>Edit</button> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Departments & budgets" subtitle="Each department's allocation caps what can be committed to pilots and payments."
        actions={<button className="btn btn-primary" onClick={() => open('new')}><Plus size={15} /> New department</button>} />
      {state.departments.length === 0 ? <EmptyState title="No departments yet">Create the first department so you can invite its officials.</EmptyState>
        : <div className="card"><DataTable columns={columns} data={state.departments} searchable={false} /></div>}
      <Modal isOpen={!!dlg} onClose={() => setDlg(null)} title={isNew ? 'New department' : 'Edit department'} maxWidth="520px"
        footer={<><button className="btn btn-secondary" onClick={() => setDlg(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.name || (isNew && (!f.code || !f.ministry))} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
        <div className="form-group"><label className="form-label" htmlFor="dn">Name</label><input id="dn" className="form-control" value={f.name || ''} onChange={set('name')} /></div>
        {isNew && <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '.75rem' }}>
          <div className="form-group"><label className="form-label" htmlFor="dc">Code</label><input id="dc" className="form-control" value={f.code || ''} onChange={set('code')} placeholder="e.g. HFW" /></div>
          <div className="form-group"><label className="form-label" htmlFor="dm">Ministry</label><input id="dm" className="form-control" value={f.ministry || ''} onChange={set('ministry')} /></div></div>}
        <div className="form-group"><label className="form-label" htmlFor="dd">Description</label><input id="dd" className="form-control" value={f.description || ''} onChange={set('description')} /></div>
        <div className="form-group"><label className="form-label" htmlFor="db">Budget allocation (₹)</label><input id="db" type="number" min="0" className="form-control" value={f.budget || ''} onChange={set('budget')} />
          {dlg && !isNew && <small style={{ color: 'var(--slate-500)' }}>Cannot be set below the {inr(dlg.budgetCommitted + dlg.budgetDisbursed)} already committed or paid.</small>}</div>
        {!isNew && <div className="form-group"><label className="form-label" htmlFor="da">Active</label><select id="da" className="form-control" value={f.active} onChange={set('active')}><option value="true">Active</option><option value="false">Inactive</option></select></div>}
      </Modal>
    </div>
  );
}
