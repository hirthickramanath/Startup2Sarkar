import React from 'react';
import { useApp } from '../../../store';
import { CreditCard, CheckCircle2, Clock, AlertTriangle, ShieldCheck, ArrowRight, ExternalLink } from 'lucide-react';
import { StatusBadge, inrPaise } from '../../common/ui';

export function StartupPayments() {
  const { state, navigate } = useApp();

  const myStartup = state.startups[0];
  const myPilots = state.pilots.filter(p => p.startupId === myStartup.id);
  const myPayments = state.payments.filter(p => p.startupId === myStartup.id);

  const claimOf = (m) => myPayments.find((c) => c.milestoneId === m.id && c.rawStatus !== 'REJECTED');
  const totalContract = myPilots.reduce((acc, p) => acc + p.totalBudget, 0);
  const totalReleased = myPilots.reduce((acc, p) => acc + p.fundsDisbursed, 0);
  const totalPending = totalContract - totalReleased;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>
          Milestone payments
        </h1>
        <span style={{ fontSize: '0.8rem', color: 'var(--slate-500)' }}>
          Track your claims, the statutory deductions withheld (TDS and GST-TDS), and the bank reference once a payment is recorded.</span>
      </div>

      {/* Contract Financial Health Cards (Section 30) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '1rem'
      }}>
        <div className="card">
          <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)', fontWeight: 600 }}>TOTAL SANCTIONED CONTRACT</span>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--slate-900)', marginTop: '0.2rem', fontFamily: 'var(--font-mono)' }}>
            ₹{(totalContract).toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--slate-500)' }}>Across active pilots</div>
        </div>

        <div className="card">
          <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)', fontWeight: 600 }}>FUNDS RELEASED TO BANK</span>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--success-text)', marginTop: '0.2rem', fontFamily: 'var(--font-mono)' }}>
            ₹{(totalReleased).toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--success-text)' }}>Credited via Direct Benefit Transfer</div>
        </div>

        <div className="card">
          <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)', fontWeight: 600 }}>PENDING / UNDER VERIFICATION</span>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--warning-text)', marginTop: '0.2rem', fontFamily: 'var(--font-mono)' }}>
            ₹{(totalPending).toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--warning-text)' }}>M3 under IFD review + M4 pending</div>
        </div>
      </div>

      {/* Payment Timeline Card (Section 30) */}
      <div className="card">
        <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem', marginBottom: '1.25rem' }}>
          Milestone Disbursement Timeline: {myPilots[0]?.pilotName}
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {myPilots[0]?.milestones?.map((m, idx) => (
            <div 
              key={m.id}
              style={{
                border: '1px solid var(--slate-200)',
                borderRadius: 'var(--radius-sm)',
                padding: '1rem',
                background: m.status === 'Paid' ? '#f0fdf4' : m.status === 'Under Review' ? '#eff6ff' : 'var(--slate-50)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--slate-900)' }}>{m.name}</span>
                  <StatusBadge status={m.status} size="sm" />
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--slate-600)', marginBottom: '0.25rem' }}>
                  {m.deliverable}
                </div>
                {claimOf(m)?.disbursementReference ? (
                  <div style={{ fontSize: '0.74rem', color: 'var(--success-text)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    Bank reference: {claimOf(m).disbursementReference} • Settled: {m.paidDate}
                  </div>
                ) : claimOf(m) ? (
                  <div style={{ fontSize: '0.74rem', color: '#1d4ed8', fontFamily: 'var(--font-mono)' }}>
                    Claim {claimOf(m).id} • {claimOf(m).status} • TDS {inrPaise(claimOf(m).tdsPaise)} + GST-TDS {inrPaise(claimOf(m).gstTdsPaise)} • Net payable {inrPaise(claimOf(m).netPayablePaise)}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.74rem', color: 'var(--slate-500)', fontFamily: 'var(--font-mono)' }}>
                    Scheduled Due Date: {m.dueDate}
                  </div>
                )}
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--slate-900)' }}>
                  ₹{(m.paymentAmount || m.amount || 0).toLocaleString('en-IN')}
                </div>
                <span style={{ fontSize: '0.72rem', color: m.status === 'Paid' ? 'var(--success-text)' : 'var(--slate-500)' }}>
                  {m.status === 'Paid' ? 'Gross Amount Paid' : 'Sanctioned Ceiling'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Registered Treasury Bank Details Protection Notice (Section 66) */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <ShieldCheck size={18} color="var(--gov-navy-600)" />
            <span>Registered beneficiary bank account</span>
          </div>
          <span className="badge badge-success">Verified & Active</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', fontSize: '0.84rem' }}>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)' }}>BENEFICIARY NAME</span>
            <div style={{ fontWeight: 700, color: 'var(--slate-900)' }}>{myStartup.name}</div>
          </div>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)' }}>MASKED ACCOUNT</span>
            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--slate-900)' }}>
              {myStartup.bankDetails.accountMasked}
            </div>
          </div>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)' }}>BANK & BRANCH</span>
            <div style={{ fontWeight: 600 }}>Registered bank mandate</div>
          </div>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)' }}>IFSC CODE</span>
            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{myStartup.bankDetails.ifsc}</div>
          </div>
        </div>

        <div style={{ marginTop: '1rem', borderTop: '1px solid var(--slate-100)', paddingTop: '0.75rem', fontSize: '0.75rem', color: 'var(--slate-500)' }}>
          🔒 <strong>Security Protocol:</strong> Changing bank account or IFSC details automatically flags an anomaly (ANOM-301) and places active payments on hold pending branch manager stamped endorsement.
        </div>
      </div>
    </div>
  );
}
