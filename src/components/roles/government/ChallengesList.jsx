import React, { useState } from 'react';
import { useApp } from '../../../store';
import { 
  Compass, Plus, Filter, FileText, Sparkles, 
  Eye, CheckCircle2, Clock, XCircle 
} from 'lucide-react';
import { StatusBadge } from '../../common/ui';
import { DataTable } from '../../common/ui';

export function ChallengesList() {
  const { state, navigate } = useApp();
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedDept, setSelectedDept] = useState('ALL');

  const filteredChallenges = state.challenges.filter(c => {
    if (selectedStatus !== 'ALL' && c.status !== selectedStatus) return false;
    if (selectedDept !== 'ALL' && c.department !== selectedDept) return false;
    return true;
  });

  const columns = [
    { 
      key: 'id', 
      header: 'ID', 
      width: '120px',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--gov-navy-700)' }}>{val}</span>
    },
    { 
      key: 'title', 
      header: 'Challenge Title',
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--slate-900)' }}>{val}</div>
          <div style={{ fontSize: '0.74rem', color: 'var(--slate-500)' }}>{row.category} • Created: {row.createdDate}</div>
        </div>
      )
    },
    { key: 'department', header: 'Department' },
    { 
      key: 'totalBudget', 
      header: 'Budget Ceiling',
      width: '130px',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val ? `₹${val.toLocaleString('en-IN')}` : '—'}</span>
    },
    { 
      key: 'proposalsCount', 
      header: 'Bids',
      width: '80px',
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
      header: 'Actions',
      width: '180px',
      render: (_, row) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button 
            className="btn btn-outline btn-sm"
            onClick={() => navigate(`/government/challenges/${row.id}`)}
          >
            <Eye size={13} /> View
          </button>
          <button 
            className="btn btn-secondary btn-sm"
            onClick={() => navigate(`/government/challenges/${row.id}/proposals`)}
          >
            Bids ({row.proposalsCount})
          </button>
        </div>
      )
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>
            Innovation Procurement Challenges
          </h1>
          <span style={{ fontSize: '0.8rem', color: 'var(--slate-500)' }}>
            Manage active problem statements, invite startup proposals, and execute multi-criteria evaluations.
          </span>
        </div>

        <button className="btn btn-primary" onClick={() => navigate('/government/challenges/create')}>
          <Plus size={16} /> New Challenge
        </button>
      </div>

      <div className="card">
        <DataTable
          columns={columns}
          data={filteredChallenges}
          searchFields={['id', 'title', 'department', 'category']}
          searchPlaceholder="Search by ID, keyword, or ministry..."
          extraFilters={
            <>
              <select 
                className="form-control"
                value={selectedStatus}
                onChange={e => setSelectedStatus(e.target.value)}
                style={{ width: 'auto', height: '38px', fontSize: '0.82rem' }}
              >
                <option value="ALL">All Statuses</option>
                <option value="Draft">Draft</option>
                <option value="Published">Published</option>
                <option value="AI Evaluation">AI Evaluation</option>
                <option value="Shortlisted">Shortlisted</option>
                <option value="Pilot">Pilot</option>
                <option value="Completed">Completed</option>
              </select>

              <select 
                className="form-control"
                value={selectedDept}
                onChange={e => setSelectedDept(e.target.value)}
                style={{ width: 'auto', height: '38px', fontSize: '0.82rem' }}
              >
                <option value="ALL">All Ministries</option>
                <option value="Ministry of Health & Family Welfare">Health & Family Welfare</option>
                <option value="Ministry of Jal Shakti">Jal Shakti</option>
                <option value="Ministry of Road Transport & Highways">Road Transport & Highways</option>
                <option value="Ministry of Agriculture & Farmers Welfare">Agriculture & Farmers Welfare</option>
              </select>
            </>
          }
        />
      </div>
    </div>
  );
}
