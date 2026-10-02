import React, { useState } from 'react';
import { useApp } from '../../../store';
import { adminApi } from '../../../api';
import { UserPlus, Copy, KeyRound } from 'lucide-react';
import { StatusBadge, DataTable, Modal, PageHeader, EmptyState, useBusy } from '../../common/ui';

export function AdminUsers() {
  const { state, act, toast } = useApp();
  const [tab, setTab] = useState('users');
  const [invite, setInvite] = useState(null);
  const [secret, setSecret] = useState(null); // one-time temporary password
  const [verify, setVerify] = useState(null);
  const [f, setF] = useState({});
  const [busy, run] = useBusy();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const depts = state.departments.filter((d) => d.isActive);

  const needsDept = ['government', 'finance'].includes(f.role);
  const send = () => run(async () => {
    const r = await act(() => adminApi.inviteUser({ email: f.email, name: f.name, role: f.role, designation: f.designation, departmentId: f.departmentId || undefined }), 'Account created');
    setInvite(null); setSecret({ email: f.email, password: r.temporaryPassword }); setF({});
  });
  const toggle = (u) => act(() => adminApi.updateUser(u.id, { isActive: !u.isActive }), u.isActive ? 'User deactivated' : 'User reactivated').catch(() => {});
  const reset = async (u) => { try { const r = await act(() => adminApi.resetPassword(u.id), 'Password reset'); setSecret({ email: u.email, password: r.temporaryPassword }); } catch { /* toast shown */ } };
  const decide = (status) => run(async () => { await act(() => adminApi.verifyStartup(verify.id, status, f.notes || ''), `Startup ${status.toLowerCase()}`); setVerify(null); setF({}); });

  const userCols = [
    { key: 'name', header: 'User', render: (v, r) => <div><strong>{v}</strong><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{r.email}</div></div> },
    { key: 'role', header: 'Role', width: '110px', render: (v) => <span className="badge badge-info">{v}</span> },
    { key: 'department', header: 'Department / startup' },
    { key: 'provider', header: 'Sign-in', width: '90px' },
    { key: 'mfaEnabled', header: 'MFA', width: '70px', render: (v) => (v ? '✓' : '—') },
    { key: 'status', header: 'Status', width: '100px', render: (v) => <StatusBadge status={v} size="sm" /> },
    { key: 'act', header: '', width: '210px', render: (_, r) => r.role === 'startup' ? null : (<div style={{ display: 'flex', gap: '.35rem' }}><button className="btn btn-outline btn-sm" onClick={() => toggle(r)}>{r.isActive ? 'Deactivate' : 'Reactivate'}</button><button className="btn btn-secondary btn-sm" aria-label={`Reset password for ${r.name}`} onClick={() => reset(r)}><KeyRound size={13} /></button></div>) },
  ];
  const startupCols = [
    { key: 'name', header: 'Startup', render: (v, r) => <div><strong>{v}</strong><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{r.founders} • {r.founderEmail}</div></div> },
    { key: 'dpiitReg', header: 'DPIIT', render: (v) => v || <span style={{ color: 'var(--warning-text)' }}>missing</span> },
    { key: 'cin', header: 'CIN / LLPIN', render: (v) => v || '—' },
    { key: 'gstin', header: 'GSTIN', render: (v) => v || '—' },
    { key: 'verificationStatus', header: 'Status', width: '110px', render: (v) => <StatusBadge status={v === 'VERIFIED' ? 'Verified' : v === 'REJECTED' ? 'Rejected' : 'Pending'} size="sm" /> },
    { key: 'act', header: '', width: '110px', render: (_, r) => <button className="btn btn-outline btn-sm" onClick={() => { setF({ notes: '' }); setVerify(r); }}>{r.verificationStatus === 'PENDING' ? 'Review' : 'Details'}</button> },
  ];
  const pending = state.startups.filter((s) => s.verificationStatus === 'PENDING').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Users & startups" subtitle="Officials, inspectors and finance officers are created here. Startups register themselves and are verified here."
        actions={<button className="btn btn-primary" onClick={() => { setF({ role: 'government' }); setInvite(true); }}><UserPlus size={15} /> Create user</button>} />
      <div role="tablist" style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--slate-200)' }}>
        <button role="tab" aria-selected={tab === 'users'} className={`tab-btn ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>Users ({state.users.length})</button>
        <button role="tab" aria-selected={tab === 'startups'} className={`tab-btn ${tab === 'startups' ? 'active' : ''}`} onClick={() => setTab('startups')}>Startups ({state.startups.length}){pending > 0 && <span className="badge badge-warning" style={{ marginLeft: 6 }}>{pending} pending</span>}</button>
      </div>
      <div className="card">
        {tab === 'users' ? <DataTable columns={userCols} data={state.users} searchPlaceholder="Search users…" />
          : state.startups.length === 0 ? <EmptyState title="No startups have registered yet">They appear here after registering or signing in with Google.</EmptyState>
          : <DataTable columns={startupCols} data={state.startups} searchPlaceholder="Search startups…" />}
      </div>

      <Modal isOpen={!!invite} onClose={() => setInvite(null)} title="Create a user" maxWidth="520px"
        footer={<><button className="btn btn-secondary" onClick={() => setInvite(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.email || !f.name || !f.designation || (needsDept && !f.departmentId)} onClick={send}>{busy ? 'Creating…' : 'Create account'}</button></>}>
        <div className="form-group"><label className="form-label" htmlFor="un">Full name</label><input id="un" className="form-control" value={f.name || ''} onChange={set('name')} /></div>
        <div className="form-group"><label className="form-label" htmlFor="ue">Email (they can also sign in with Google using it)</label><input id="ue" type="email" className="form-control" value={f.email || ''} onChange={set('email')} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <div className="form-group"><label className="form-label" htmlFor="ur">Role</label><select id="ur" className="form-control" value={f.role || 'government'} onChange={set('role')}>{['government', 'finance', 'inspector', 'admin'].map((r) => <option key={r}>{r}</option>)}</select></div>
          <div className="form-group"><label className="form-label" htmlFor="ud">Designation</label><input id="ud" className="form-control" value={f.designation || ''} onChange={set('designation')} /></div>
        </div>
        {(needsDept || f.role === 'inspector') && (
          <div className="form-group"><label className="form-label" htmlFor="ude">Department {needsDept ? '(required)' : '(optional)'}</label>
            <select id="ude" className="form-control" value={f.departmentId || ''} onChange={set('departmentId')}><option value="">Select…</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            {depts.length === 0 && needsDept && <small style={{ color: 'var(--warning-text)' }}>Create a department first.</small>}</div>
        )}
      </Modal>

      <Modal isOpen={!!secret} onClose={() => setSecret(null)} title="Temporary password" maxWidth="480px" footer={<button className="btn btn-primary" onClick={() => setSecret(null)}>I've saved it</button>}>
        <p style={{ fontSize: '.86rem' }}>Share this with <strong>{secret?.email}</strong> over a secure channel. <strong>It is shown only once</strong> — only a hash is stored. They must change it on first sign-in.</p>
        <div style={{ display: 'flex', gap: '.5rem' }}><code style={{ flex: 1, background: 'var(--slate-100)', padding: '.6rem .75rem', borderRadius: 8, fontSize: '1rem', userSelect: 'all' }}>{secret?.password}</code>
          <button className="btn btn-outline" onClick={() => { navigator.clipboard?.writeText(secret.password); toast.success('Copied'); }}><Copy size={14} /></button></div>
      </Modal>

      <Modal isOpen={!!verify} onClose={() => setVerify(null)} title={verify?.name || ''} maxWidth="560px"
        footer={verify?.verificationStatus === 'PENDING' ? <><button className="btn btn-danger" disabled={busy || (f.notes || '').trim().length < 5} onClick={() => decide('REJECTED')}>Reject</button><button className="btn btn-success" disabled={busy || (f.notes || '').trim().length < 5} onClick={() => decide('VERIFIED')}>Verify</button></> : null}>
        {verify && <>
          <dl style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '.35rem .75rem', fontSize: '.84rem', margin: 0 }}>
            {[['Founder', verify.founders], ['Email', verify.founderEmail], ['Phone', verify.phone], ['Sector', verify.sector], ['DPIIT', verify.dpiitReg], ['CIN / LLPIN', verify.cin], ['PAN (masked)', verify.pan], ['GSTIN', verify.gstin], ['Bank', verify.bankDetails.accountMasked], ['IFSC', verify.bankDetails.ifsc], ['Website', verify.website], ['Registered', verify.createdAt]].map(([k, v]) => (<React.Fragment key={k}><dt style={{ color: 'var(--slate-500)' }}>{k}</dt><dd style={{ margin: 0, wordBreak: 'break-word' }}>{v || '—'}</dd></React.Fragment>))}
          </dl>
          {verify.verificationStatus === 'PENDING'
            ? <div className="form-group" style={{ marginTop: '1rem' }}><label className="form-label" htmlFor="vn">Verification notes (min 5 characters, kept in the audit trail)</label><textarea id="vn" className="form-control" rows={3} value={f.notes || ''} onChange={set('notes')} /><small style={{ color: 'var(--slate-500)' }}>Check the DPIIT certificate and MCA/GST records before verifying.</small></div>
            : <p style={{ fontSize: '.82rem', marginTop: '1rem' }}><strong>{verify.verificationStatus}</strong> on {verify.verifiedAt}: {verify.verificationNotes}</p>}
        </>}
      </Modal>
    </div>
  );
}
