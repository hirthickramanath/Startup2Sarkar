import React, { useState } from 'react';
import { useApp } from '../../../store';
import { ShieldCheck, Filter, Download, Lock } from 'lucide-react';
import { AuditTimeline } from '../../common/ui';
import { DataTable } from '../../common/ui';

export function GovernmentAudit() {
  const { state } = useApp();
  const [viewMode, setViewMode] = useState('timeline'); // 'timeline' | 'table'

  const columns = [
    { 
      key: 'id', 
      header: 'Audit ID', 
      width: '110px',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val}</span>
    },
    { 
      key: 'timestamp', 
      header: 'Timestamp (IST)',
      width: '160px',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{val}</span>
    },
    { 
      key: 'action', 
      header: 'Executive Action',
      render: (val) => <strong style={{ color: 'var(--slate-900)' }}>{val}</strong>
    },
    { 
      key: 'entity', 
      header: 'Entity Ref',
      width: '120px',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', background: 'var(--slate-100)', padding: '0.15rem 0.4rem', borderRadius: '3px', fontSize: '0.75rem' }}>{val}</span>
    },
    { 
      key: 'user', 
      header: 'Actor (User / Role)',
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{val}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--slate-500)' }}>{row.role}</div>
        </div>
      )
    },
    { 
      key: 'details', 
      header: 'Audit Trail Details / Remarks',
      render: (val) => <span style={{ fontSize: '0.8rem', color: 'var(--slate-700)' }}>{val}</span>
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>
            Sovereign Procurement Audit Trail
          </h1>
          <span style={{ fontSize: '0.8rem', color: 'var(--slate-500)' }}>
            Immutable, append-only historical log of all sovereign actions, AI advisory prompts, evaluations, and financial transmissions.
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button 
            className={`btn btn-${viewMode === 'timeline' ? 'primary' : 'secondary'} btn-sm`}
            onClick={() => setViewMode('timeline')}
          >
            Chronological Timeline
          </button>
          <button 
            className={`btn btn-${viewMode === 'table' ? 'primary' : 'secondary'} btn-sm`}
            onClick={() => setViewMode('table')}
          >
            Audit Table View
          </button>
          <button 
            className="btn btn-outline btn-sm"
            onClick={() => window.print()}
          >
            <Download size={14} /> Export Immutable Log
          </button>
        </div>
      </div>

      {/* Immutability Guarantee Notice */}
      <div style={{
        background: '#f8fafc',
        border: '1px solid var(--slate-200)',
        borderLeft: '4px solid var(--gov-navy-800)',
        padding: '0.75rem 1rem',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem'
      }}>
        <Lock size={18} color="var(--gov-navy-800)" />
        <div style={{ fontSize: '0.8rem', color: 'var(--slate-700)' }}>
          <strong>Immutable Record Notice:</strong> Historical audit entries are cryptographically hashed and cannot be altered or removed from the user interface by any role, including Super Admin.
        </div>
      </div>

      <div className="card">
        {viewMode === 'timeline' ? (
          <AuditTimeline logs={state.auditLogs} />
        ) : (
          <DataTable
            columns={columns}
            data={state.auditLogs}
            searchFields={['action', 'entity', 'user', 'details']}
            searchPlaceholder="Search audit events by action, entity ID, or officer name..."
            pageSize={10}
          />
        )}
      </div>
    </div>
  );
}
