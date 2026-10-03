import React, { useState } from 'react';
import { useApp } from '../../../store';
import { 
  ArrowLeft, Compass, Calendar, DollarSign, Clock, 
  FileText, Sparkles, CheckCircle2, AlertTriangle, Printer, Layers 
} from 'lucide-react';
import { StatusBadge } from '../../common/ui';
import { ChallengeActions } from '../../common/Management';
import { ChallengeQA, DuplicateChallenge } from '../../common/Platform';

export function ChallengeDetail({ challengeId }) {
  const { state, navigate, evaluateProposalsAI, closeChallenge } = useApp();
  const [isEvaluating, setIsEvaluating] = useState(false);

  const challenge = state.challenges.find(c => c.id === challengeId);
  const proposals = state.proposals.filter(p => p.challengeId === challenge?.id);

  const handleRunAiEvaluation = async () => {
    setIsEvaluating(true);
    try {
      await evaluateProposalsAI(challenge.id);
      navigate(`/government/pilot-manager?challenge=${challenge.id}`);
    } catch { /* the store already showed the reason as a toast */ } finally { setIsEvaluating(false); }
  };

  if (!challenge) return (
    <div className="card" style={{ maxWidth: 520, margin: '3rem auto', textAlign: 'center', padding: '2rem' }}><h2 style={{ fontSize: '1.15rem' }}>{state.loaded ? 'Challenge not found' : 'Loading…'}</h2><p style={{ color: 'var(--slate-500)', fontSize: '.85rem' }}>{state.loaded ? 'It may have been removed, or it belongs to another department.' : ''}</p></div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/government/challenges')}>
            <ArrowLeft size={14} /> Back
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--gov-navy-700)' }}>
                {challenge.id}
              </span>
              <StatusBadge status={challenge.status} />
              <span style={{ fontSize: '0.75rem', color: 'var(--slate-500)' }}>
                {challenge.department}
              </span>
            </div>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0 }}>
              {challenge.title}
            </h1>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button 
            className="btn btn-secondary btn-sm"
            onClick={() => window.print()}
          >
            <Printer size={14} /> Export RFP
          </button>
          <button 
            className="btn btn-outline btn-sm"
            onClick={() => navigate(`/government/challenges/${challenge.id}/proposals`)}
          >
            <FileText size={14} /> View Proposals ({proposals.length})
          </button>
          <button 
            className="btn btn-primary btn-sm"
            onClick={handleRunAiEvaluation}
            disabled={isEvaluating}
          >
            <Sparkles size={14} />
            {isEvaluating ? 'Evaluating Multi-Criteria...' : 'Run AI Evaluation'}
          </button>
        </div>
      </div>

      {/* Overview Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem'
      }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--slate-500)', fontSize: '0.75rem', fontWeight: 600 }}>
            <DollarSign size={15} /> Budget ceiling
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.35rem' }}>
            {challenge.totalBudget ? `₹${challenge.totalBudget.toLocaleString('en-IN')}` : 'Not stated'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--slate-500)', marginTop: '0.2rem' }}>
            Milestone disbursements
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--slate-500)', fontSize: '0.75rem', fontWeight: 600 }}>
            <Clock size={15} /> Pilot Execution Duration
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.35rem' }}>
            {challenge.pilotDurationMonths} months
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--slate-500)', marginTop: '0.2rem' }}>
            Field validation phase
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--slate-500)', fontSize: '0.75rem', fontWeight: 600 }}>
            <Calendar size={15} /> Submission Deadline
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.35rem' }}>
            {challenge.deadline}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--slate-500)', marginTop: '0.2rem' }}>
            Public bid portal closes
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--slate-500)', fontSize: '0.75rem', fontWeight: 600 }}>
            <Layers size={15} /> Submitted Bids
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.35rem' }}>
            {proposals.length} Startups
          </div>
          <div style={{ fontSize: '0.72rem', color: '#2563eb', marginTop: '0.2rem' }}>
            {proposals.filter(p => p.aiEvaluationStatus === 'Completed').length} Evaluated
          </div>
        </div>
      </div>

      {/* Main Details Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
        {/* Left: Detailed Specs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="card">
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem', marginBottom: '0.85rem' }}>
              Operational Problem Statement
            </h3>
            <p style={{ fontSize: '0.88rem', lineHeight: 1.6, color: 'var(--slate-800)' }}>
              {challenge.problemStatement}
            </p>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem', marginBottom: '0.85rem' }}>
              Desired Outcome & Target Beneficiaries
            </h3>
            <p style={{ fontSize: '0.88rem', lineHeight: 1.6, color: 'var(--slate-800)', marginBottom: '0.75rem' }}>
              {challenge.desiredOutcome}
            </p>
            <div style={{ fontSize: '0.82rem', background: 'var(--slate-50)', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-sm)' }}>
              <strong>Beneficiaries:</strong> {challenge.targetBeneficiaries}
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem', marginBottom: '0.85rem' }}>
              Required Technical Capabilities
            </h3>
            <ul style={{ paddingLeft: '1.25rem', fontSize: '0.86rem', color: 'var(--slate-800)', lineHeight: 1.6 }}>
              {challenge.requiredCapabilities?.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem', marginBottom: '0.85rem' }}>
              Measurable Milestone KPIs
            </h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>KPI Name</th>
                  <th>Baseline</th>
                  <th>Target</th>
                  <th>Measurement Method</th>
                </tr>
              </thead>
              <tbody>
                {challenge.kpis?.map((k, i) => (
                  <tr key={i}>
                    <td><strong>{k.name}</strong></td>
                    <td>{k.baseline}</td>
                    <td><span style={{ color: 'var(--success-text)', fontWeight: 700 }}>{k.target}</span></td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--slate-600)' }}>{k.measurementMethod || k.measurement_method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Constraints & Evaluation Criteria */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="card">
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem', marginBottom: '0.85rem' }}>
              Evaluation Weighting Criteria
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {challenge.evaluationCriteria?.map((ec, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--slate-700)' }}>{ec.criterion}</span>
                  <strong style={{ color: 'var(--gov-navy-800)', fontFamily: 'var(--font-mono)' }}>{ec.weight}%</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem', marginBottom: '0.85rem' }}>
              Deployment Constraints
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--slate-700)', lineHeight: 1.5 }}>
              {challenge.constraints}
            </p>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem', marginBottom: '0.85rem' }}>
              Risk Considerations
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--slate-700)', lineHeight: 1.5 }}>
              {challenge.riskConsiderations.length === 0 ? 'None recorded.' : challenge.riskConsiderations.map((r, i) => (typeof r === 'string' ? r : `${r.risk} (${r.severity}) — ${r.mitigation}`)).join(' • ')}
            </p>
          </div>

          <div className="card" style={{ background: 'var(--slate-50)' }}>
            <h4 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.5rem' }}>Administrative Control</h4>
            <button 
              className="btn btn-danger btn-sm" 
              style={{ width: '100%' }}
              onClick={() => {
                if (confirm("Are you sure you want to close this challenge to new proposals?")) {
                  closeChallenge(challenge.id);
                }
              }}
            >
              Close Challenge Submissions
            </button>
          </div>
        </div>
      </div>
      <ChallengeActions challenge={challenge} />
      <ChallengeQA challengeId={challenge.id} role="government" />
      <div><DuplicateChallenge challengeId={challenge.id} /></div>
    </div>
  );
}
