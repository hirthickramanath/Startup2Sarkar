import React, { useState, useMemo } from 'react';
import { useApp } from '../../../store';
import { ArrowLeft, CheckCircle2, AlertTriangle, Send, ShieldAlert } from 'lucide-react';
import { useBusy, inr } from '../../common/ui';

// Minimum lengths mirror the server-side validation so the founder sees problems before submitting.
const FIELDS = [
  { key: 'solutionTitle', label: 'Solution title', min: 5, type: 'input', hint: 'A short, specific name for your solution.' },
  { key: 'summary', label: 'How does your solution fit the problem?', min: 20, type: 'area', hint: 'Explain, in plain language, what problem you solve and why your approach works.' },
  { key: 'technicalApproach', label: 'Technical approach', min: 20, type: 'area', hint: 'Architecture, hardware/software, data flow, security, integrations.' },
  { key: 'deploymentPlan', label: 'Deployment plan', min: 10, type: 'area', hint: 'Sites, rollout sequence, training, support.' },
  { key: 'timeline', label: 'Implementation timeline', min: 5, type: 'input', hint: 'e.g. “Month 1 setup; months 2–3 field trial; month 4 evaluation”.' },
];

export function ProposalCreate() {
  const { state, query, submitProposal, navigate } = useApp();
  const myStartup = state.startups[0];
  const open = useMemo(() => state.challenges.filter((c) => ['PUBLISHED', 'PROPOSALS_RECEIVED'].includes(c.rawStatus)), [state.challenges]);
  const [challengeId, setChallengeId] = useState(query.get('challenge') || '');
  const challenge = open.find((c) => c.id === challengeId);
  const [busy, run] = useBusy();
  const [form, setForm] = useState({ solutionTitle: '', summary: '', technicalApproach: '', deploymentPlan: '', timeline: '', cost: '', scaleupCost: '', deployments: '', certifications: '', links: [{ label: '', url: '' }, { label: '', url: '' }, { label: '', url: '' }] });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLink = (i, k) => (e) => setForm((f) => ({ ...f, links: f.links.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)) }));
  const filledLinks = form.links.filter((l) => l.url.trim() || l.label.trim());
  const badLink = filledLinks.find((l) => l.label.trim().length < 2 || !/^https:\/\//i.test(l.url.trim()));

  const alreadyBid = state.proposals.some((p) => p.challengeId === challengeId && p.startupId === myStartup.id);
  const verified = myStartup.verificationStatus === 'VERIFIED';

  // Deterministic readiness check (required fields only — nothing here is AI-generated)
  const missing = [
    !challenge && 'Choose a challenge',
    ...FIELDS.filter((f) => form[f.key].trim().length < f.min).map((f) => `${f.label} (at least ${f.min} characters)`),
    !(Number(form.cost) >= 1) && 'Pilot cost (₹)',
    !(Number(form.scaleupCost) >= 1) && 'Scale-up cost (₹)',
    badLink && 'Each link needs a label and a full https:// address',
  ].filter(Boolean);
  const advisories = [
    challenge && Number(form.cost) > challenge.totalBudget && challenge.totalBudget > 0 && `Pilot cost exceeds the challenge budget of ${inr(challenge.totalBudget)}.`,
    !form.deployments.trim() && 'No prior deployments listed — evaluators weigh track record heavily.',
    !form.certifications.trim() && 'No certifications listed.',
  ].filter(Boolean);

  const lines = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean);
  const submit = () => run(async () => {
    await submitProposal({
      challengeId, solutionTitle: form.solutionTitle.trim(), summary: form.summary.trim(), technicalApproach: form.technicalApproach.trim(),
      deploymentPlan: form.deploymentPlan.trim(), timeline: form.timeline.trim(), cost: form.cost, scaleupCost: form.scaleupCost,
      evidenceDeployments: lines(form.deployments), certifications: lines(form.certifications),
      documents: filledLinks.map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
    });
    navigate('/startup/proposals');
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/startup/challenges')}><ArrowLeft size={14} /> Back</button>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Submit a proposal</h1>
          <span style={{ fontSize: '0.8rem', color: 'var(--slate-500)' }}>Your bid is evaluated on the facts you provide. AI scoring is advisory; a named officer decides.</span>
        </div>
      </div>

      {!verified && (
        <div className="card" style={{ background: 'var(--warning-bg)', borderColor: 'var(--warning-border)', display: 'flex', gap: '0.6rem', fontSize: '0.85rem' }}>
          <ShieldAlert size={18} color="var(--warning-text)" style={{ flexShrink: 0 }} />
          <span>Your startup is <strong>{myStartup.verificationStatus || 'PENDING'}</strong>. Proposals can only be submitted once an administrator verifies your credentials.</span>
        </div>
      )}

      <div className="card">
        <label className="form-label" htmlFor="ch">Challenge</label>
        <select id="ch" className="form-control" value={challengeId} onChange={(e) => setChallengeId(e.target.value)}>
          <option value="">Select an open challenge…</option>
          {open.map((c) => <option key={c.id} value={c.id}>{c.title} — {c.department}</option>)}
        </select>
        {challenge && (
          <p style={{ fontSize: '0.8rem', color: 'var(--slate-600)', marginBottom: 0 }}>
            Budget ceiling {challenge.totalBudget ? inr(challenge.totalBudget) : 'not stated'} • Deadline {challenge.deadline || '—'} • Pilot duration {challenge.pilotDurationMonths} months
          </p>
        )}
        {alreadyBid && <p style={{ color: 'var(--danger-text)', fontSize: '0.82rem' }}>You have already submitted a proposal for this challenge.</p>}
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {FIELDS.map((f) => (
          <div key={f.key} className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor={f.key}>{f.label} <span className="required">*</span></label>
            {f.type === 'area'
              ? <textarea id={f.key} className="form-control" rows={4} value={form[f.key]} onChange={set(f.key)} />
              : <input id={f.key} className="form-control" value={form[f.key]} onChange={set(f.key)} />}
            <small style={{ color: 'var(--slate-500)' }}>{f.hint}</small>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="cost">Pilot cost (₹) <span className="required">*</span></label>
            <input id="cost" type="number" min="1" className="form-control" value={form.cost} onChange={set('cost')} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="scale">Scale-up cost (₹) <span className="required">*</span></label>
            <input id="scale" type="number" min="1" className="form-control" value={form.scaleupCost} onChange={set('scaleupCost')} />
          </div>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="dep">Prior deployments (one per line)</label>
          <textarea id="dep" className="form-control" rows={3} value={form.deployments} onChange={set('deployments')} placeholder="Organisation, place, scale, year" />
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '0.6rem' }}>
          <legend className="form-label">Supporting links (up to 3)</legend>
          <small style={{ color: 'var(--slate-500)' }}>Share view-only links (Google Drive, YouTube, GitHub and similar) to your deck, demo or technical note. Only https links. Make sure reviewers can open them.</small>
          {form.links.map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.5rem' }}>
              <input className="form-control" aria-label={`Link ${i + 1} label`} placeholder="Label, e.g. Pitch deck" value={l.label} onChange={setLink(i, 'label')} maxLength={80} />
              <input className="form-control" aria-label={`Link ${i + 1} address`} type="url" placeholder="https://" value={l.url} onChange={setLink(i, 'url')} />
            </div>
          ))}
        </fieldset>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="cert">Certifications (one per line)</label>
          <textarea id="cert" className="form-control" rows={2} value={form.certifications} onChange={set('certifications')} />
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: '0.95rem', marginTop: 0 }}>Readiness check</h3>
        {missing.length === 0
          ? <div style={{ color: 'var(--success-text)', display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}><CheckCircle2 size={16} /> All required fields are complete.</div>
          : <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.84rem', color: 'var(--danger-text)' }}>{missing.map((m) => <li key={m}>{m}</li>)}</ul>}
        {advisories.length > 0 && (
          <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.1rem', fontSize: '0.82rem', color: 'var(--warning-text)' }}>
            {advisories.map((m) => <li key={m}><AlertTriangle size={12} style={{ verticalAlign: '-1px' }} /> {m}</li>)}
          </ul>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary btn-lg" disabled={busy || missing.length > 0 || alreadyBid || !verified} onClick={submit}>
          <Send size={16} /> {busy ? 'Submitting…' : 'Submit proposal'}
        </button>
      </div>
    </div>
  );
}
