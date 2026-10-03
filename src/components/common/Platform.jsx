import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../store';
import { platformApi } from '../../api';
import { Upload, FileText, Download, CheckCircle2, XCircle, Copy, Trash2, Pencil, MessageCircleQuestion } from 'lucide-react';
import { Modal, useBusy, StatusBadge, inrPaise } from './ui';
import { cardStyle } from './Profile';

/* ───────── Statutory documents (startup) ───────── */
const toBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Could not read that file'));
  r.readAsDataURL(file);
});

export function DocumentsPanel() {
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [busyType, setBusyType] = useState(null);
  const inputs = useRef({});
  const load = () => platformApi.documents().then(setData).catch(() => setData({ documents: [], types: [] }));
  useEffect(() => { load(); }, []);
  const pick = async (type, file) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast.error('Each document can be at most 8 MB.'); return; }
    setBusyType(type);
    try { await platformApi.uploadDocument(type, file.name.replace(/\.pdf$/i, ''), await toBase64(file)); toast.success('Uploaded. An administrator will review it.'); load(); }
    catch (e) { toast.error(e.message); }
    finally { setBusyType(null); if (inputs.current[type]) inputs.current[type].value = ''; }
  };
  if (!data) return <section style={cardStyle}>Loading…</section>;
  return (
    <section style={cardStyle}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Verification documents</h2>
        <p style={{ margin: '4px 0 0', fontSize: '.82rem', color: 'var(--slate-600)', maxWidth: 560 }}>Upload each document as a PDF (up to 8 MB). Only you and the platform administrator can open them. Uploading again replaces the earlier file.</p>
      </div>
      {data.types.map((t) => {
        const d = data.documents.find((x) => x.docType === t.type);
        return (
          <div key={t.type} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid var(--slate-200)', borderRadius: 'var(--radius-md)', background: 'var(--slate-50)', flexWrap: 'wrap' }}>
            <FileText size={20} color="var(--slate-500)" />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600, fontSize: '.9rem' }}>{t.label}</div>
              <div style={{ fontSize: '.78rem', color: 'var(--slate-500)' }}>
                {d ? <>{d.filename}.pdf · {(d.sizeBytes / 1024).toFixed(0)} KB {d.reviewNote && <> · <em>{d.reviewNote}</em></>}</> : 'Not uploaded yet'}
              </div>
            </div>
            {d && <StatusBadge status={d.status === 'UPLOADED' ? 'Under review' : d.status === 'ACCEPTED' ? 'Accepted' : 'Needs attention'} size="sm" />}
            {d && <a className="btn btn-outline btn-sm" href={platformApi.documentUrl(d.id)}><Download size={13} /> Open</a>}
            <input ref={(el) => { inputs.current[t.type] = el; }} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={(e) => pick(t.type, e.target.files?.[0])} aria-label={`Upload ${t.label}`} />
            <button className="btn btn-primary btn-sm" disabled={busyType === t.type} onClick={() => inputs.current[t.type]?.click()}><Upload size={13} /> {busyType === t.type ? 'Uploading…' : d ? 'Replace' : 'Upload PDF'}</button>
          </div>
        );
      })}
    </section>
  );
}

/* ───────── Proposal drafts (startup) ───────── */
export function DraftsPanel() {
  const { state, navigate, act } = useApp();
  const drafts = state.proposals.filter((p) => p.rawStatus === 'DRAFT');
  const [busy, run] = useBusy();
  if (drafts.length === 0) return null;
  return (
    <section style={cardStyle}>
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Your drafts</h2>
      <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--slate-600)' }}>Drafts are private to you. Continue one when you are ready to submit.</p>
      {drafts.map((p) => (
        <div key={p.id} className="row-card" style={{ alignItems: 'center' }}>
          <div style={{ flex: 1 }}><strong>{p.solutionTitle || 'Untitled draft'}</strong><div style={{ fontSize: '.76rem', color: 'var(--slate-500)' }}>{p.id} · for {state.challenges.find((c) => c.id === p.challengeId)?.title || p.challengeId}</div></div>
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`/startup/proposals/create?draft=${p.id}&challenge=${p.challengeId}`)}><Pencil size={13} /> Continue</button>
          <button className="btn btn-outline btn-sm" disabled={busy} aria-label="Delete draft" onClick={() => run(async () => { try { await act(() => platformApi.deleteDraft(p.id), 'Draft deleted'); } catch { /* shown */ } })}><Trash2 size={13} /></button>
        </div>
      ))}
    </section>
  );
}

