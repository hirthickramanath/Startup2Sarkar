import React from 'react';
import { useApp } from '../../../store';
import { 
  Building, Compass, FileText, CheckCircle2, 
  Clock, ArrowRight, Sparkles, TrendingUp, AlertTriangle, ShieldCheck 
} from 'lucide-react';
import { StatusBadge } from '../../common/ui';
import { DataTable } from '../../common/ui';

export function GovernmentDashboard() {
  const { state, navigate } = useApp();

  const activeChallenges = state.challenges.filter(c => c.status !== 'Closed').length;
  const totalProposals = state.proposals.length;
  const aiEvaluated = state.proposals.filter(p => p.aiEvaluationStatus === 'Completed').length;
  const activePilots = state.pilots.filter(p => p.status === 'Active').length;
  const completedPilots = state.pilots.filter(p => p.status === 'Completed').length;
  const pendingFinance = state.pilots.filter(p => p.financeStatus === 'Awaiting Finance Review').length;

  const pipelineStages = [
    { name: 'Draft', count: state.challenges.filter(c => c.status === 'Draft').length },
    { name: 'Published', count: state.challenges.filter(c => c.status === 'Published').length },
    { name: 'Proposals Received', count: state.challenges.filter(c => c.proposalsCount > 0).length },
    { name: 'AI Evaluation', count: state.challenges.filter(c => c.status === 'AI Evaluation').length },
    { name: 'Shortlisted', count: state.challenges.filter(c => c.status === 'Shortlisted').length },
    { name: 'Pilot Active', count: activePilots },
    { name: 'Completed', count: completedPilots },
    { name: 'Finance Review', count: pendingFinance }
  ];

  const columns = [
    { 
      key: 'id', 
      header: 'Challenge ID', 
      width: '130px',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--gov-navy-700)' }}>{val}</span>
    },
    { 
      key: 'title', 
      header: 'Challenge Title',
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--slate-900)' }}>{val}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--slate-500)' }}>{row.category}</div>
        </div>
      )
    },
    { key: 'department', header: 'Department' },
    { 
      key: 'proposalsCount', 
      header: 'Proposals',
      width: '90px',
      render: (val) => <span style={{ fontWeight: 700, textAlign: 'center', display: 'block' }}>{val}</span>
    },
    { 
      key: 'status', 
      header: 'Status',
      width: '140px',
      render: (val) => <StatusBadge status={val} />
    },
    { 
      key: 'actions', 
      header: 'Action',
      width: '130px',
      render: (_, row) => (
        <button 
          className="btn btn-outline btn-sm"
          onClick={() => navigate(`/government/challenges/${row.id}`)}
        >
          View Details
        </button>
      )
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Banner with Sovereign Context */}
      <div style={{
        background: 'linear-gradient(135deg, var(--gov-navy-900) 0%, var(--gov-navy-800) 100%)',
        color: 'var(--white)',
        padding: '1.5rem',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
        boxShadow: 'var(--shadow-md)'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.2)', padding: '0.15rem 0.5rem', borderRadius: 'var(--radius-xs)', textTransform: 'uppercase', fontWeight: 700 }}>
              Sovereign Procurement Console
            </span>
            <span style={{ fontSize: '0.75rem', color: '#93c5fd' }}>
              Ministry of Health & Family Welfare
            </span>
          </div>
          <h1 style={{ color: 'var(--white)', fontSize: '1.45rem', margin: 0, fontWeight: 800 }}>
            Innovation Procurement Lifecycle
          </h1>
          <p style={{ color: '#cbd5e1', fontSize: '0.85rem', margin: '0.3rem 0 0 0', maxWidth: '650px' }}>
            Drive operational problem statements into competitive startup challenges, evidence-based pilot verification, and milestone-linked scale-up disbursements.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            className="btn btn-primary"
            style={{ background: '#2563eb', borderColor: '#3b82f6' }}
            onClick={() => navigate('/government/challenges/create')}
          >
            <Sparkles size={16} />
            Create Challenge (AI Assisted)
          </button>
          <button 
            className="btn btn-outline"
            style={{ color: '#ffffff', borderColor: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)' }}
            onClick={() => navigate('/government/pilot-manager')}
          >
            AI Pilot Manager
          </button>
        </div>
      </div>

      {/* 1. Summary Metrics Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '1rem'
      }}>
        <div className="card" style={{ borderLeft: '4px solid var(--gov-navy-600)' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--slate-500)', fontWeight: 600 }}>Active Challenges</div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.25rem' }}>{activeChallenges}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--slate-500)', marginTop: '0.25rem' }}>Public Innovation Calls</div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #2563eb' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--slate-500)', fontWeight: 600 }}>Total Proposals</div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.25rem' }}>{totalProposals}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--slate-500)', marginTop: '0.25rem' }}>DPIIT Startups Bidding</div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #7c3aed' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--slate-500)', fontWeight: 600 }}>AI Evaluated</div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.25rem' }}>{aiEvaluated}</div>
          <div style={{ fontSize: '0.72rem', color: '#7c3aed', marginTop: '0.25rem' }}>8-Point Multi-Criteria</div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #059669' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--slate-500)', fontWeight: 600 }}>Active Pilots</div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.25rem' }}>{activePilots}</div>
          <div style={{ fontSize: '0.72rem', color: '#059669', marginTop: '0.25rem' }}>Field Telemetry Active</div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #15803d' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--slate-500)', fontWeight: 600 }}>Completed Pilots</div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.25rem' }}>{completedPilots}</div>
          <div style={{ fontSize: '0.72rem', color: '#15803d', marginTop: '0.25rem' }}>Ready for Scale-Up</div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #b45309' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--slate-500)', fontWeight: 600 }}>Finance Review</div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.25rem' }}>{pendingFinance}</div>
          <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: '0.25rem' }}>Validated Case Files</div>
        </div>
      </div>

      {/* 2. Challenge Pipeline Visual Step Flow */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <TrendingUp size={18} color="var(--gov-navy-600)" />
            <span>Sovereign Innovation Pipeline Flow</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--slate-500)' }}>
            Core Principle: Problem → Challenge → Startup → Evaluation → Pilot → Evidence → Validation → Finance → Scale-up
          </span>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '0.5rem',
          position: 'relative'
        }}>
          {pipelineStages.map((stage, idx) => (
            <div 
              key={stage.name} 
              style={{
                background: 'var(--slate-50)',
                border: '1px solid var(--slate-200)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.75rem',
                textAlign: 'center',
                position: 'relative'
              }}
            >
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--slate-400)', marginBottom: '0.2rem' }}>
                STAGE {idx + 1}
              </div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--slate-900)', marginBottom: '0.25rem' }}>
                {stage.name}
              </div>
              <div style={{
                display: 'inline-block',
                background: stage.count > 0 ? 'var(--gov-navy-100)' : 'var(--slate-200)',
                color: stage.count > 0 ? 'var(--gov-navy-800)' : 'var(--slate-500)',
                padding: '0.15rem 0.5rem',
                borderRadius: 'var(--radius-full)',
                fontWeight: 700,
                fontSize: '0.75rem'
              }}>
                {stage.count} {stage.count === 1 ? 'item' : 'items'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Recent Challenges & Activity Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Left: Recent Challenges Table */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <Compass size={18} color="var(--gov-navy-600)" />
              <span>Active Procurement Challenges</span>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/government/challenges')}>
              View All ({state.challenges.length})
            </button>
          </div>

          <DataTable 
            columns={columns}
            data={state.challenges}
            pageSize={5}
            searchable={false}
          />
        </div>

        {/* Right: Recent Sovereign Audit Activity */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <ShieldCheck size={18} color="var(--gov-navy-600)" />
              <span>Recent Sovereign Actions</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate('/government/audit')}>
              Full Audit
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {state.auditLogs.slice(0, 5).map(log => (
              <div 
                key={log.id} 
                style={{
                  padding: '0.65rem 0.75rem',
                  border: '1px solid var(--slate-100)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--slate-50)',
                  fontSize: '0.78rem'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                  <span style={{ fontWeight: 700, color: 'var(--slate-900)' }}>{log.action}</span>
                  <span style={{ color: 'var(--slate-400)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
                    {log.timestamp.slice(11)}
                  </span>
                </div>
                <div style={{ color: 'var(--slate-600)', marginBottom: '0.25rem', lineHeight: 1.35 }}>
                  {log.details}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--slate-500)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>By: <strong>{log.user}</strong></span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{log.entity}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
