import React, { useState } from 'react';
import { useApp } from '../../../store';
import { 
  Compass, Search, Filter, Sparkles, Calendar, 
  Clock, ArrowRight, ShieldCheck, DollarSign 
} from 'lucide-react';
import { StatusBadge } from '../../common/ui';

export function StartupChallenges() {
  const { state, navigate } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSector, setSelectedSector] = useState('ALL');
  const [selectedDept, setSelectedDept] = useState('ALL');

  const filteredChallenges = state.challenges.filter(c => {
    if (selectedSector !== 'ALL' && c.category !== selectedSector) return false;
    if (selectedDept !== 'ALL' && c.department !== selectedDept) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      return (
        c.title.toLowerCase().includes(q) || 
        c.id.toLowerCase().includes(q) || 
        c.department.toLowerCase().includes(q) ||
        c.problemStatement.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>
          Discover Public Innovation Challenges
        </h1>
        <span style={{ fontSize: '0.8rem', color: 'var(--slate-500)' }}>
          Browse open procurement challenges published by central and state government ministries. Submit bids under General Financial Rules (GFR).
        </span>
      </div>

      {/* Search & Filter Bar */}
      <div className="card" style={{ padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
            <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--slate-400)' }} />
            <input
              type="text"
              className="form-control"
              style={{ paddingLeft: '2.25rem', height: '38px', fontSize: '0.85rem' }}
              placeholder="Search by challenge ID, title, ministry, or problem keywords..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <select
              className="form-control"
              value={selectedSector}
              onChange={e => setSelectedSector(e.target.value)}
              style={{ width: 'auto', height: '38px', fontSize: '0.82rem' }}
            >
              <option value="ALL">All Sectors</option>
              <option value="Healthcare & Diagnostics">Healthcare & Diagnostics</option>
              <option value="Water & Sanitation">Water & Sanitation</option>
              <option value="Transport & Road Safety">Transport & Road Safety</option>
              <option value="AgriTech & Remote Sensing">AgriTech & Remote Sensing</option>
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
          </div>
        </div>
      </div>

      {/* Transparency Banner */}
      <div style={{
        background: '#eff6ff',
        border: '1px solid #bfdbfe',
        borderRadius: 'var(--radius-sm)',
        padding: '0.65rem 1rem',
        fontSize: '0.78rem',
        color: '#1e40af',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }}>
        <Sparkles size={16} color="#1d4ed8" />
        <span>
          <strong>AI Matchmaking Note:</strong> Challenges tagged with "High Relevance" are computed based on your DPIIT sector empanelment. This tag is purely informational and does not guarantee bid selection.
        </span>
      </div>

      {/* Challenges Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1.25rem' }}>
        {filteredChallenges.map(c => {
          const isHighRelevance = c.category.includes('Health') || c.category.includes('Diagnostics');
          return (
            <div 
              key={c.id} 
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: isHighRelevance ? '1px solid #93c5fd' : '1px solid var(--slate-200)'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.75rem', color: 'var(--gov-navy-700)' }}>
                    {c.id}
                  </span>
                  {isHighRelevance ? (
                    <span className="badge badge-info" style={{ fontSize: '0.68rem', fontWeight: 700 }}>
                      <Sparkles size={11} /> High Relevance
                    </span>
                  ) : (
                    <StatusBadge status={c.status} size="sm" />
                  )}
                </div>

                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '0 0 0.4rem 0', color: 'var(--slate-900)' }}>
                  {c.title}
                </h3>

                <div style={{ fontSize: '0.75rem', color: 'var(--slate-500)', marginBottom: '0.75rem', fontWeight: 600 }}>
                  {c.department} • {c.category}
                </div>

                <p style={{ fontSize: '0.82rem', color: 'var(--slate-700)', lineHeight: 1.5, marginBottom: '1rem' }}>
                  {c.problemStatement.slice(0, 160)}...
                </p>

                <div style={{
                  background: 'var(--slate-50)',
                  border: '1px solid var(--slate-200)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.65rem 0.85rem',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0.5rem',
                  fontSize: '0.75rem',
                  marginBottom: '1rem'
                }}>
                  <div>
                    <span style={{ color: 'var(--slate-500)' }}>Sanctioned Budget</span>
                    <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--slate-900)' }}>
                      {c.totalBudget ? '₹' + c.totalBudget.toLocaleString('en-IN') : 'Not stated'}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--slate-500)' }}>Pilot Duration</span>
                    <div style={{ fontWeight: 700, color: 'var(--slate-900)' }}>{c.pilotDurationMonths} months</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--slate-500)' }}>Submission Deadline</span>
                    <div style={{ fontWeight: 600, color: 'var(--slate-800)' }}>{c.deadline}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--slate-500)' }}>Total Bids Received</span>
                    <div style={{ fontWeight: 600, color: 'var(--slate-800)' }}>{c.proposalsCount} Proposals</div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', borderTop: '1px solid var(--slate-100)', paddingTop: '0.75rem' }}>
                <button 
                  className="btn btn-outline btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => navigate(`/startup/challenges/${c.id}`)}
                >
                  View Details & KPIs
                </button>
                <button 
                  className="btn btn-primary btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => navigate(`/startup/proposals/create?challenge=${c.id}`)}
                >
                  Submit Proposal
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
