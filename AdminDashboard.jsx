import React, { useEffect, useState } from 'react';
import { useApp } from '../../../store';
import { adminApi } from '../../../api';
import { Users, Building2, ShieldCheck, ShieldAlert, Cpu, Rocket } from 'lucide-react';
import { PageHeader } from '../../common/ui';

const Stat = ({ icon: Icon, label, value, color = '#2563eb', onClick, sub }) => (
  <div className="card" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default', display: 'flex', gap: '.75rem', alignItems: 'center' }}>
    <span style={{ width: 42, height: 42, borderRadius: 10, display: 'grid', placeItems: 'center', background: `${color}1a` }}><Icon size={20} color={color} /></span>
    <div><div style={{ fontSize: '1.4rem', fontWeight: 800, lineHeight: 1.1 }}>{value}</div><div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{label}</div>{sub && <div style={{ fontSize: '.7rem', color: 'var(--slate-400)' }}>{sub}</div>}</div>
  </div>
);

export function AdminDashboard() {
  const { state, navigate } = useApp();
  const [dash, setDash] = useState(null);
  const [ai, setAi] = useState(null);
  useEffect(() => { adminApi.dashboard().then(setDash).catch(() => {}); adminApi.ai().then(setAi).catch(() => {}); }, [state.loaded]);

  const byRole = (r) => state.users.filter((u) => u.role === r).length;
  const pending = state.startups.filter((s) => s.verificationStatus === 'PENDING').length;
  const chain = dash?.systemHealth;
  const intact = chain?.auditChainIntegrity === 'VALID_UNBROKEN';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Platform operations" subtitle="Live counts from the database." />
      {state.users.length <= 1 && state.departments.length === 0 && (
        <div className="card" style={{ background: 'var(--info-bg)', borderColor: 'var(--info-border)', fontSize: '.88rem' }}>
          <strong>Getting started.</strong> The platform is empty. 1) Create a department and set its budget. 2) Invite government, finance and inspector users. 3) Startups register themselves (or sign in with Google) and wait for your verification.
          <div style={{ marginTop: '.6rem', display: 'flex', gap: '.5rem' }}>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/admin/departments')}>Create a department</button>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/admin/users')}>Invite users</button>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: '1rem' }}>
        <Stat icon={Users} label="Users" value={state.users.length} sub={`${byRole('government')} gov • ${byRole('finance')} fin • ${byRole('inspector')} insp • ${byRole('startup')} startup`} onClick={() => navigate('/admin/users')} />
        <Stat icon={Rocket} label="Startups awaiting verification" value={pending} color={pending ? '#b45309' : '#15803d'} onClick={() => navigate('/admin/users')} />
        <Stat icon={Building2} label="Departments" value={state.departments.length} color="#7c3aed" onClick={() => navigate('/admin/departments')} />
        <Stat icon={intact ? ShieldCheck : ShieldAlert} label="Audit chain" value={chain ? (intact ? 'Intact' : 'BROKEN') : '…'} color={intact ? '#15803d' : '#b91c1c'} sub={chain ? `${chain.totalAuditEntries} entries verified` : undefined} onClick={() => navigate('/admin/audit')} />
        <Stat icon={Cpu} label="AI engine" value={ai ? (ai.llmConfigured ? 'Gemini' : 'Local rules') : '…'} sub={ai?.model} color="#0f766e" onClick={() => navigate('/admin/ai')} />
      </div>
      {dash && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '1rem' }}>
          {[['Challenges by status', dash.challengeDistribution, 'status'], ['Pilots by status', dash.pilotDistribution, 'status'], ['Startups by verification', dash.organizationDistribution, 'verification_status']].map(([title, rows, key]) => (
            <div key={title} className="card"><h3 style={{ fontSize: '.9rem', marginTop: 0 }}>{title}</h3>
              {rows.length === 0 ? <span style={{ fontSize: '.8rem', color: 'var(--slate-500)' }}>No data yet.</span> : rows.map((r) => <div key={r[key]} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.84rem', padding: '.15rem 0' }}><span>{String(r[key]).replace(/_/g, ' ')}</span><strong>{r.count}</strong></div>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
