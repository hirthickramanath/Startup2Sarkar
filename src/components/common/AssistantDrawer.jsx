import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Bot, Send, X, Sparkles, ShieldCheck, Trash2 } from 'lucide-react';
import { useApp } from '../../store';
import { assistantApi } from '../../api';

/** Minimal, safe markdown: **bold**, *italic*, `code`, "- " bullets. No HTML is ever injected. */
function inline(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}
function Markdown({ text }) {
  const blocks = String(text).split(/\n{2,}/);
  return blocks.map((b, i) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*-\s+/.test(l))) {
      return <ul key={i} className="as-list">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*-\s+/, ''))}</li>)}</ul>;
    }
    return <p key={i} className="as-p">{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l)}</React.Fragment>)}</p>;
  });
}

const PAGE_ENTITY = [
  [/^\/finance\/payments\/(.+)$/, 'payment'],
  [/^\/(?:government|startup|inspector)\/pilots\/(.+)$/, 'pilot'],
  [/^\/(?:government|startup)\/challenges\/([^/]+)$/, 'challenge'],
];

export function AssistantDrawer() {
  const { isAssistantOpen, openAssistant, closeAssistant, currentRoute, currentUser, currentRole } = useApp();
  const [messages, setMessages] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const storageKey = currentUser ? `s2s_chat_${currentUser.id}` : null;

  // The conversation lives in sessionStorage (this tab only) and is cleared on logout/close of the tab.
  useEffect(() => {
    if (!storageKey) return;
    try { setMessages(JSON.parse(sessionStorage.getItem(storageKey) || '[]')); } catch { setMessages([]); }
  }, [storageKey]);
  useEffect(() => {
    if (storageKey) { try { sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-30))); } catch { /* quota */ } }
  }, [messages, storageKey]);

  useEffect(() => {
    if (!isAssistantOpen) return;
    assistantApi.status().then(setStatus).catch(() => {});
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [isAssistantOpen]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);

  // Ctrl/⌘ + J opens the assistant
  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); isAssistantOpen ? closeAssistant() : openAssistant(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isAssistantOpen, openAssistant, closeAssistant]);

  const pageContext = useCallback(() => {
    for (const [re, entityType] of PAGE_ENTITY) {
      const m = currentRoute.match(re);
      if (m) return { route: currentRoute, entityType, entityId: decodeURIComponent(m[1]) };
    }
    return { route: currentRoute };
  }, [currentRoute]);

  const send = useCallback(async (text) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput('');
    const next = [...messages, { role: 'user', content: message }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await assistantApi.chat(message, next.slice(-9, -1), pageContext());
      setMessages((m) => [...m, { role: 'assistant', content: res.reply, meta: { mode: res.mode, model: res.model, degraded: res.degraded } }]);
      setSuggestions(res.suggestions || []);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', error: true, content: e.status === 429 ? 'You are sending messages too quickly. Please wait a moment.' : (e.message || 'The assistant is unavailable right now.') }]);
    } finally { setBusy(false); }
  }, [input, busy, messages, pageContext]);

  if (!currentUser) return null;
  const first = (currentUser.name || '').split(' ')[0];

  return (
    <Dialog.Root open={isAssistantOpen} onOpenChange={(o) => (o ? openAssistant() : closeAssistant())} modal={false}>
      {!isAssistantOpen && (
        <button type="button" className="as-fab" aria-label="Open assistant (Ctrl+J)" onClick={() => openAssistant()}>
          <Bot size={22} /><span>Ask S2S</span>
        </button>
      )}
      <Dialog.Portal>
        <Dialog.Content className="as-drawer" aria-describedby={undefined} onInteractOutside={(e) => e.preventDefault()}>
          <header className="as-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span className="as-avatar"><Sparkles size={16} /></span>
              <div>
                <Dialog.Title style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700 }}>S2S Assistant</Dialog.Title>
                <div style={{ fontSize: '0.7rem', opacity: 0.8 }}>{status ? (status.mode === 'llm' ? `AI · ${status.model}` : 'Rules-based · answers from your records') : 'Advisory only'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              {messages.length > 0 && <button type="button" className="as-icon" aria-label="Clear conversation" onClick={() => { setMessages([]); setSuggestions([]); }}><Trash2 size={16} /></button>}
              <Dialog.Close asChild><button type="button" className="as-icon" aria-label="Close assistant"><X size={18} /></button></Dialog.Close>
            </div>
          </header>

          <div className="as-body" role="log" aria-live="polite">
            {messages.length === 0 && (
              <div className="as-welcome">
                <h3>Hi {first} 👋</h3>
                <p>Ask me how things work, or about your own records. I can see only what your <strong>{currentRole}</strong> role is allowed to see.</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`as-msg ${m.role} ${m.error ? 'err' : ''}`}>
                {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
                {m.meta?.degraded && <div className="as-note">AI service unreachable — answered by the built-in rules engine.</div>}
              </div>
            ))}
            {busy && <div className="as-msg assistant"><span className="as-dots"><i /><i /><i /></span></div>}
            <div ref={endRef} />
          </div>

          {(suggestions.length > 0 || messages.length === 0) && !busy && (
            <div className="as-chips">
              {(suggestions.length ? suggestions : STARTERS[currentRole] || []).map((s) => (
                <button key={s} type="button" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          )}

          <form className="as-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} maxLength={1500} placeholder="Ask a question…" aria-label="Message" />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send"><Send size={16} /></button>
          </form>
          <div className="as-foot"><ShieldCheck size={12} /> Advisory only — it can't approve, pay or change anything.</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const STARTERS = {
  government: ['What needs my attention?', 'How does AI evaluation work?', 'Show my pilots'],
  startup: ['What is my verification status?', 'Which challenges are open?', 'How do I submit a proposal?'],
  inspector: ['Which pilots are assigned to me?', 'How do I verify KPIs?'],
  finance: ['What needs my attention?', 'How is net payable calculated?', 'Any open anomalies?'],
  admin: ['Who is waiting for verification?', 'Is the audit chain intact?', 'Show platform summary'],
};
