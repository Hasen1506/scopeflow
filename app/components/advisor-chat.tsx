'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Markdown from 'react-markdown';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  MessageSquareText,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
  CalendarHeart,
  FileSignature,
} from 'lucide-react';
import { useAuth } from '@/src/lib/auth-context';

export type AdvisorPersona = 'wedding-planner' | 'rights-shield' | 'scope-coach';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
}

interface OpenAdvisorDetail {
  persona?: AdvisorPersona;
  prompt?: string;
  contextSummary?: string;
  collectionId?: string | null;
}

const PERSONAS: {
  id: AdvisorPersona;
  label: string;
  icon: typeof CalendarHeart;
  blurb: string;
  starters: string[];
}[] = [
  {
    id: 'wedding-planner',
    label: 'Weddings',
    icon: CalendarHeart,
    blurb: 'Sub-event timelines, vendor checklists, extra-plate caps & polite WhatsApp locks.',
    starters: [
      'Draft a polite WhatsApp confirmation for my wedding caterer covering extra-plate caps and setup time.',
      'List the top 6 hidden charges Indian wedding venues and decorators add last minute.',
      'How should I split advance and balance milestones across Mehendi, Sangeet, and Reception vendors?',
    ],
  },
  {
    id: 'rights-shield',
    label: 'Rights Shield',
    icon: ShieldCheck,
    blurb: 'Check unfair lease or vendor clauses and get polite counter-wording.',
    starters: [
      'My landlord insists on deducting 1 month rent for painting even if the walls are clean. What should I reply?',
      'A caterer refuses to sign a contract and wants 50% cash advance. How do I protect myself?',
      'What electronic proof holds up best in India if a deposit is withheld?',
    ],
  },
  {
    id: 'scope-coach',
    label: 'Scope Coach',
    icon: FileSignature,
    blurb: 'Turn vague promises into clear deliverables, revision limits & change orders.',
    starters: [
      'Write a friendly change-order message for 25 extra reception guests added 2 days before the event.',
      'Turn "full 2BHK modular kitchen and wardrobes" into a clear 4-milestone BOQ.',
      'How do I cap revisions on a freelance project without sounding rigid?',
    ],
  },
];

export function openAdvisorDrawer(detail?: OpenAdvisorDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OpenAdvisorDetail>('termslock:open-advisor', { detail }));
}

