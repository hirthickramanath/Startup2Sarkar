import React, { useEffect, useState } from 'react';
import { useApp, useAuth } from '../../store';
import { authApi } from '../../api';
import { GoogleButton, GoogleG, GitHubMark } from '../auth/LoginPage';
import { Check } from 'lucide-react';
import { useBusy } from './ui';

const card = { background: 'var(--white)', border: '1px solid var(--slate-200)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' };
const pill = { display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 16px', borderRadius: 999, cursor: 'pointer', font: '600 13.5px Figtree, sans-serif', whiteSpace: 'nowrap' };
export const cardStyle = card;

/** Ways to sign in. This is where "Connect to GitHub" lives (the profile page, not the dashboard). */
export function LinkedAccounts() {
  const { toast } = useApp();
  const { config } = useAuth();
  const [data, setData] = useState(null);
  const [busy, run] = useBusy();
  const load = () => authApi.identities().then(setData).catch(() => setData({ identities: [], canUnlink: false }));

  useEffect(() => {
    load();
    const g = new URLSearchParams(window.location.search).get('github');
    if (g) {
      if (g === 'linked') toast.success('GitHub connected');
      else if (g === 'in_use') toast.error('That GitHub account already belongs to another user.');
      else toast.error('GitHub could not be connected. Please try again.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const connectGithub = () => run(async () => {
    try { const { url } = await authApi.linkGithub(); window.location.href = url; } catch (e) { toast.error(e.message); }
  });
  const connectGoogle = async (credential) => { try { await authApi.linkGoogle(credential); toast.success('Google connected'); load(); } catch (e) { toast.error(e.message); } };
  const unlink = (provider) => run(async () => { try { await authApi.unlink(provider); toast.success('Disconnected'); load(); } catch (e) { toast.error(e.message); } });

  if (!data) return <div style={card}>Loading…</div>;
  const rows = [
    { id: 'google', name: 'Google', icon: <GoogleG size={22} />, available: data.googleAvailable },
    { id: 'github', name: 'GitHub', icon: <GitHubMark size={22} />, available: data.githubAvailable },
  ].map((r) => ({ ...r, link: data.identities.find((i) => i.provider === r.id) }));

  return (
    <section style={card}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Linked accounts</h2>
        <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--slate-600)', maxWidth: 520 }}>
          Link more than one way to sign in. Your GitHub profile is shown to evaluators only if you add it to a proposal.
        </p>
      </div>
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, border: '1px solid var(--slate-200)', borderRadius: 'var(--radius-md)', background: 'var(--slate-50)', flexWrap: 'wrap' }}>
          <span style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--white)', border: '1px solid var(--slate-200)', display: 'grid', placeItems: 'center', color: 'var(--ink)', flexShrink: 0 }}>{r.icon}</span>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ font: '600 15px Figtree, sans-serif', color: 'var(--ink)' }}>{r.name}</div>
            <div style={{ fontSize: 13, color: 'var(--slate-600)' }}>
              {r.link ? `Connected${r.link.email ? ` · ${r.link.email}` : ''}` : r.available ? 'Not connected' : 'Not available on this server yet'}
            </div>
          </div>
          {r.link ? (
            <>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, background: 'var(--success-bg)', color: 'var(--success-text)', font: '600 12px Figtree, sans-serif' }}><Check size={14} /> Connected</span>
              <button type="button" className="btn btn-outline btn-sm" disabled={busy || !data.canUnlink} title={data.canUnlink ? '' : 'Keep at least one way to sign in'} onClick={() => unlink(r.id)}>Disconnect</button>
            </>
          ) : r.id === 'github' ? (
            <button type="button" disabled={busy || !r.available} onClick={connectGithub} style={{ ...pill, border: 0, background: 'var(--ink)', color: 'var(--slate-50)', opacity: r.available ? 1 : 0.55 }}><GitHubMark size={18} /> Connect to GitHub</button>
          ) : r.available ? (
            <GoogleButton clientId={config.googleClientId} onCredential={connectGoogle} width={200} text="continue_with" />
          ) : (
            <button type="button" disabled style={{ ...pill, border: '1px solid var(--slate-300)', background: 'var(--white)', color: 'var(--slate-900)', opacity: 0.55 }}><GoogleG size={18} /> Connect Google</button>
          )}
        </div>
      ))}
      {!data.canUnlink && <small style={{ color: 'var(--slate-500)' }}>You need at least one way to sign in, so the only one you have cannot be disconnected.</small>}
    </section>
  );
}

const KINDS = [['resume', 'Resume'], ['linkedin', 'LinkedIn'], ['github', 'GitHub'], ['instagram', 'Instagram'], ['x', 'X (Twitter)'], ['website', 'Website'], ['pitch_deck', 'Pitch deck'], ['demo_video', 'Demo video'], ['other', 'Other']];

/** Resume, social and pitch links. https only; share view-only links from Drive, YouTube and similar. */
export function ProfileLinks() {
  const { toast } = useApp();
  const [vals, setVals] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [busy, run] = useBusy();
  useEffect(() => { authApi.profileLinks().then((r) => { setVals(Object.fromEntries(r.links.map((l) => [l.kind, l.url]))); setLoaded(true); }).catch(() => setLoaded(true)); }, []);
  const save = () => run(async () => {
    const links = KINDS.map(([k]) => ({ kind: k, url: (vals[k] || '').trim() })).filter((l) => l.url);
    const bad = links.find((l) => !/^https:\/\//i.test(l.url));
    if (bad) { toast.error('Every link must start with https://'); return; }
    try { await authApi.saveProfileLinks(links); toast.success('Links saved'); } catch (e) { toast.error([e.message, ...(e.details || [])].join(' • ')); }
  });
  return (
    <section style={card}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Profile links</h2>
        <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--slate-600)', maxWidth: 560 }}>Add view-only links to your resume, pitch deck or videos (Google Drive, YouTube and similar). Only https links are accepted. Make sure the sharing setting lets reviewers open them.</p>
      </div>
      {!loaded ? 'Loading…' : (
        <div className="lp-grid2">
          {KINDS.map(([k, label]) => (
            <label key={k} className="lp-field">{label}
              <input type="url" value={vals[k] || ''} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} placeholder="https://" />
            </label>
          ))}
        </div>
      )}
      <div><button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save links'}</button></div>
    </section>
  );
}
