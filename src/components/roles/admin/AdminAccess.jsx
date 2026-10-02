import React, { useEffect, useState } from 'react';
import { useApp } from '../../../store';
import { adminApi } from '../../../api';
import { StatusBadge, Modal, PageHeader, EmptyState, useBusy } from '../../common/ui';

const pretty = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** One place for the two things an administrator decides about new people: staff access, and investor verification. */
export function AdminAccessRequests() {
  const { state, act, toast } = useApp();
  const [tab, setTab] = useState('requests');
  const [filter, setFilter] = useState('PENDING');
  const [rows, setRows] = useState([]);
  const [investors, setInvestors] = useState([]);
  const [dlg, setDlg] = useState(null); // {type:'approve'|'reject'|'investor', item}
  const [f, setF] = useState({});
  const [busy, run] = useBusy();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const load = () => {
    adminApi.accessRequests(filter).then((r) => setRows(r.requests)).catch(() => setRows([]));
    adminApi.investors().then((r) => setInvestors(r.investors)).catch(() => setInvestors([]));
  };
  useEffect(load, [filter]);
  const close = () => { setDlg(null); setF({}); };
  const departments = state.departments.filter((d) => d.isActive);

  const submit = () => run(async () => {
    try {
      if (dlg.type === 'approve') await act(() => adminApi.approveRequest(dlg.item.id, { role: f.role || dlg.item.requested_role, departmentId: f.departmentId || dlg.item.department_id || undefined, note: f.note || undefined }), 'Access approved');
      if (dlg.type === 'reject') await act(() => adminApi.rejectRequest(dlg.item.id, f.note || ''), 'Request rejected');
      if (dlg.type === 'investor') await act(() => adminApi.verifyInvestor(dlg.item.user_id, f.status || 'VERIFIED', f.note || ''), 'Decision recorded');
      close(); load();
    } catch { /* the store already showed the server's message */ }
  });

  const suspend = (inv) => run(async () => { try { await act(() => adminApi.updateUser(inv.user_id, { isActive: !inv.is_active }), inv.is_active ? 'Investor suspended' : 'Investor reactivated'); load(); } catch { /* shown */ } });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Access requests & investors" subtitle="Staff accounts need your approval. Investors need verification. You cannot read an investor's introductions." />
      <div role="tablist" style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--slate-200)' }}>
        <button role="tab" aria-selected={tab === 'requests'} className={`tab-btn ${tab === 'requests' ? 'active' : ''}`} onClick={() => setTab('requests')}>Staff access requests{state.accessRequests.length > 0 && <span className="badge badge-warning" style={{ marginLeft: 6 }}>{state.accessRequests.length}</span>}</button>
        <button role="tab" aria-selected={tab === 'investors'} className={`tab-btn ${tab === 'investors' ? 'active' : ''}`} onClick={() => setTab('investors')}>Investors ({investors.length})</button>
      </div>

      {tab === 'requests' && (
        <>
          <div style={{ display: 'flex', gap: 6 }}>{['PENDING', 'APPROVED', 'REJECTED', 'ALL'].map((s) => <button key={s} className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter(s)}>{pretty(s)}</button>)}</div>
          {rows.length === 0 ? <EmptyState title="Nothing here">New requests appear when government, finance or inspector staff sign up.</EmptyState> : rows.map((r) => (
            <div key={r.id} className="card" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong>{r.applicant_name}</strong><span className="badge badge-info">{r.requested_role}</span><StatusBadge status={pretty(r.status)} size="sm" /></div>
                <div style={{ fontSize: '0.8rem', color: 'var(--slate-600)', margin: '4px 0' }}>{r.designation} · {r.department_name || 'No department'} · signed in with {r.login_provider} as {r.login_email}</div>
                <div style={{ fontSize: '0.8rem' }}>Official email: <strong>{r.official_email}</strong>{r.employee_id && ` · ID ${r.employee_id}`}{r.phone && ` · ${r.phone}`}</div>
                <p style={{ fontSize: '0.84rem', margin: '8px 0 0', color: 'var(--slate-700)' }}>“{r.reason}”</p>
                {r.review_note && <p style={{ fontSize: '0.78rem', color: 'var(--slate-500)', margin: '6px 0 0' }}>Decision note: {r.review_note}</p>}
              </div>
              {r.status === 'PENDING' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => { setF({}); setDlg({ type: 'reject', item: r }); }}>Reject</button>
                  <button className="btn btn-primary btn-sm" onClick={() => { setF({ role: r.requested_role, departmentId: r.department_id || '' }); setDlg({ type: 'approve', item: r }); }}>Review & approve</button>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {tab === 'investors' && (investors.length === 0 ? <EmptyState title="No investors yet">Investors who register appear here for verification.</EmptyState> : investors.map((v) => (
        <div key={v.user_id} className="card" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong>{v.name}</strong><StatusBadge status={pretty(v.verification_status)} size="sm" />{!v.is_active && <span className="badge badge-danger">suspended</span>}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--slate-600)', margin: '4px 0' }}>{v.organisation} · {pretty(v.investor_type)} · {v.email}</div>
            <div style={{ fontSize: '0.78rem' }}>{v.website && <a href={v.website} target="_blank" rel="noopener noreferrer">Website</a>} {v.linkedin_url && <a href={v.linkedin_url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8 }}>LinkedIn</a>}</div>
            {v.verification_notes && <p style={{ fontSize: '0.78rem', color: 'var(--slate-500)', margin: '6px 0 0' }}>Notes: {v.verification_notes}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <button className="btn btn-outline btn-sm" onClick={() => suspend(v)}>{v.is_active ? 'Suspend' : 'Reactivate'}</button>
            <button className="btn btn-primary btn-sm" onClick={() => { setF({ status: 'VERIFIED' }); setDlg({ type: 'investor', item: v }); }}>{v.verification_status === 'PENDING' ? 'Review' : 'Change decision'}</button>
          </div>
        </div>
      )))}

      <Modal isOpen={!!dlg} onClose={close} maxWidth="520px"
        title={dlg?.type === 'approve' ? 'Approve access' : dlg?.type === 'reject' ? 'Reject request' : 'Investor verification'}
        footer={<><button className="btn btn-secondary" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={busy || (dlg?.type !== 'approve' && (f.note || '').trim().length < 5)} onClick={submit}>{busy ? 'Saving…' : 'Confirm'}</button></>}>
        {dlg?.type === 'approve' && (<>
          <p style={{ fontSize: '0.84rem', color: 'var(--slate-600)', marginTop: 0 }}>Confirm the role and department you are granting to <strong>{dlg.item.applicant_name}</strong>. You can change what they asked for.</p>
          <div className="form-group"><label className="form-label" htmlFor="ar">Role</label><select id="ar" className="form-control" value={f.role} onChange={set('role')}>{['government', 'finance', 'inspector'].map((x) => <option key={x}>{x}</option>)}</select></div>
          <div className="form-group"><label className="form-label" htmlFor="ad">Department</label><select id="ad" className="form-control" value={f.departmentId || ''} onChange={set('departmentId')}><option value="">None</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div className="form-group"><label className="form-label" htmlFor="an">Note (optional)</label><input id="an" className="form-control" value={f.note || ''} onChange={set('note')} /></div>
        </>)}
        {dlg?.type === 'reject' && (<div className="form-group"><label className="form-label" htmlFor="rn">Reason (shown to the applicant, min 5 characters)</label><textarea id="rn" className="form-control" rows={3} value={f.note || ''} onChange={set('note')} /></div>)}
        {dlg?.type === 'investor' && (<>
          <div className="form-group"><label className="form-label" htmlFor="vs">Decision</label><select id="vs" className="form-control" value={f.status} onChange={set('status')}><option value="VERIFIED">Verify</option><option value="REJECTED">Do not verify</option></select></div>
          <div className="form-group"><label className="form-label" htmlFor="vn">Notes (min 5 characters, kept in the audit trail)</label><textarea id="vn" className="form-control" rows={3} value={f.note || ''} onChange={set('note')} /></div>
        </>)}
      </Modal>
    </div>
  );
}
