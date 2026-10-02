import React, { useState, useRef } from 'react';
import { useApp } from '../../../store';
import { challengesApi } from '../../../api';
import { Sparkles, Save, Send, Plus, Trash2, ArrowLeft } from 'lucide-react';
import { ConfirmationDialog, useBusy } from '../../common/ui';

const BLANK = {
  title: '', problemStatement: '', category: '', targetBeneficiaries: '', desiredOutcome: '', requiredCapabilities: '',
  constraints: '', pilotDurationMonths: 4, totalBudget: '', deadline: '',
  kpis: [{ name: '', baseline: '', target: '', unit: '', measurementMethod: '' }],
  evaluationCriteria: [{ criterion: 'Problem–solution alignment & feasibility', weight: 40 }, { criterion: 'Prior deployment evidence', weight: 30 }, { criterion: 'Cost competitiveness', weight: 30 }],
  requiredDocuments: 'DPIIT recognition certificate\nSystem architecture summary',
  riskConsiderations: [],
};

export function ChallengeCreate() {
  const { createChallenge, publishChallenge, navigate, toast, currentUser } = useApp();
  const [description, setDescription] = useState('');
  const [form, setForm] = useState(BLANK);
  const [aiMeta, setAiMeta] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const published = useRef(false);
  const [gen, runGen] = useBusy();
  const [busy, run] = useBusy();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const lines = (t) => String(t).split('\n').map((x) => x.trim()).filter(Boolean);

  const draftWithAi = () => runGen(async () => {
    try {
      const { challenge: c } = await challengesApi.generateAi(description.trim());
      setForm({
        ...BLANK, title: c.title, problemStatement: c.problem_statement, category: c.problem_category,
        targetBeneficiaries: c.target_beneficiaries, desiredOutcome: c.desired_outcome,
        requiredCapabilities: c.required_capabilities.join('\n'), constraints: c.constraints,
        pilotDurationMonths: c.pilot_duration_months,
        kpis: c.suggested_kpis.map((k) => ({ name: k.name, baseline: k.baseline, target: k.target, unit: k.unit, measurementMethod: k.measurement_method })),
        evaluationCriteria: c.evaluation_criteria, requiredDocuments: c.required_documents.join('\n'), riskConsiderations: c.risk_considerations,
        deadline: '', totalBudget: '',
      });
      setAiMeta({ model: c.model_name, basis: c.basis });
      toast.info('Draft generated. Review every field — you remain the author. Set the budget and deadline.');
    } catch (e) { toast.error(e.message); }
  });

  const weightSum = form.evaluationCriteria.reduce((a, c) => a + Number(c.weight || 0), 0);
  const problems = [
    form.title.trim().length < 5 && 'Title (min 5 characters)',
    form.problemStatement.trim().length < 20 && 'Problem statement (min 20 characters)',
    !form.category.trim() && 'Category',
    form.desiredOutcome.trim().length < 10 && 'Desired outcome (min 10 characters)',
    !(Number(form.totalBudget) > 0) && 'Budget (₹)',
    !form.deadline && 'Submission deadline',
    form.deadline && new Date(form.deadline) <= new Date() && 'Deadline must be in the future',
    weightSum !== 100 && `Evaluation weights must total 100 (now ${weightSum})`,
    form.kpis.some((k) => !k.name.trim() || !k.baseline.trim() || !k.target.trim()) && 'Every KPI needs a name, baseline and target',
  ].filter(Boolean);

  const persist = async () => {
    if (savedId) return savedId;
    const id = await createChallenge({ ...form, requiredCapabilities: lines(form.requiredCapabilities), requiredDocuments: lines(form.requiredDocuments), departmentId: currentUser?.departmentId || undefined });
    setSavedId(id);
    return id;
  };
  const saveDraft = () => run(async () => { await persist(); navigate('/government/challenges'); });
  const startPublish = () => run(async () => { await persist(); setConfirm(true); });
  const doPublish = async () => { await publishChallenge(savedId); published.current = true; navigate(`/government/challenges/${savedId}`); };

  const upd = (key, i, field, v) => setForm((f) => ({ ...f, [key]: f[key].map((x, j) => (j === i ? { ...x, [field]: v } : x)) }));
  const lock = !!savedId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/government/challenges')}><ArrowLeft size={14} /> Back</button>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Create an innovation challenge</h1>
          <span style={{ fontSize: '0.8rem', color: 'var(--slate-500)' }}>Describe the problem in plain language, draft with AI if you like, then edit every field.</span>
        </div>
      </div>

      <div className="card">
        <label className="form-label" htmlFor="desc">Describe the problem</label>
        <textarea id="desc" className="form-control" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Garbage collection routes in our ward are inefficient and we cannot tell which bins overflow." disabled={lock} />
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.6rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={gen || lock || description.trim().length < 20} onClick={draftWithAi}><Sparkles size={15} /> {gen ? 'Drafting…' : 'Draft with AI'}</button>
          <span style={{ fontSize: '0.76rem', color: 'var(--slate-500)' }}>Advisory only. {aiMeta && `Drafted by ${aiMeta.model}.`}</span>
        </div>
      </div>

      <fieldset disabled={lock} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="card" style={{ display: 'grid', gap: '1rem' }}>
          <div className="form-group" style={{ margin: 0 }}><label className="form-label" htmlFor="t">Title</label><input id="t" className="form-control" value={form.title} onChange={set('title')} /></div>
          <div className="form-group" style={{ margin: 0 }}><label className="form-label" htmlFor="ps">Problem statement</label><textarea id="ps" className="form-control" rows={3} value={form.problemStatement} onChange={set('problemStatement')} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '1rem' }}>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label" htmlFor="c">Category</label><input id="c" className="form-control" value={form.category} onChange={set('category')} /></div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label" htmlFor="b">Budget ceiling (₹)</label><input id="b" type="number" min="1" className="form-control" value={form.totalBudget} onChange={set('totalBudget')} /></div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label" htmlFor="d">Submission deadline</label><input id="d" type="date" className="form-control" value={form.deadline} onChange={set('deadline')} /></div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label" htmlFor="m">Pilot duration (months)</label><input id="m" type="number" min="1" max="24" className="form-control" value={form.pilotDurationMonths} onChange={set('pilotDurationMonths')} /></div>
          </div>
          <div className="form-group" style={{ margin: 0 }}><label className="form-label" htmlFor="o">Desired outcome</label><textarea id="o" className="form-control" rows={2} value={form.desiredOutcome} onChange={set('desiredOutcome')} /></div>
          <div className="form-group" style={{ margin: 0 }}><label className="form-label" htmlFor="tb">Target beneficiaries</label><input id="tb" className="form-control" value={form.targetBeneficiaries} onChange={set('targetBeneficiaries')} /></div>
          <div className="form-group" style={{ margin: 0 }}><label className="form-label" htmlFor="rc">Required capabilities (one per line)</label><textarea id="rc" className="form-control" rows={3} value={form.requiredCapabilities} onChange={set('requiredCapabilities')} /></div>
          <div className="form-group" style={{ margin: 0 }}><label className="form-label" htmlFor="cn">Constraints</label><textarea id="cn" className="form-control" rows={2} value={form.constraints} onChange={set('constraints')} /></div>
        </div>

        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ fontSize: '0.95rem', marginTop: 0 }}>KPIs the pilot will be measured on</h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--slate-500)', marginTop: 0 }}>These become the pilot's KPIs. Baselines must come from your own records.</p>
          {form.kpis.map((k, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 2fr auto', gap: '0.4rem', marginBottom: '0.4rem' }}>
              {['name', 'baseline', 'target', 'unit', 'measurementMethod'].map((f) => (
                <input key={f} className="form-control" aria-label={`KPI ${i + 1} ${f}`} placeholder={f === 'measurementMethod' ? 'how measured' : f} value={k[f] || ''} onChange={(e) => upd('kpis', i, f, e.target.value)} />
              ))}
              <button type="button" className="btn btn-secondary btn-sm" aria-label="Remove KPI" onClick={() => setForm((f) => ({ ...f, kpis: f.kpis.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setForm((f) => ({ ...f, kpis: [...f.kpis, { name: '', baseline: '', target: '', unit: '', measurementMethod: '' }] }))}><Plus size={13} /> Add KPI</button>
        </div>

        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ fontSize: '0.95rem', marginTop: 0 }}>Evaluation criteria <span style={{ fontWeight: 500, color: weightSum === 100 ? 'var(--success-text)' : 'var(--danger-text)' }}>({weightSum}/100)</span></h3>
          {form.evaluationCriteria.map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px auto', gap: '0.4rem', marginBottom: '0.4rem' }}>
              <input className="form-control" aria-label={`Criterion ${i + 1}`} value={c.criterion} onChange={(e) => upd('evaluationCriteria', i, 'criterion', e.target.value)} />
              <input className="form-control" type="number" aria-label={`Weight ${i + 1}`} value={c.weight} onChange={(e) => upd('evaluationCriteria', i, 'weight', Number(e.target.value))} />
              <button type="button" className="btn btn-secondary btn-sm" aria-label="Remove criterion" onClick={() => setForm((f) => ({ ...f, evaluationCriteria: f.evaluationCriteria.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setForm((f) => ({ ...f, evaluationCriteria: [...f.evaluationCriteria, { criterion: '', weight: 0 }] }))}><Plus size={13} /> Add criterion</button>
          <div className="form-group" style={{ marginTop: '1rem', marginBottom: 0 }}><label className="form-label" htmlFor="rd">Required documents (one per line)</label><textarea id="rd" className="form-control" rows={3} value={form.requiredDocuments} onChange={set('requiredDocuments')} /></div>
        </div>
      </fieldset>

      {problems.length > 0 && !lock && (
        <div className="card" style={{ fontSize: '0.82rem', color: 'var(--warning-text)', background: 'var(--warning-bg)', borderColor: 'var(--warning-border)' }}>
          <strong>Before you can save:</strong> {problems.join(' • ')}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button className="btn btn-outline" disabled={busy || problems.length > 0} onClick={saveDraft}><Save size={15} /> Save as draft</button>
        <button className="btn btn-primary" disabled={busy || problems.length > 0} onClick={startPublish}><Send size={15} /> Review & publish</button>
      </div>

      <ConfirmationDialog
        isOpen={confirm} onClose={() => { setConfirm(false); if (!published.current) navigate('/government/challenges'); }} onConfirm={doPublish}
        title="Publish this challenge?" confirmLabel="Publish challenge" requireRemarks={false}
        message={`“${form.title}” will become visible to all verified startups. This action is recorded in the audit trail under your name. Close this dialog to keep it as a draft.`}
      />
    </div>
  );
}
