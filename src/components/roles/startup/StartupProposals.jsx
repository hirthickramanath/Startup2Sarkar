import React, { useState } from 'react';
import { useApp } from '../../../store';
import { 
  FileText, CheckCircle2, Clock, AlertTriangle, 
  Eye, ArrowRight, Shield, Sparkles, Lock 
} from 'lucide-react';
import { StatusBadge } from '../../common/ui';
import { DataTable } from '../../common/ui';
import { WithdrawProposal } from '../../common/Management';

export function StartupProposals() {
  const { state, navigate } = useApp();
  const [selectedProposal, setSelectedProposal] = useState(null);

  const myStartup = state.startups[0];
  const myProposals = state.proposals.filter(p => p.startupId === myStartup.id);

  const columns = [
    { 
      key: 'id', 
      header: 'Proposal ID', 
      width: '130px',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--gov-navy-700)' }}>{val}</span>
    },
    { 
      key: 'challengeId', 
      header: 'Responding Challenge',
      render: (val) => {
        const ch = state.challenges.find(c => c.id === val);
        return (
          <div>
            <div style={{ fontWeight: 700, color: 'var(--slate-900)' }}>{ch?.title || val}</div>
            <div style={{ fontSize: '0.74rem', color: 'var(--slate-500)', fontFamily: 'var(--font-mono)' }}>{val} • {ch?.department}</div>
          </div>
        );
      }
    },
    { 
      key: 'submissionDate', 
      header: 'Submitted On',
      width: '130px',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{val}</span>
    },
    { 
      key: 'cost', 
      header: 'Bid Value',
      width: '130px',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>₹{Number(val || 0).toLocaleString('en-IN')}</span>
    },
    { 
      key: 'status', 
      header: 'Government Decision',
      width: '160px',
      render: (val) => <StatusBadge status={val} />
    },
    { 
      key: 'actions', 
      header: 'Action',
      width: '150px',
      render: (_, row) => (
        <button 
          className="btn btn-outline btn-sm"
          onClick={() => setSelectedProposal(row)}
        >
          <Eye size={13} /> View AI Feedback
        </button>
      )
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>
          Proposal Submission & Evaluation Tracking
        </h1>
        <span style={{ fontSize: '0.8rem', color: 'var(--slate-500)' }}>
          Track the status of your submitted competitive innovation proposals across ministries.
        </span>
      </div>

      <div className="card">
        <DataTable
          columns={columns}
          data={myProposals}
          searchFields={['id', 'challengeId', 'solutionTitle']}
          searchPlaceholder="Search your bids..."
        />
      </div>

      {/* Limited AI Evaluation Summary Modal (Section 26) */}
      {selectedProposal && (
        <div className="modal-backdrop" onClick={() => setSelectedProposal(null)}>
          <div className="modal-dialog" style={{ maxWidth: '680px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                  Authorized Proposal Evaluation Summary
                </h3>
                <span style={{ fontSize: '0.74rem', color: 'var(--slate-500)' }}>
                  Proposal: {selectedProposal.id} • {selectedProposal.solutionTitle.slice(0, 40)}...
                </span>
              </div>
              <button 
                type="button" 
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedProposal(null)}
              >
                Close
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Privacy Notice: No Confidential Evaluator Notes */}
              <div style={{
                background: '#f8fafc',
                border: '1px solid var(--slate-200)',
                padding: '0.65rem 0.85rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.76rem',
                color: 'var(--slate-600)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <Lock size={14} color="var(--slate-500)" />
                <span>
                  <strong>Data Privacy Disclosure:</strong> Showing authorized high-level AI evaluation dimensions. Confidential government evaluator deliberations and internal officer notes are strictly restricted.
                </span>
              </div>

              {selectedProposal.whyRecommended?.length > 0 ? (
                <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--success-text)', fontSize: '0.82rem', marginBottom: '0.35rem' }}>Strengths noted in the advisory review</div>
                  <ul style={{ paddingLeft: '1.25rem', fontSize: '0.78rem', margin: 0, lineHeight: 1.45 }}>{selectedProposal.whyRecommended.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
              ) : (
                <div style={{ fontSize: '0.82rem', color: 'var(--slate-500)' }}>No advisory review has been run on this proposal yet.</div>
              )}

              {/* Identified Concerns */}
              {selectedProposal.concerns?.length > 0 && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--warning-text)', fontSize: '0.82rem', marginBottom: '0.35rem' }}>
                    Constructive Feedback for Improvement
                  </div>
                  <ul style={{ paddingLeft: '1.25rem', color: '#92400e', fontSize: '0.78rem', margin: 0, lineHeight: 1.45 }}>
                    {selectedProposal.concerns.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedProposal.status === 'Selected for Pilot' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button 
                    className="btn btn-primary"
                    onClick={() => {
                      setSelectedProposal(null);
                      navigate('/startup/pilots');
                    }}
                  >
                    Go to Pilot Workspace →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <WithdrawProposal />
    </div>
  );
}
