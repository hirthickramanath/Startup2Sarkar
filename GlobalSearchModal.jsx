import React, { useState, useEffect, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Search, Loader2 } from 'lucide-react';
import { useApp } from '../../store';
import { searchApi } from '../../api';
import { StatusBadge } from './ui';

const TYPE = { challenge: 'Challenge', proposal: 'Proposal', pilot: 'Pilot', payment: 'Payment claim', startup: 'Startup' };

export function GlobalSearchModal() {
  const { isSearchOpen, setIsSearchOpen, navigate } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const seq = useRef(0);

  // Ctrl/⌘ + K toggles the palette
  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setIsSearchOpen((o) => !o); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setIsSearchOpen]);

  useEffect(() => { if (!isSearchOpen) { setQ(''); setResults([]); } }, [isSearchOpen]);

  // Debounced server search (results are already scoped to this user's role on the server)
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return undefined; }
    const my = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      searchApi.query(q.trim()).then((r) => { if (my === seq.current) { setResults(r.results || []); setSel(0); } })
        .catch(() => { if (my === seq.current) setResults([]); }).finally(() => { if (my === seq.current) setBusy(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const go = (r) => { if (r?.link) { navigate(r.link); setIsSearchOpen(false); } };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    if (e.key === 'Enter') go(results[sel]);
  };

  return (
    <Dialog.Root open={isSearchOpen} onOpenChange={setIsSearchOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="rx-overlay" />
        <Dialog.Content className="rx-content" style={{ maxWidth: 620, top: '18%', transform: 'translate(-50%, 0)' }} aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.85rem 1rem', borderBottom: '1px solid var(--slate-200)' }}>
            {busy ? <Loader2 size={18} className="spin" color="var(--slate-400)" /> : <Search size={18} color="var(--slate-400)" />}
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search challenges, proposals, pilots, claims…" aria-label="Search" style={{ flex: 1, border: 0, outline: 0, fontSize: '1rem', background: 'transparent' }} />
            <kbd style={{ fontSize: '.68rem', border: '1px solid var(--slate-300)', borderRadius: 4, padding: '.1rem .35rem', color: 'var(--slate-500)' }}>Esc</kbd>
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }} role="listbox">
            {results.map((r, i) => (
              <button key={`${r.type}-${r.id}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => go(r)}
                style={{ width: '100%', textAlign: 'left', border: 0, background: i === sel ? 'var(--info-bg)' : 'transparent', padding: '.7rem 1rem', cursor: 'pointer', display: 'flex', gap: '.75rem', alignItems: 'center', borderBottom: '1px solid var(--slate-100)' }}>
                <span style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--slate-500)', width: 92, textTransform: 'uppercase' }}>{TYPE[r.type] || r.type}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                  <div style={{ fontSize: '.74rem', color: 'var(--slate-500)' }}>{r.subtitle} • {r.id}</div>
                </span>
                {r.status && <StatusBadge status={String(r.status).replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())} size="sm" />}
              </button>
            ))}
            {q.trim().length >= 2 && !busy && results.length === 0 && <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--slate-500)', fontSize: '.85rem' }}>No results you have access to.</div>}
            {q.trim().length < 2 && <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--slate-400)', fontSize: '.82rem' }}>Type at least 2 characters. Results are limited to what your role can see.</div>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
