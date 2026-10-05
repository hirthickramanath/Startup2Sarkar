import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../../store';
import { messagesApi } from '../../api';
import { Plus, Send, ArrowLeft, Lock, Unlock } from 'lucide-react';
import { PageHeader, EmptyState, Modal, useBusy, StatusBadge } from './ui';

const when = (iso) => { try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

/** Conversations between a startup's team and the department running its pilot. */
export function MessagesPage() {
  const { state, query, currentUser, toast } = useApp();
  const [threads, setThreads] = useState(null);
  const [openId, setOpenId] = useState(query.get('thread'));
  const [convo, setConvo] = useState(null);
  const [text, setText] = useState('');
  const [nu, setNu] = useState(query.get('pilot') ? { pilotId: query.get('pilot'), subject: '', body: '' } : null);
  const [busy, run] = useBusy();
  const bottom = useRef(null);
  const pilots = state.pilots || [];

  const loadThreads = useCallback(() => messagesApi.threads().then((r) => setThreads(r.threads)).catch(() => setThreads([])), []);
  const loadConvo = useCallback((id) => messagesApi.thread(id).then(setConvo).catch(() => setConvo(null)), []);
  useEffect(() => { loadThreads(); const t = setInterval(loadThreads, 20000); return () => clearInterval(t); }, [loadThreads]);
  useEffect(() => { if (!openId) { setConvo(null); return undefined; } loadConvo(openId); const t = setInterval(() => loadConvo(openId), 10000); return () => clearInterval(t); }, [openId, loadConvo]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [convo?.messages?.length]);

  const send = () => run(async () => { try { await messagesApi.send(openId, text.trim()); setText(''); await loadConvo(openId); loadThreads(); } catch (e) { toast.error(e.message); } });
  const start = () => run(async () => { try { const r = await messagesApi.start({ pilotId: nu.pilotId, subject: nu.subject.trim(), body: nu.body.trim() }); setNu(null); await loadThreads(); setOpenId(r.id); } catch (e) { toast.error(e.message); } });
  const toggle = () => run(async () => { try { await (convo.thread.status === 'OPEN' ? messagesApi.close(openId) : messagesApi.reopen(openId)); await loadConvo(openId); loadThreads(); } catch (e) { toast.error(e.message); } });
  const isStartup = currentUser?.role === 'startup';
  const canToggle = !isStartup || currentUser?.orgRole !== 'MEMBER';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <PageHeader title="Messages" subtitle="Talk to the other side of a pilot. Before an award, ask questions on the challenge page instead, so every bidder sees the same answers."
        actions={<button className="btn btn-primary btn-sm" onClick={() => setNu({ pilotId: pilots[0]?.id || '', subject: '', body: '' })} disabled={pilots.length === 0}><Plus size={14} /> New conversation</button>} />
      <div className="msg-layout">
        <aside className={`msg-list ${openId ? 'hide-on-phone' : ''}`} aria-label="Conversations">
          {threads && threads.length === 0 && <EmptyState title="No conversations yet">{pilots.length ? 'Start one about a pilot.' : 'Conversations open once a pilot starts.'}</EmptyState>}
          {(threads || []).map((t) => (
            <button key={t.id} className={`msg-item ${openId === t.id ? 'active' : ''}`} onClick={() => setOpenId(t.id)}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><strong style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</strong>{t.unread > 0 && <span className="msg-dot" aria-label={`${t.unread} unread`}>{t.unread}</span>}</div>
              <div style={{ fontSize: '.76rem', color: 'var(--slate-500)', textAlign: 'left' }}>{isStartup ? t.department : t.startupName} · {t.pilotName}</div>
              <div style={{ fontSize: '.8rem', color: 'var(--slate-600)', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.lastMessage}</div>
            </button>
          ))}
        </aside>
        <section className={`msg-convo ${openId ? '' : 'hide-on-phone'}`} aria-label="Conversation">
          {!openId || !convo ? <div style={{ margin: 'auto', color: 'var(--slate-500)' }}>Choose a conversation.</div> : (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', paddingBottom: 10, borderBottom: '1px solid var(--slate-200)' }}>
                <button className="btn btn-secondary btn-sm show-on-phone" onClick={() => setOpenId(null)} aria-label="Back to conversations"><ArrowLeft size={14} /></button>
                <div style={{ flex: 1, minWidth: 0 }}><strong>{convo.thread.subject}</strong><div style={{ fontSize: '.76rem', color: 'var(--slate-500)' }}>{convo.thread.pilotName} · {isStartup ? convo.thread.department : convo.thread.startupName}</div></div>
                {convo.thread.status === 'CLOSED' && <StatusBadge status="Closed" size="sm" />}
                {canToggle && <button className="btn btn-outline btn-sm" disabled={busy} onClick={toggle}>{convo.thread.status === 'OPEN' ? <><Lock size={13} /> Close</> : <><Unlock size={13} /> Reopen</>}</button>}
              </div>
              <div className="msg-scroll">
                {convo.messages.map((m) => (
                  <div key={m.id} className={`msg-bubble ${m.mine ? 'mine' : ''}`}>
                    <div style={{ fontSize: '.72rem', opacity: .75 }}>{m.sender} · {m.side === 'STARTUP' ? 'Startup' : 'Department'} · {when(m.at)}</div>
                    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</div>
                  </div>
                ))}
                <div ref={bottom} />
              </div>
              {convo.thread.status === 'OPEN' ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <textarea className="form-control" rows={2} aria-label="Write a message" placeholder="Write a message" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) send(); }} />
                  <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={send} aria-label="Send"><Send size={15} /></button>
                </div>
              ) : <small style={{ color: 'var(--slate-500)' }}>This conversation is closed.</small>}
            </>
          )}
        </section>
      </div>
      <Modal isOpen={!!nu} onClose={() => setNu(null)} title="New conversation" maxWidth="520px"
        footer={<><button className="btn btn-secondary" onClick={() => setNu(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || !nu?.pilotId || (nu?.subject || '').trim().length < 3 || !(nu?.body || '').trim()} onClick={start}>{busy ? 'Sending…' : 'Send'}</button></>}>
        {nu && (<>
          <div className="form-group"><label className="form-label" htmlFor="np">About which pilot?</label><select id="np" className="form-control" value={nu.pilotId} onChange={(e) => setNu({ ...nu, pilotId: e.target.value })}>{pilots.map((p) => <option key={p.id} value={p.id}>{p.name}{p.startupName ? ` · ${p.startupName}` : ''}</option>)}</select></div>
          <div className="form-group"><label className="form-label" htmlFor="ns">Subject</label><input id="ns" className="form-control" maxLength={120} value={nu.subject} onChange={(e) => setNu({ ...nu, subject: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="nb">Message</label><textarea id="nb" className="form-control" rows={4} maxLength={2000} value={nu.body} onChange={(e) => setNu({ ...nu, body: e.target.value })} /></div>
        </>)}
      </Modal>
    </div>
  );
}
