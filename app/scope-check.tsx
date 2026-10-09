'use client';
import {useEffect, useId, useState} from 'react';
import {Copy, Search} from 'lucide-react';
import type {RadarResult} from '@/lib/radar';
import type {Agreement, ChangeOrder} from '@/lib/ledger';
import type {Scope} from '@/lib/scope';
import {api, post} from './ui';

export type AiStatus = {enabled: boolean; provider: string | null; model?: string | null; careful_model?: string | null; warning?: string | null; reason?: string};
/** Fast (the default model) or careful (a stronger model, fewer requests per minute), with the model named. */
export function AiQuality({ai, value, onChange}: {ai: AiStatus; value: 'fast' | 'careful'; onChange: (v: 'fast' | 'careful') => void}) {
  const name = useId();
  if (!ai.enabled) return null;
  return (
    <fieldset className="ai-quality">
      <legend className="fine">AI quality</legend>
      <label className="check-row"><input type="radio" name={name} checked={value === 'fast'} onChange={() => onChange('fast')} /><span>Fast <span className="quiet">· {ai.model}</span></span></label>
      <label className="check-row"><input type="radio" name={name} checked={value === 'careful'} onChange={() => onChange('careful')} /><span>Careful <span className="quiet">· {ai.careful_model} · slower, fewer per minute</span></span></label>
      {ai.warning && <p className="fine warn-ink" role="note">{ai.warning}</p>}
    </fieldset>
  );
}

const verdicts: Record<RadarResult['verdict'], {text: string; tone: string}> = {
  in_scope: {text: 'Covered by the agreement', tone: 'approved'},
  revision: {text: 'Revision round', tone: 'pending'},
  out_of_scope: {text: 'Not covered: scope creep', tone: 'changes_requested'},
  ambiguous: {text: 'Unclear', tone: 'pending'},
};

/**
 * PR E: scope-creep radar. Paste a client message and get a verdict that cites the clause of the
 * agreement it rests on (keyword check, or an AI check when the server has a key), with a one-click
 * change order draft. Nothing is sent or recorded until you choose to.
 */
export function ScopeCheck({projectId, busy, onDraft, onLogRound, onRevise, ai: given}: {
  projectId: string; ai?: AiStatus; scope?: Scope; agreement?: Agreement; busy: boolean;
  /** After approval: turn a not-covered request into a change order. */
  onDraft?: (co: Partial<ChangeOrder>) => void;
  onLogRound?: (note: string) => void;
  /** Before approval: there is no agreement to amend yet, so offer to revise the scope instead. */
  onRevise?: () => void;
}) {
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<RadarResult | null>(null);
  const [used, setUsed] = useState<{enabled: boolean; provider: string | null; model?: string | null} | null>(null);
  const [quality, setQuality] = useState<'fast' | 'careful'>('fast');
  const [loaded, setLoaded] = useState<AiStatus | null>(null);
  const ai = given ?? loaded;
  // Without a status from the parent, read it once (models and any retirement warning).
  useEffect(() => { if (given) return; let live = true; api('/api/me').then(me => { if (live && me.ai) setLoaded(me.ai); }, () => {}); return () => { live = false; }; }, [given]);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const v = result && verdicts[result.verdict];
  async function check() {
    setError(''); setChecking(true); setResult(null);
    try { const r = await api(`/api/scopes/${projectId}/radar`, post({message, quality})); setResult(r.result); setUsed(r.ai); }
    catch (e) { setError((e as Error).message); } finally { setChecking(false); }
  }
  return (
    <details className="scope-check section-gap">
      <summary><Search size={15} /> Scope-creep radar: is this request covered?{onRevise && <span className="quiet"> · before approval</span>}</summary>
      {onRevise && <p className="fine">Nothing is approved yet, so this checks the version you sent. If a request is not covered, revise the scope before the client signs rather than agreeing to it informally.</p>}
      <label>Client’s request<textarea rows={3} maxLength={4000} value={message} placeholder="Paste the email or chat message" onChange={e => { setMessage(e.target.value); setResult(null); }} /></label>
      {ai?.enabled && <AiQuality ai={ai} value={quality} onChange={setQuality} />}
      <button type="button" className="secondary" disabled={checking || message.trim().length < 5} onClick={check}>{checking ? 'Checking…' : onRevise ? 'Check against this version' : 'Check against the agreement'}</button>
      {error && <p className="error" role="alert">{error}</p>}
      {result && v && (
        <div className="check-result" role="status">
          <div className="small-title"><strong>{v.text}</strong><span className={'tag status-' + v.tone}>{result.engine === 'llm' ? 'AI check' : 'keyword check'} · {result.confidence} confidence</span></div>
          <ul>{result.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          {result.citations.length > 0 && <ul className="citations" aria-label="Clauses cited">{result.citations.map(c => <li key={c.id}><span className="diff-badge diff-change">§{c.id}</span> <span className="quiet">{c.kind}</span> “{c.text}”</li>)}</ul>}
          {result.note && <p className="fine">{result.note}</p>}
          <p className="fine">{result.engine === 'llm' ? `An AI reading (${used?.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}${used?.model ? ', ' + used.model : ''}) checked against the numbered clauses; it must cite clauses that exist.` : `A keyword check against your deliverables and exclusions${used?.enabled ? '' : ' (AI check off: no OPENAI_API_KEY or ANTHROPIC_API_KEY on this server)'}.`} Read the request yourself before replying.</p>
          <label>Suggested reply<textarea rows={3} readOnly value={result.reply} onFocus={e => e.target.select()} /></label>
          <div className="actions">
            <button type="button" className="secondary" onClick={async () => { try { await navigator.clipboard.writeText(result.reply); setCopied(true); } catch { setCopied(false); } }}><Copy size={15} />{copied ? 'Copied' : 'Copy reply'}</button>
            {onDraft && result.change_order && <button type="button" className="primary" disabled={busy} onClick={() => onDraft(result.change_order!)}>Draft change order</button>}
            {onLogRound && result.verdict === 'revision' && result.rounds_left > 0 && <button type="button" className="secondary" disabled={busy} onClick={() => onLogRound(message.trim().slice(0, 300))}>Log as revision round</button>}
            {onRevise && (result.verdict === 'out_of_scope' || result.verdict === 'ambiguous') && <button type="button" className="primary" disabled={busy} onClick={onRevise}>Revise the scope</button>}
          </div>
        </div>
      )}
    </details>
  );
}