export default function AdvisorChat() {
  const { user, getFreshToken } = useAuth();
  const reduced = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [persona, setPersona] = useState<AdvisorPersona>('wedding-planner');
  const [speed, setSpeed] = useState<'balanced' | 'fast'>('balanced');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [contextSummary, setContextSummary] = useState('');
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [historyLoadedFor, setHistoryLoadedFor] = useState<string | null>(null);

  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activePersona = PERSONAS.find((p) => p.id === persona) ?? PERSONAS[0];

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<OpenAdvisorDetail | undefined>).detail;
      if (detail?.persona) setPersona(detail.persona);
      if (typeof detail?.contextSummary === 'string') setContextSummary(detail.contextSummary);
      if (detail?.collectionId !== undefined) setCollectionId(detail.collectionId);
      if (detail?.prompt) setInput(detail.prompt);
      setOpen(true);
      window.setTimeout(() => inputRef.current?.focus(), 120);
    };
    window.addEventListener('termslock:open-advisor', onOpen);
    return () => window.removeEventListener('termslock:open-advisor', onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open]);

  useEffect(() => {
    if (!open || !user || historyLoadedFor === user.uid) return;
    let cancelled = false;
    (async () => {
      const token = await getFreshToken();
      if (!token || cancelled) return;
      try {
        const res = await fetch('/api/ai/chat', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { messages?: ChatMessage[] };
        if (!cancelled && Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages((prev) => (prev.length === 0 ? data.messages! : prev));
        }
        if (!cancelled) setHistoryLoadedFor(user.uid);
      } catch {
        /* ignore offline history fetch */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user, historyLoadedFor, getFreshToken]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, busy, open]);

  const sendText = useCallback(
    async (rawText: string) => {
      const trimmed = rawText.trim();
      if (!trimmed || busy) return;
      setError('');
      setBusy(true);

      const userMsg: ChatMessage = {
        id: `u_${Date.now()}`,
        role: 'user',
        content: trimmed,
      };
      const nextHistory = [...messages, userMsg];
      setMessages(nextHistory);
      setInput('');

      try {
        const token = user ? await getFreshToken() : null;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;

        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message: trimmed,
            persona,
            speed,
            collectionId,
            contextSummary,
            history: messages.slice(-16).map((m) => ({ role: m.role, content: m.content })),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { reply?: string; error?: string; model?: string };
        if (!res.ok || !data.reply) {
          throw new Error(data.error || 'Could not get a reply from the advisor.');
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `a_${Date.now()}`,
            role: 'assistant',
            content: data.reply!,
            model: data.model,
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      } finally {
        setBusy(false);
        window.setTimeout(() => inputRef.current?.focus(), 60);
      }
    },
    [busy, messages, user, getFreshToken, persona, speed, collectionId, contextSummary],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendText(input);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendText(input);
    }
  };

  const clearThread = async () => {
    setMessages([]);
    setError('');
    if (user) {
      const token = await getFreshToken();
      if (token) {
        await fetch('/api/ai/chat', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    }
  };

  return (
    <>
      <button
        type="button"
        className="advisor-fab"
        aria-label="Open ContractLock AI Advisor"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles size={16} aria-hidden="true" />
        <span>AI Advisor</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.aside
            className="advisor-drawer"
            role="dialog"
            aria-label="ContractLock AI Advisor"
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: reduced ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="advisor-head">
              <div className="advisor-title-wrap">
                <MessageSquareText size={18} aria-hidden="true" />
                <div>
                  <strong>ContractLock AI Advisor</strong>
                  <span className="advisor-sub">
                    {contextSummary ? 'Linked to your active Event Hub' : activePersona.blurb}
                  </span>
                </div>
              </div>
              <div className="advisor-head-actions">
                <button
                  type="button"
                  className={`advisor-speed-btn${speed === 'fast' ? ' is-fast' : ''}`}
                  title={speed === 'fast' ? 'Fast replies (Gemini Flash Lite)' : 'Balanced reasoning (Gemini 4 Hydrogen)'}
                  onClick={() => setSpeed((s) => (s === 'fast' ? 'balanced' : 'fast'))}
                >
                  <Zap size={13} aria-hidden="true" />
                  <span>{speed === 'fast' ? 'Fast' : 'Deep'}</span>
                </button>
                {messages.length > 0 && (
                  <button
                    type="button"
                    className="advisor-icon-btn"
                    aria-label="Clear conversation"
                    title="Clear conversation"
                    onClick={() => void clearThread()}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="advisor-icon-btn"
                  aria-label="Close advisor"
                  onClick={() => setOpen(false)}
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="advisor-personas" role="tablist" aria-label="Advisor role">
              {PERSONAS.map((p) => {
                const Icon = p.icon;
                const active = p.id === persona;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`advisor-persona-tab${active ? ' is-active' : ''}`}
                    onClick={() => setPersona(p.id)}
                  >
                    <Icon size={13} aria-hidden="true" />
                    <span>{p.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="advisor-thread" ref={threadRef} aria-live="polite">
              {messages.length === 0 ? (
                <div className="advisor-empty">
                  <p className="eyebrow flush">ASK ABOUT ANY EVENT, VENDOR OR CLAUSE</p>
                  <p className="fine">
                    {contextSummary
                      ? 'Your active event sub-events, vendors, and balances are attached. Ask me to check gaps or draft a vendor WhatsApp confirmation.'
                      : activePersona.blurb}
                  </p>
                  <div className="advisor-starters">
                    {activePersona.starters.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="advisor-starter-btn"
                        disabled={busy}
                        onClick={() => void sendText(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`advisor-msg is-${m.role}`}>
                    <span className="advisor-msg-role">{m.role === 'user' ? 'You' : 'ContractLock Advisor'}</span>
                    <div className="advisor-msg-body">
                      {m.role === 'assistant' ? <Markdown>{m.content}</Markdown> : <p>{m.content}</p>}
                    </div>
                  </div>
                ))
              )}

              {busy && (
                <div className="advisor-msg is-assistant is-thinking">
                  <span className="advisor-msg-role">ContractLock Advisor</span>
                  <div className="advisor-msg-body">
                    <p>Thinking through your terms…</p>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <p className="advisor-error" role="alert">
                {error}
              </p>
            )}

            <form className="advisor-form" onSubmit={onSubmit}>
              <label htmlFor="advisor-input" className="sr-only">
                Ask the ContractLock Advisor
              </label>
              <textarea
                id="advisor-input"
                ref={inputRef}
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Paste a clause, ask about wedding vendor terms, or draft a WhatsApp confirm…"
                disabled={busy}
              />
              <button type="submit" className="primary advisor-send" disabled={busy || !input.trim()}>
                <Send size={15} aria-hidden="true" />
                <span>Send</span>
              </button>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
