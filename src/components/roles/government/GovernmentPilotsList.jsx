import React from 'react';
import { useApp } from '../../../store';
import { FileText, Eye, CheckCircle2, Clock, AlertTriangle, ArrowRight } from 'lucide-react';
import { StatusBadge } from '../../common/ui';
import { DataTable } from '../../common/ui';

export function GovernmentPilotsList() {
  const { state, navigate } = useApp();

  const columns = [
    { 
      key: 'id', 
      header: 'Pilot ID', 
      width: '120px',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--gov-navy-700)' }}>{val}</span>
    },
    { 
      key: 'pilotName', 
      header: 'Pilot Name',
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: 700, color: 'var(--slate-900)' }}>{val}</div>
          <div style={{ fontSize: '0.74rem', color: 'var(--slate-500)' }}>Startup: <strong>{row.startupName}</strong></div>
        </div>
      )
    },
    { key: 'department', header: 'Department' },
    { 
      key: 'progress', 
      header: 'Progress',
      width: '140px',
      render: (val) => (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginBottom: '0.2rem' }}>
            <span>Completion</span>
            <strong>{val}%</strong>
          </div>
          <div style={{ height: '6px', background: 'var(--slate-200)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${val}%`, background: val === 100 ? 'var(--success-text)' : 'var(--gov-navy-600)' }} />
          </div>
        </div>
      )
    },
    { 
      key: 'totalBudget', 
      header: 'Sanctioned Budget',
      width: '140px',
      render: (val, row) => (
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>₹{(val / 100000).toFixed(1)}L</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--slate-500)' }}>Disbursed: ₹{(row.fundsDisbursed / 100000).toFixed(1)}L</div>
        </div>
      )
    },
    { 
      key: 'status', 
      header: 'Status',
      width: '140px',
      render: (val, row) => (
        <div>
          <StatusBadge status={val} />
          {row.financeStatus && (
            <div style={{ marginTop: '0.2rem' }}>
              <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>{row.financeStatus}</span>
            </div>
          )}
        </div>
      )
    },
    { 
      key: 'actions', 
      header: 'Action',
      width: '130px',
      render: (_, row) => (
        <button 
          className="btn btn-outline btn-sm"
          onClick={() => navigate(`/government/pilots/${row.id}`)}
        >
          <Eye size={13} /> Monitor Pilot
        </button>
      )
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>
            Operational Pilot Monitoring
          </h1>
          <span style={{ fontSize: '0.8rem', color: 'var(--slate-500)' }}>
            Supervise field deployments, milestone deliverables, verified telemetry KPIs, and prepare case files for Finance.
          </span>
        </div>
      </div>

      <div className="card">
        <DataTable
          columns={columns}
          data={state.pilots}
          searchFields={['id', 'pilotName', 'startupName', 'department', 'location']}
          searchPlaceholder="Search pilots by ID, startup, or department..."
        />
      </div>
    </div>
  );
}
