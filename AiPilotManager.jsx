import React, { useState, useMemo } from 'react';
import { useApp } from '../../../store';
import { Sparkles, CheckCircle2, AlertTriangle, ShieldCheck, Check, Cpu } from 'lucide-react';
import { ConfirmationDialog, PageHeader, EmptyState, StatusBadge, useBusy, inr } from '../../common/ui';

const DIMS = [
  ['alignment', 'Problem alignment'], ['feasibility', 'Technical feasibility'], ['impact', 'Expected impact'], ['evidence', 'Evidence strength'],
  ['readiness', 'Deployment readiness'], ['cost', 'Cost feasibility'],
];
const bar = (n) => (n >= 75 ? 'var(--success-text)' : n >= 50 ? '#2563eb' : '#b45309');

export function AiPilotManager() {
  const { state, query, approveShortlist, evaluateProposalsAI, navigate } = useApp();
  const withBids = useMemo(() => state.challenges.filter((c) => state.proposals.some((p) => p.challengeId === c.id)), [state.challenges, state.proposals]);
  const [pick, setPick] = useState(query.get('challenge') || '');
  const challenge = state.challenges.find((c) => c.id === (pick || withBids[0]?.id));
  const proposals = state.proposals.filter((p) => p.challengeId === challenge?.id);
  const ranked = [...proposals].sort((a, b) => (b.aiScore ?? -1) - (a.aiScore ?? -1));
  const [target, setTarget] = useState(null);
  const [busy, run] = useBusy();
  const alreadySelected = proposals.some((p) => p.rawStatus === 'SELECTED');
  const evaluable = proposals.some((p) => ['SUBMITTED', 'UNDER_REVIEW', 'AI_EVALUATED'].includes(p.rawStatus));

  const confirm = async (remarks) => {
    await approveShortlist(challenge.id, target.startupId, remarks);
    navigate('/government/pilots');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader
        title="Proposal evaluation & selection"
        subtitle="AI scoring is advisory. Every proposal stays visible; a named officer selects and records a written reason."
        actions={withBids.length > 0 && (
          <select className="form-control" aria-label="Challenge" value={challenge?.id || ''} onChange={(e) => setPick(e.target.value)} style={{ minWidth: 260 }}>
            {withBids.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
      />

      <div className="card" style={{ background: 'var(--warning-bg)', borderColor: 'var(--warning-border)', display: 'flex', gap: '.7rem', fontSize: '.82rem', color: '#92400e' }}>
        <ShieldCheck size={20} style={{ flexShrink: 0 }} />
        <span>Labels read <em>AI recommended</em>, never “winner”. Scores come from the text and figures each startup submitted — they are not field-verified. Selection is written to the audit trail with your name, remarks and timestamp.</span>
      </div>

      {!challenge ? (
        <EmptyState title="No proposals to evaluate yet">Once startups submit proposals to one of your published challenges, they appear here.</EmptyState>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.75rem' }}>
            <h2 style={{ fontSize: '1.1rem', margin: 0 }}>{proposals.length} proposal(s) <span style={{ color: 'var(--slate-500)', fontWeight: 500, fontSize: '.85rem' }}>• budget ceiling {challenge.totalBudget ? inr(challenge.totalBudget) : 'not set'}</span></h2>
            {evaluable && <button className="btn btn-primary" disabled={busy} onClick={() => run(() => evaluateProposalsAI(challenge.id))}><Cpu size={15} /> {busy ? 'Evaluating…' : proposals.some((p) => p.aiScore != null) ? 'Re-run advisory evaluation' : 'Run advisory evaluation'}</button>}
          </div>
          {alreadySelected && <div className="card" style={{ background: 'var(--success-bg)', borderColor: 'var(--success-border)', fontSize: '.85rem' }}>A startup has already been selected for this challenge. <button className="auth-link" style={{ color: 'var(--info-text)' }} onClick={() => navigate('/government/pilots')}>View pilots</button></div>}

          {ranked.map((p, i) => (
            <div key={p.id} className="card" style={{ border: i === 0 && p.aiScore != null ? '2px solid var(--gov-navy-600)' : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', borderBottom: '1px solid var(--slate-100)', paddingBottom: '.75rem', marginBottom: '1rem' }}>
                <div>
                  <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {p.aiScore != null && <span className="badge badge-neutral">Rank #{i + 1}</span>}
                    <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{p.startupName}</h3>
                    {p.isRecommendedTop3 && <span className="badge badge-success">AI recommended</span>}
                    <StatusBadge status={p.status} size="sm" />
                  </div>
                  <div style={{ fontSize: '.85rem', color: 'var(--slate-700)', marginTop: 4 }}>{p.solutionTitle}</div>
                  <div style={{ fontSize: '.76rem', color: 'var(--slate-500)', marginTop: 2 }}>Pilot cost {inr(p.cost)} • Scale-up {inr(p.scaleupCost)} • {p.implementationTimeline}</div>
                </div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '.7rem', color: 'var(--slate-500)', textTransform: 'uppercase', fontWeight: 700 }}>Advisory score</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{p.aiScore != null ? `${p.aiScore}/100` : '—'}</div>
                  </div>
                  <button className="btn btn-primary" disabled={alreadySelected || !['SUBMITTED', 'UNDER_REVIEW', 'AI_EVALUATED'].includes(p.rawStatus)} onClick={() => setTarget(p)}><CheckCircle2 size={16} /> Select for pilot</button>
                </div>
              </div>

              {p.scores ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '.75rem', background: 'var(--slate-50)', padding: '.85rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
                    {[...DIMS.map(([k, l]) => [l, p.scores[k]]), ['Risk (lower is better)', p.scores.risk, true]].map(([label, n, risk]) => (
                      <div key={label}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.72rem', color: 'var(--slate-600)', marginBottom: '.2rem' }}><span>{label}</span><strong>{n}</strong></div>
                        <div style={{ height: 5, background: 'var(--slate-200)', borderRadius: 3, overflow: 'hidden' }}><div style={{ height: '100%', width: `${n}%`, background: risk ? (n <= 30 ? 'var(--success-text)' : n <= 55 ? '#b45309' : 'var(--danger-text)') : bar(n) }} /></div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '1rem' }}>
                    <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-border)', borderRadius: 8, padding: '.75rem' }}>
                      <div style={{ color: 'var(--success-text)', fontWeight: 700, fontSize: '.82rem', marginBottom: '.35rem', display: 'flex', gap: '.35rem', alignItems: 'center' }}><Check size={14} /> Strengths noted</div>
                      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '.78rem', lineHeight: 1.45 }}>{p.whyRecommended.map((w, j) => <li key={j}>{w}</li>)}</ul>
                    </div>
                    <div style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 8, padding: '.75rem' }}>
                      <div style={{ color: 'var(--warning-text)', fontWeight: 700, fontSize: '.82rem', marginBottom: '.35rem', display: 'flex', gap: '.35rem', alignItems: 'center' }}><AlertTriangle size={14} /> Concerns & gaps</div>
                      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '.78rem', lineHeight: 1.45 }}>{p.concerns.length ? p.concerns.map((c, j) => <li key={j}>{c}</li>) : <li>None detected from the submitted text.</li>}</ul>
                    </div>
                  </div>
                  <p style={{ fontSize: '.72rem', color: 'var(--slate-500)', marginBottom: 0 }}><Sparkles size={11} /> {p.limitations[0]} {p.aiModel && `(${p.aiModel})`}</p>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--slate-500)' }}>Not yet evaluated. Run the advisory evaluation, or review the proposal yourself — scoring is optional.</p>
              )}
              <details style={{ marginTop: '.75rem', fontSize: '.82rem' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Read the full proposal</summary>
                <p><strong>Fit:</strong> {p.summary}</p><p><strong>Technical approach:</strong> {p.technicalApproach}</p><p><strong>Deployment plan:</strong> {p.deploymentPlan}</p>
                {p.evidenceDeployments.length > 0 && <p><strong>Prior deployments:</strong> {p.evidenceDeployments.join('; ')}</p>}
                {p.certifications.length > 0 && <p><strong>Certifications:</strong> {p.certifications.join('; ')}</p>}
              </details>
            </div>
          ))}
        </>
      )}

      <ConfirmationDialog
        isOpen={!!target} onClose={() => setTarget(null)} onConfirm={confirm}
        title="Official startup selection" confirmLabel="Confirm selection & create pilot"
        message={`You are selecting ${target?.startupName} for “${challenge?.title}”. A pilot with milestones and KPIs will be created, and the other open proposals will be marked not shortlisted.`}
        remarksPlaceholder="Written justification for this selection (min 10 characters)…"
      />
    </div>
  );
}
