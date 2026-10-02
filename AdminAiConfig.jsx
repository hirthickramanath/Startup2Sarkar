import React, { useEffect, useState } from 'react';
import { useApp } from '../../../store';
import { adminApi } from '../../../api';
import { ShieldCheck, Cpu } from 'lucide-react';
import { DataTable, PageHeader } from '../../common/ui';

const KEY = { assistant: 'assistantEnabled', proposalEvaluation: 'proposalEvaluationAiEnabled', challengeDraft: 'challengeDraftAiEnabled' };

export function AdminAiConfig() {
  const { act, state } = useApp();
  const [ai, setAi] = useState(null);
  const [logs, setLogs] = useState([]);
  const load = () => { adminApi.ai().then(setAi).catch(() => {}); adminApi.aiLogs().then((r) => setLogs(r.logs)).catch(() => {}); };
  useEffect(load, []);

  const toggle = async (svc) => {
    await act(() => adminApi.saveSettings({ [KEY[svc.id]]: !svc.enabled }), `${svc.name} ${svc.enabled ? 'disabled' : 'enabled'}`).catch(() => {});
    load();
  };
  const cols = [
    { key: 'timestamp', header: 'Time', width: '160px', render: (v) => String(v).slice(0, 19).replace('T', ' ') },
    { key: 'feature', header: 'Feature', width: '170px' },
    { key: 'user_name', header: 'By', render: (v, r) => v ? `${v} (${r.user_role})` : '—' },
    { key: 'model_name', header: 'Model', render: (v, r) => <span><code>{v}</code> <span style={{ color: 'var(--slate-500)', fontSize: '.72rem' }}>{r.prompt_version}</span></span> },
    { key: 'input_ref', header: 'Input ref' },
    { key: 'tokens_used', header: 'Tokens', width: '80px' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="AI governance" subtitle="What AI is allowed to do here, and a log of every call." />
      <div className="card" style={{ background: 'var(--success-bg)', borderColor: 'var(--success-border)', display: 'flex', gap: '.7rem', fontSize: '.84rem' }}>
        <ShieldCheck size={20} color="var(--success-text)" style={{ flexShrink: 0 }} />
        <span>AI is <strong>advisory only</strong>: it cannot select a startup, approve a claim, release money or edit records. Assistant questions are logged as a hash, never the raw text.</span>
      </div>
      <div className="card" style={{ fontSize: '.84rem', lineHeight: 1.55 }}>
        <h3 style={{ fontSize: '.95rem', marginTop: 0 }}>What the AI can and cannot see</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '1rem' }}>
          <div><strong style={{ color: 'var(--success-text)' }}>Can use</strong>
            <ul style={{ margin: '.3rem 0 0', paddingLeft: '1.1rem' }}>
              <li>The signed-in user's own role-scoped records on this platform</li>
              <li>Platform rules (tax deductions, maker-checker, lifecycle)</li>
              <li>{ai?.market?.enabled ? ai.market.source : 'Exchange-rate snapshot (currently switched off)'}</li>
            </ul></div>
          <div><strong style={{ color: 'var(--danger-text)' }}>Cannot do</strong>
            <ul style={{ margin: '.3rem 0 0', paddingLeft: '1.1rem' }}>
              <li>Browse the web, open links, or use Google Search / any tool</li>
              <li>Answer off-topic questions (they never reach the model)</li>
              <li>Approve, pay, select, publish or change any record</li>
              <li>Give investment advice, forecasts or live market quotes</li>
            </ul></div>
        </div>
        {ai?.llmConfigured && (
          <p style={{ margin: '.8rem 0 0', padding: '.6rem .8rem', background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 8, color: 'var(--warning-text)' }}>
            <strong>Data-protection note:</strong> on Google's <em>free</em> Gemini quota, Google may use submitted prompts to improve its products. Records (names, amounts) are sent with each question. Use a <em>paid</em> Gemini quota for real government data, or remove the API key to stay on the built-in engine.
          </p>
        )}
      </div>
      {ai && (
        <div className="card">
          <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Cpu size={18} /> <strong>{ai.provider}</strong> <code>{ai.model}</code>
            <span className={`badge ${ai.llmConfigured ? 'badge-success' : 'badge-neutral'}`}>{ai.llmConfigured ? 'External model connected' : 'No external model — local rules engine'}</span>
          </div>
          {!ai.llmConfigured && <p style={{ fontSize: '.8rem', color: 'var(--slate-500)', marginBottom: 0 }}>To use Gemini, set <code>GEMINI_API_KEY</code> (and optionally <code>GEMINI_MODEL</code>) in the server environment and restart. The key is never sent to the browser.</p>}
          <div style={{ display: 'grid', gap: '.5rem', marginTop: '1rem' }}>
            {ai.services.map((s) => (
              <label key={s.id} className="row-card" style={{ cursor: 'pointer' }}>
                <span><strong>{s.name}</strong><div style={{ fontSize: '.76rem', color: 'var(--slate-500)' }}>{ai.usage.find((u) => u.feature.startsWith(s.id === 'proposalEvaluation' ? 'proposal' : s.id === 'challengeDraft' ? 'challenge' : 'assistant'))?.calls || 0} calls logged</div></span>
                <input type="checkbox" role="switch" checked={s.enabled} onChange={() => toggle(s)} aria-label={`${s.name} enabled`} style={{ width: 20, height: 20 }} />
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="card"><h3 style={{ fontSize: '.95rem', marginTop: 0 }}>Recent AI calls</h3>
        <DataTable columns={cols} data={logs} searchable={false} emptyTitle="No AI calls yet" emptySubtitle="Entries appear when someone uses the assistant, drafts a challenge or runs an evaluation." /></div>
    </div>
  );
}
