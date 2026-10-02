import React, { useState } from 'react';
import { useApp } from '../../../store';
import { ArrowLeft, GitCompare } from 'lucide-react';
import { StatusBadge, Modal, EmptyState, inr } from '../../common/ui';

const ROWS = [
  ['Advisory score', (p) => (p.aiScore != null ? `${p.aiScore}/100` : 'not evaluated')],
  ['Pilot cost', (p) => inr(p.cost)], ['Scale-up cost', (p) => inr(p.scaleupCost)], ['Timeline', (p) => p.implementationTimeline],
  ['Prior deployments', (p) => (p.evidenceDeployments.length ? p.evidenceDeployments.join('; ') : 'none listed')],
  ['Certifications', (p) => (p.certifications.length ? p.certifications.join('; ') : 'none listed')],
  ['Concerns noted', (p) => (p.concerns.length ? p.concerns.join('; ') : '—')],
];

export function ProposalsList({ challengeId }) {
  const { state, navigate } = useApp();
  const challenge = state.challenges.find((c) => c.id === challengeId);
  const [picked, setPicked] = useState([]);
  const [compare, setCompare] = useState(false);
  if (!challenge) return <EmptyState title={state.loaded ? 'Challenge not found' : 'Loading…'}>{state.loaded ? 'It may belong to another department.' : ''}</EmptyState>;
  const proposals = state.proposals.filter((p) => p.challengeId === challenge.id);
  const toggle = (id) => setPicked((x) => (x.includes(id) ? x.filter((i) => i !== id) : x.length >= 3 ? x : [...x, id]));
  const chosen = proposals.filter((p) => picked.includes(p.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/government/challenges/${challenge.id}`)}><ArrowLeft size={14} /> Back</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0 }}>Proposals ({proposals.length})</h1>
          <span style={{ fontSize: '.8rem', color: 'var(--slate-500)' }}>{challenge.title}</span>
        </div>
        <button className="btn btn-outline" disabled={chosen.length < 2} onClick={() => setCompare(true)}><GitCompare size={15} /> Compare selected ({chosen.length})</button>
        <button className="btn btn-primary" onClick={() => navigate(`/government/pilot-manager?challenge=${challenge.id}`)}>Evaluate & select</button>
      </div>
      {proposals.length === 0 ? <EmptyState title="No proposals yet">Verified startups can bid until {challenge.deadline || 'the deadline'}.</EmptyState> : (
        <div className="card table-container">
          <table className="data-table">
            <thead><tr><th style={{ width: 40 }} /><th>Startup / solution</th><th>Pilot cost</th><th>Advisory score</th><th>Status</th></tr></thead>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.id}>
                  <td><input type="checkbox" aria-label={`Select ${p.startupName} to compare`} checked={picked.includes(p.id)} onChange={() => toggle(p.id)} /></td>
                  <td><strong>{p.startupName}</strong><div style={{ fontSize: '.78rem', color: 'var(--slate-600)' }}>{p.solutionTitle}</div><div style={{ fontSize: '.72rem', color: 'var(--slate-400)' }}>{p.id} • submitted {p.submissionDate}</div></td>
                  <td>{inr(p.cost)}</td>
                  <td>{p.aiScore != null ? <>{p.aiScore}/100 {p.isRecommendedTop3 && <span className="badge badge-success">AI recommended</span>}</> : <span style={{ color: 'var(--slate-400)' }}>—</span>}</td>
                  <td><StatusBadge status={p.status} size="sm" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal isOpen={compare} onClose={() => setCompare(false)} title="Side-by-side comparison" maxWidth="900px">
        <div className="table-container"><table className="data-table">
          <thead><tr><th /> {chosen.map((p) => <th key={p.id}>{p.startupName}<div style={{ fontWeight: 400, fontSize: '.74rem' }}>{p.solutionTitle}</div></th>)}</tr></thead>
          <tbody>{ROWS.map(([label, fn]) => <tr key={label}><td><strong>{label}</strong></td>{chosen.map((p) => <td key={p.id} style={{ fontSize: '.82rem' }}>{fn(p)}</td>)}</tr>)}</tbody>
        </table></div>
        <p style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>Scores are advisory and computed from submitted text; they are not field-verified.</p>
      </Modal>
    </div>
  );
}
