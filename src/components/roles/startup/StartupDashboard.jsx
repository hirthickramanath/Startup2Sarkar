import React from 'react';
import { useApp } from '../../../store';
import { 
  Building2, Compass, FileText, CheckCircle2, 
  CreditCard, Clock, Sparkles, ArrowRight, ShieldCheck, AlertCircle 
} from 'lucide-react';
import { StatusBadge, inr, inrPaise } from '../../common/ui';

export function StartupDashboard() {
  const { state, navigate } = useApp();

  const myStartup = state.startups[0]; 
  const myProposals = state.proposals.filter(p => p.startupId === myStartup.id);
  const myPilots = state.pilots.filter(p => p.startupId === myStartup.id);
  const myPayments = state.payments.filter(p => p.startupId === myStartup.id);

  const totalContractValue = myPilots.reduce((acc, p) => acc + p.totalBudget, 0);
  const totalDisbursed = myPilots.reduce((acc, p) => acc + p.fundsDisbursed, 0);
  const totalPending = totalContractValue - totalDisbursed;
  const curMs = myPilots[0]?.milestones.find((m) => m.rawStatus !== 'PAID');
  const latestKpi = myPilots[0]?.kpiResults.find((k) => k.hasEvidence);
  const paidPaise = myPilots.reduce((a, p) => a + p.fundsDisbursedPaise, 0);
  const inReview = myPayments.filter((p) => !['PAID', 'REJECTED'].includes(p.rawStatus)).reduce((a, p) => a + p.netPayablePaise, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Banner */}
      <div style={{
        background: 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)',
        color: '#ffffff',
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
            <span style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.2)', padding: '0.15rem 0.5rem', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 700 }}>
              DPIIT Verified Innovation Entity
            </span>
            <span style={{ fontSize: '0.74rem', color: '#a7f3d0' }}>
              Reg: {myStartup.dpiitReg} • {myStartup.sector}
            </span>
          </div>
          <h1 style={{ color: '#ffffff', fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>
            {myStartup.name} Portal
          </h1>
          <p style={{ color: '#d1fae5', fontSize: '0.84rem', margin: '0.25rem 0 0 0', maxWidth: '650px' }}>
            Discover ministry innovation tenders, submit technical and cost proposals, execute field pilots with evidence telemetry, and receive verified milestone disbursements.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            className="btn btn-primary"
            style={{ background: '#ffffff', color: '#065f46', borderColor: '#ffffff' }}
            onClick={() => navigate('/startup/challenges')}
          >
            <Compass size={16} /> Discover Open Challenges
          </button>
          <button 
            className="btn btn-outline"
            style={{ color: '#ffffff', borderColor: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.1)' }}
            onClick={() => navigate('/startup/proposals')}
          >
            My Bid Tracker
          </button>
        </div>
      </div>

      {/* 1. Metric Cards (Section 20) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: '1rem'
      }}>
        <div className="card" style={{ borderLeft: '4px solid #059669' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--slate-500)', fontWeight: 600 }}>Open Challenges</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.2rem' }}>
            {state.challenges.filter(c => c.status === 'Published').length}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#059669', marginTop: '0.2rem' }}>Ministry Calls</div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #2563eb' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--slate-500)', fontWeight: 600 }}>Submitted Proposals</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.2rem' }}>
            {myProposals.length}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#2563eb', marginTop: '0.2rem' }}>Active Bids</div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #7c3aed' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--slate-500)', fontWeight: 600 }}>AI Shortlisted</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.2rem' }}>
            {myProposals.filter(p => p.status === 'Shortlisted' || p.status === 'Selected for Pilot').length}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#7c3aed', marginTop: '0.2rem' }}>Recommended</div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #10b981' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--slate-500)', fontWeight: 600 }}>Active Pilots</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.2rem' }}>
            {myPilots.filter(p => p.status === 'Active').length}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#10b981', marginTop: '0.2rem' }}>In Execution</div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #b45309' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--slate-500)', fontWeight: 600 }}>Pending Payments</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.2rem', fontFamily: 'var(--font-mono)' }}>
            ₹{(totalPending / 100000).toFixed(1)}L
          </div>
          <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: '0.2rem' }}>Milestone Claims</div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #15803d' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--slate-500)', fontWeight: 600 }}>Payments Released</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.2rem', fontFamily: 'var(--font-mono)' }}>
            ₹{(totalDisbursed / 100000).toFixed(1)}L
          </div>
          <div style={{ fontSize: '0.72rem', color: '#15803d', marginTop: '0.2rem' }}>Net of TDS / GST-TDS</div>
        </div>
      </div>

      {/* 2. Recommended Challenges with "High Relevance" indicator (Section 21) */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Sparkles size={18} color="#059669" />
            <span>AI Match: Recommended Ministry Challenges</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--slate-500)' }}>
            Informational relevance match based on your registered sector (not a procurement guarantee)
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
          {state.challenges.slice(0, 2).map(c => (
            <div 
              key={c.id} 
              style={{
                border: '1px solid var(--slate-200)',
                borderRadius: 'var(--radius-sm)',
                padding: '1rem',
                background: 'var(--slate-50)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '0.75rem'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--gov-navy-700)', fontWeight: 600 }}>{c.id}</span>
                  <span className="badge badge-success" style={{ fontSize: '0.68rem', fontWeight: 700 }}>
                    High Relevance (94%)
                  </span>
                </div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.35rem 0', color: 'var(--slate-900)' }}>
                  {c.title}
                </h4>
                <div style={{ fontSize: '0.78rem', color: 'var(--slate-600)', marginBottom: '0.5rem', lineHeight: 1.4 }}>
                  {c.problemStatement.slice(0, 140)}...
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--slate-500)' }}>
                  <span>Sanction: <strong>{c.totalBudget ? '₹' + c.totalBudget.toLocaleString('en-IN') : 'Not stated'}</strong></span>
                  <span>Duration: <strong>{c.pilotDurationMonths} months</strong></span>
                  <span>Deadline: <strong>{c.deadline}</strong></span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid var(--slate-200)', paddingTop: '0.5rem' }}>
                <button 
                  className="btn btn-outline btn-sm"
                  onClick={() => navigate(`/startup/challenges/${c.id}`)}
                >
                  View Details
                </button>
                <button 
                  className="btn btn-primary btn-sm"
                  onClick={() => navigate(`/startup/proposals/create?challenge=${c.id}`)}
                >
                  Submit Proposal
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Active Pilot Quick Workspace (Section 27) */}
      {myPilots.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <CheckCircle2 size={18} color="var(--gov-navy-600)" />
              <span>Active Pilot Workspace: {myPilots[0].pilotName}</span>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => navigate(`/startup/pilots/${myPilots[0].id}`)}>
              Open Full Workspace
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ background: 'var(--slate-50)', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)' }}>CURRENT MILESTONE</span>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', marginTop: '0.2rem' }}>
                {curMs ? curMs.name : 'All milestones paid'}
              </div>
              <span className="badge badge-info" style={{ marginTop: '0.35rem' }}>{curMs ? curMs.status : 'Completed'}</span>
            </div>

            <div style={{ background: 'var(--slate-50)', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)' }}>LATEST KPI TELEMETRY</span>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', marginTop: '0.2rem' }}>
                {latestKpi ? `${latestKpi.metric}: ${latestKpi.current} (target ${latestKpi.target})` : 'No KPI evidence submitted yet'}
              </div>
              <span className="badge badge-neutral" style={{ marginTop: '0.35rem' }}>{latestKpi ? latestKpi.status : '—'}</span>
            </div>

            <div style={{ background: 'var(--slate-50)', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)' }}>DISBURSEMENT STATUS</span>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', marginTop: '0.2rem', fontFamily: 'var(--font-mono)' }}>
                {inrPaise(paidPaise)} credited / {inrPaise(inReview)} in review
              </div>
              <span className="badge badge-neutral" style={{ marginTop: '0.35rem' }}>Contract value: {inr(totalContractValue)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
