import React, { useEffect, useState } from 'react';
import { useApp } from '../../../store';
import { adminApi } from '../../../api';
import { Save } from 'lucide-react';
import { PageHeader, useBusy } from '../../common/ui';

export function AdminSettings() {
  const { act, state } = useApp();
  const [s, setS] = useState(null);
  const [busy, run] = useBusy();
  useEffect(() => { adminApi.settings().then((r) => setS(r.settings)).catch(() => {}); }, []);
  if (!s) return <PageHeader title="System settings" subtitle="Loading…" />;

  const pct = (bps) => (bps / 100).toFixed(2).replace(/\.00$/, '');
  const num = (k) => (e) => setS((x) => ({ ...x, [k]: e.target.value }));
  const save = () => run(async () => {
    const body = {
      tdsRateBps: Math.round(parseFloat(s.tdsPct ?? pct(s.tdsRateBps)) * 100),
      gstTdsRateBps: Math.round(parseFloat(s.gstPct ?? pct(s.gstTdsRateBps)) * 100),
      gstTdsThresholdPaise: String(Math.round(parseFloat(s.thresholdRupees ?? Number(BigInt(s.gstTdsThresholdPaise) / 100n)) * 100)),
      slaDays: parseInt(s.slaDays, 10),
    };
    const r = await act(() => adminApi.saveSettings(body), 'Settings saved and recorded in the audit trail');
    setS(r.settings);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 720 }}>
      <PageHeader title="System settings" subtitle="Applied immediately to every new payment claim. Every change is recorded in the audit trail." />
      <div className="card" style={{ display: 'grid', gap: '1rem' }}>
        <h3 style={{ fontSize: '.95rem', margin: 0 }}>Statutory deductions</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '1rem' }}>
          <div className="form-group" style={{ margin: 0 }}><label className="form-label" htmlFor="tds">Income-tax TDS (%)</label><input id="tds" type="number" step="0.01" min="0" max="30" className="form-control" value={s.tdsPct ?? pct(s.tdsRateBps)} onChange={(e) => setS((x) => ({ ...x, tdsPct: e.target.value }))} /></div>
          <div className="form-group" style={{ margin: 0 }}><label className="form-label" htmlFor="gst">GST-TDS (%)</label><input id="gst" type="number" step="0.01" min="0" max="30" className="form-control" value={s.gstPct ?? pct(s.gstTdsRateBps)} onChange={(e) => setS((x) => ({ ...x, gstPct: e.target.value }))} /></div>
          <div className="form-group" style={{ margin: 0 }}><label className="form-label" htmlFor="thr">GST-TDS applies above contract value (₹)</label><input id="thr" type="number" min="0" className="form-control" value={s.thresholdRupees ?? Number(BigInt(s.gstTdsThresholdPaise) / 100n)} onChange={(e) => setS((x) => ({ ...x, thresholdRupees: e.target.value }))} /></div>
        </div>
        <p style={{ fontSize: '.78rem', color: 'var(--slate-500)', margin: 0 }}>Defaults: TDS 2% (s.194C for companies), GST-TDS 2% (s.51 CGST Act) above ₹2,50,000. Confirm current rates with your finance/tax advisor — they change with law.</p>
        <h3 style={{ fontSize: '.95rem', margin: '.5rem 0 0' }}>Service levels</h3>
        <div className="form-group" style={{ margin: 0, maxWidth: 220 }}><label className="form-label" htmlFor="sla">Payment processing SLA (days)</label><input id="sla" type="number" min="1" max="90" className="form-control" value={s.slaDays} onChange={num('slaDays')} /></div>
        <div><button className="btn btn-primary" disabled={busy} onClick={save}><Save size={15} /> {busy ? 'Saving…' : 'Save settings'}</button></div>
      </div>
    </div>
  );
}
