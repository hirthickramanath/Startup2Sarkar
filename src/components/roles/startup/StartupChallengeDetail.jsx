import React from 'react';
import { useApp } from '../../../store';
import { 
  ArrowLeft, Compass, Calendar, DollarSign, Clock, 
  FileText, CheckCircle2, ShieldCheck, Send, Sparkles 
} from 'lucide-react';
import { StatusBadge } from '../../common/ui';
import { AddendaList } from '../../common/Management';
import { ChallengeQA } from '../../common/Platform';

export function StartupChallengeDetail({ challengeId }) {
  const { state, navigate } = useApp();

  const challenge = state.challenges.find(c => c.id === challengeId);

  if (!challenge) return (
    <div className="card" style={{ maxWidth: 520, margin: '3rem auto', textAlign: 'center', padding: '2rem' }}><h2 style={{ fontSize: '1.15rem' }}>{state.loaded ? 'Challenge not found' : 'Loading…'}</h2><p style={{ color: 'var(--slate-500)', fontSize: '.85rem' }}>{state.loaded ? 'It may have been removed, or it belongs to another department.' : ''}</p></div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/startup/challenges')}>
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

        <button 
          className="btn btn-primary"
          onClick={() => navigate(`/startup/proposals/create?challenge=${challenge.id}`)}
        >
          <Send size={15} /> Submit Proposal Bid
        </button>
      </div>

      {/* Overview Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem'
      }}>
        <div className="card">
          <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)', fontWeight: 600 }}>PILOT CEILING BUDGET</span>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.2rem', fontFamily: 'var(--font-mono)' }}>
            {challenge.totalBudget ? '₹' + challenge.totalBudget.toLocaleString('en-IN') : 'Not stated'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--slate-500)' }}>Milestone payments</div>
        </div>

        <div className="card">
          <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)', fontWeight: 600 }}>DURATION</span>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.2rem' }}>
            {challenge.pilotDurationMonths} months
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--slate-500)' }}>Deployment & trial</div>
        </div>

        <div className="card">
          <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)', fontWeight: 600 }}>SUBMISSION DEADLINE</span>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.2rem' }}>
            {challenge.deadline}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--slate-500)' }}>Strict closing time</div>
        </div>

        <div className="card">
          <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)', fontWeight: 600 }}>SECTOR CATEGORY</span>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--slate-900)', marginTop: '0.2rem' }}>
            {challenge.category}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--slate-500)' }}>DPIIT empanelled</div>
        </div>
      </div>

      {/* Main Details */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="card">
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem', marginBottom: '0.85rem' }}>
              Problem Statement
            </h3>
            <p style={{ fontSize: '0.88rem', lineHeight: 1.6, color: 'var(--slate-800)' }}>
              {challenge.problemStatement}
            </p>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem', marginBottom: '0.85rem' }}>
              Desired Outcome & Target Beneficiaries
            </h3>
            <p style={{ fontSize: '0.88rem', lineHeight: 1.6, color: 'var(--slate-800)', marginBottom: '0.5rem' }}>
              {challenge.desiredOutcome}
            </p>
            <div style={{ background: 'var(--slate-50)', padding: '0.65rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
              <strong>Beneficiaries:</strong> {challenge.targetBeneficiaries}
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem', marginBottom: '0.85rem' }}>
              Mandatory Milestone KPIs
            </h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>KPI Indicator</th>
                  <th>Baseline</th>
                  <th>Contractual Target</th>
                  <th>Verification Methodology</th>
                </tr>
              </thead>
              <tbody>
                {challenge.kpis?.map((k, i) => (
                  <tr key={i}>
                    <td><strong>{k.name}</strong></td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{k.baseline}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--success-text)' }}>{k.target}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--slate-600)' }}>{k.measurementMethod}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Requirements & Action */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="card">
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem', marginBottom: '0.85rem' }}>
              Required Capabilities
            </h3>
            <ul style={{ paddingLeft: '1.25rem', fontSize: '0.82rem', color: 'var(--slate-700)', lineHeight: 1.5 }}>
              {challenge.requiredCapabilities?.map((c, i) => (
                <li key={i} style={{ marginBottom: '0.35rem' }}>{c}</li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem', marginBottom: '0.85rem' }}>
              Required Bid Documents
            </h3>
            <ul style={{ paddingLeft: '1.25rem', fontSize: '0.82rem', color: 'var(--slate-700)', lineHeight: 1.5 }}>
              {challenge.requiredDocuments?.map((d, i) => (
                <li key={i} style={{ marginBottom: '0.35rem' }}>{d}</li>
              ))}
            </ul>
          </div>

          <div className="card" style={{ background: 'var(--slate-50)' }}>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.4rem' }}>Ready to Apply?</h4>
            <p style={{ fontSize: '0.78rem', color: 'var(--slate-600)', marginBottom: '0.75rem' }}>
              Startup proposal submission includes automated AI Readiness Check to verify mandatory documents prior to final submission.
            </p>
            <button 
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => navigate(`/startup/proposals/create?challenge=${challenge.id}`)}
            >
              <Send size={15} /> Start Bid Application
            </button>
          </div>
        </div>
      </div>
      <AddendaList challengeId={challenge.id} />
      <ChallengeQA challengeId={challenge.id} role="startup" />
    </div>
  );
}