/* ───────── Challenge questions and answers ───────── */
export function ChallengeQA({ challengeId, role }) {
  const { toast } = useApp();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [answering, setAnswering] = useState({});
  const [busy, run] = useBusy();
  const load = () => platformApi.questions(challengeId).then((r) => setRows(r.questions)).catch(() => setRows([]));
  useEffect(() => { load(); }, [challengeId]);
  const ask = () => run(async () => { try { await platformApi.ask(challengeId, q.trim()); setQ(''); toast.success('Question sent. Answers appear here for every bidder.'); load(); } catch (e) { toast.error(e.message); } });
  const answer = (id) => run(async () => { try { await platformApi.answer(challengeId, id, (answering[id] || '').trim()); toast.success('Answer published'); load(); } catch (e) { toast.error(e.message); } });
  const official = role === 'government' || role === 'admin';
  return (
    <section style={cardStyle}>
      <h2 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', gap: 8, alignItems: 'center' }}><MessageCircleQuestion size={18} /> Questions and answers</h2>
      <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--slate-600)' }}>{official ? 'Answered questions are visible to every bidder (without the asker\'s name).' : 'Ask the department a question. Once answered, it is shown to every bidder, so nobody has an advantage.'}</p>
      {(rows || []).length === 0 && rows && <span style={{ fontSize: '.84rem', color: 'var(--slate-500)' }}>No questions yet.</span>}
      {(rows || []).map((r) => (
        <div key={r.id} style={{ padding: '.7rem .9rem', borderRadius: 'var(--radius-md)', background: 'var(--slate-50)', border: '1px solid var(--slate-200)' }}>
          <div style={{ fontWeight: 600, fontSize: '.88rem' }}>Q: {r.question}{r.mine && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>yours</span>}</div>
          {r.answer ? <div style={{ marginTop: 4, fontSize: '.86rem', color: 'var(--success-text)' }}>A: {r.answer}</div>
            : official ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <input className="form-control" aria-label="Your answer" placeholder="Write the official answer" value={answering[r.id] || ''} onChange={(e) => setAnswering((a) => ({ ...a, [r.id]: e.target.value }))} />
                <button className="btn btn-primary btn-sm" disabled={busy || (answering[r.id] || '').trim().length < 5} onClick={() => answer(r.id)}>Publish</button>
              </div>
            ) : <div style={{ marginTop: 4, fontSize: '.8rem', color: 'var(--slate-500)' }}>Waiting for an official answer.</div>}
        </div>
      ))}
      {role === 'startup' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="form-control" aria-label="Ask a question" placeholder="Ask a question (at least 10 characters)" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} />
          <button className="btn btn-primary" disabled={busy || q.trim().length < 10} onClick={ask}>Ask</button>
        </div>
      )}
    </section>
  );
}

/** Copy a challenge as a new draft (template reuse). */
export function DuplicateChallenge({ challengeId }) {
  const { toast, navigate, fetchLiveData } = useApp();
  const [busy, run] = useBusy();
  return (
    <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => run(async () => { try { const r = await platformApi.duplicateChallenge(challengeId); toast.success('Copied as a new draft'); await fetchLiveData(); navigate(`/government/challenges/${r.id}`); } catch (e) { toast.error(e.message); } })}><Copy size={13} /> Use as template</button>
  );
}

/* ───────── Trend charts ───────── */
export function TrendChart({ title, subtitle, months, series }) {
  // series: [{ key, label, color, format }]; bars are grouped by month, each scaled to its own maximum so small series stay visible
  const W = 560; const H = 170; const pad = { l: 8, r: 8, t: 12, b: 28 };
  const group = (W - pad.l - pad.r) / months.length;
  const bw = Math.min(26, (group - 10) / series.length);
  return (
    <section style={cardStyle}>
      <div><h2 style={{ margin: 0, fontSize: '1.05rem' }}>{title}</h2>{subtitle && <p style={{ margin: '4px 0 0', fontSize: '.8rem', color: 'var(--slate-500)' }}>{subtitle}</p>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: last six months`} style={{ width: '100%', height: 'auto' }}>
        <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} style={{ stroke: 'var(--slate-200)' }} />
        {months.map((m, i) => (
          <g key={m.month}>
            {series.map((s, j) => {
              const max = Math.max(1, ...months.map((x) => Number(x[s.key] || 0)));
              const v = Number(m[s.key] || 0);
              const h = Math.round(((H - pad.t - pad.b) * v) / max);
              const x = pad.l + i * group + (group - bw * series.length) / 2 + j * bw;
              return <rect key={s.key} x={x} y={H - pad.b - h} width={bw - 3} height={Math.max(h, v > 0 ? 2 : 0)} rx="3" style={{ fill: s.color }}><title>{`${m.month} · ${s.label}: ${s.format ? s.format(v) : v}`}</title></rect>;
            })}
            <text x={pad.l + i * group + group / 2} y={H - 8} textAnchor="middle" fontSize="11" style={{ fill: 'var(--slate-500)' }}>{new Date(`${m.month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })}</text>
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '.78rem', color: 'var(--slate-600)' }}>
        {series.map((s) => <span key={s.key} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><i style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: 'inline-block' }} />{s.label}</span>)}
      </div>
    </section>
  );
}

export function FinanceTrends() {
  const [m, setM] = useState(null);
  useEffect(() => { platformApi.financeTrends().then((r) => setM(r.months)).catch(() => setM([])); }, []);
  if (!m || m.length === 0) return null;
  const rows = m.map((x) => ({ ...x, paidRupees: Number(BigInt(x.paidNetPaise) / 100n) }));
  return <TrendChart title="Claims and payments" subtitle="Last six months" months={rows} series={[{ key: 'claims', label: 'Claims raised', color: 'var(--accent)' }, { key: 'paidRupees', label: 'Paid out (net, ₹)', color: 'var(--brand)', format: (v) => inrPaise(v * 100) }]} />;
}

export function AdminTrends() {
  const [m, setM] = useState(null);
  useEffect(() => { platformApi.adminTrends().then((r) => setM(r.months)).catch(() => setM([])); }, []);
  if (!m || m.length === 0) return null;
  return <TrendChart title="Platform activity" subtitle="Last six months" months={m} series={[{ key: 'users', label: 'New users', color: 'var(--brand)' }, { key: 'proposals', label: 'Proposals', color: 'var(--accent)' }, { key: 'pilots', label: 'Pilots', color: 'var(--success-text)' }]} />;
}
