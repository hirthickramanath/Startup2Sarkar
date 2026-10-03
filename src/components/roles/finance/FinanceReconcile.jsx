import React, { useState } from 'react';
import { useApp } from '../../../store';
import { platformApi } from '../../../api';
import { FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { PageHeader, EmptyState, useBusy, inrPaise } from '../../common/ui';
import { cardStyle } from '../../common/Profile';

// A forgiving CSV reader (quoted fields, commas inside quotes)
function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); if (row.some((x) => x.trim())) rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseDate(s) {
  const t = String(s).trim(); let m;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2,4})/))) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  if ((m = t.match(/^(\d{1,2})[ \-]([A-Za-z]{3})[a-z]*[ \-,]+(\d{2,4})/))) { const mo = MONTHS[m[2].toLowerCase()]; if (mo) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`; } }
  return null;
}
const paise = (s) => { const n = parseFloat(String(s).replace(/[₹,\s]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };

function toRows(text) {
  const all = parseCsv(text);
  const hi = all.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /debit|withdraw|\bdr\b/i.test(c)));
  if (hi < 0) throw new Error('Could not find a header row with a date and a debit (or withdrawal) column.');
  const h = all[hi].map((c) => c.trim());
  const ix = (re) => h.findIndex((c) => re.test(c));
  const di = ix(/date/i), ni = ix(/narration|description|particulars|remarks|details/i), ri = ix(/ref|chq|cheque|utr/i), wi = ix(/debit|withdraw|\bdr\b/i);
  const out = [];
  for (const r of all.slice(hi + 1)) {
    const date = parseDate(r[di] || '');
    if (!date) continue;
    out.push({ date, description: (r[ni] || '').slice(0, 300), reference: ri >= 0 && ri !== ni ? (r[ri] || '').slice(0, 100) : '', debitPaise: paise(r[wi] || '') });
  }
  return out;
}

export function FinanceReconcile() {
  const { toast, fetchLiveData } = useApp();
  const [result, setResult] = useState(null);
  const [picked, setPicked] = useState({});
  const [name, setName] = useState('');
  const [busy, run] = useBusy();

  const onFile = (file) => {
    if (!file) return;
    setName(file.name); setResult(null);
    const reader = new FileReader();
    reader.onload = () => run(async () => {
      try {
        const rows = toRows(String(reader.result));
        if (rows.length === 0) throw new Error('No payment lines found in that file.');
        const r = await platformApi.reconcile(rows.slice(0, 1000));
        setResult({ ...r, total: rows.length });
        setPicked(Object.fromEntries(r.matches.map((m) => [`${m.claimId}:${m.kind}`, true])));
      } catch (e) { toast.error(e.message); }
    });
    reader.readAsText(file);
  };
  const apply = () => run(async () => {
    const items = result.matches.filter((m) => picked[`${m.claimId}:${m.kind}`]).map((m) => ({ claimId: m.claimId, kind: m.kind, date: m.date }));
    if (items.length === 0) { toast.info('Nothing selected.'); return; }
    try {
      const r = await platformApi.applyReconcile(items);
      toast.success(`${r.applied} of ${items.length} applied`);
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length) toast.error(failed.map((f) => `${f.claimId}: ${f.error}`).join(' • '));
      setResult(null); await fetchLiveData();
    } catch (e) { toast.error(e.message); }
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Bank reconciliation" subtitle="Upload your bank statement (CSV). Cheques and transfers it confirms are matched to claims by number and amount; you review before anything changes." />
      <section style={cardStyle}>
        <label className="btn btn-primary" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
          <FileSpreadsheet size={15} /> {busy ? 'Reading…' : 'Choose statement CSV'}
          <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} aria-label="Bank statement CSV" />
        </label>
        <small style={{ color: 'var(--slate-500)' }}>The file needs a date column and a debit or withdrawal column. Narration and reference columns are used to find cheque numbers and UTRs. Nothing is uploaded except the lines needed to match payments. {name && `Last file: ${name}`}</small>
      </section>
      {result && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '1rem' }}>
            {[['Matched', result.matches.length, 'var(--success-text)'], ['Amount differs', result.mismatches.length, 'var(--warning-text)'], ['Not recognised', result.unmatched.length, 'var(--slate-600)'], ['Lines read', result.total, 'var(--ink)']].map(([l, n, c]) => (
              <div key={l} className="card"><div style={{ fontSize: '1.5rem', fontWeight: 800, color: c }}>{n}</div><div style={{ fontSize: '.78rem', color: 'var(--slate-500)' }}>{l}</div></div>
            ))}
          </div>
          {result.matches.length === 0 && result.mismatches.length === 0 ? <EmptyState title="No payments recognised">None of the debit lines contained an issued cheque number or a recorded UTR.</EmptyState> : (
            <section style={cardStyle}>
              {result.matches.length > 0 && <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Ready to apply</h2>}
              {result.matches.map((m) => {
                const k = `${m.claimId}:${m.kind}`;
                return (
                  <label key={k} className="row-card" style={{ alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!picked[k]} onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.checked }))} />
                    <CheckCircle2 size={16} color="var(--success-text)" />
                    <div style={{ flex: 1 }}><strong>{m.startupName}</strong> · {m.kind === 'CHEQUE_CLEARED' ? `cheque ${m.reference} cleared` : `transfer ${m.reference} confirmed`}<div style={{ fontSize: '.76rem', color: 'var(--slate-500)' }}>{m.claimId} · {m.date} · {inrPaise(Number(m.statementPaise))}</div></div>
                  </label>
                );
              })}
              {result.mismatches.map((m) => (
                <div key={`${m.claimId}:${m.kind}:${m.rowIndex}`} className="row-card" style={{ alignItems: 'center', background: 'var(--warning-bg)' }}>
                  <AlertTriangle size={16} color="var(--warning-text)" />
                  <div style={{ flex: 1, color: 'var(--warning-text)' }}><strong>{m.startupName}</strong> · {m.reference}: {m.reason === 'AMOUNT_DIFFERS' ? `the statement shows ${inrPaise(Number(m.statementPaise))} but ${inrPaise(Number(m.expectedPaise))} was expected` : 'the statement date is before the cheque date'}. Not applied; investigate.</div>
                </div>
              ))}
              {result.matches.length > 0 && <div><button className="btn btn-success" disabled={busy} onClick={apply}>Apply selected</button></div>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
