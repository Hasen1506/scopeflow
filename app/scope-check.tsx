'use client';
import {useState} from 'react';
import {Copy, Search} from 'lucide-react';
import type {RadarResult} from '@/lib/radar';
import type {Agreement, ChangeOrder} from '@/lib/ledger';
import type {Scope} from '@/lib/scope';
import {api, post} from './ui';

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
export function ScopeCheck({projectId, busy, onDraft, onLogRound}: {
  projectId: string; scope?: Scope; agreement?: Agreement; busy: boolean;
  onDraft: (co: Partial<ChangeOrder>) => void;
  onLogRound: (note: string) => void;
}) {
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<RadarResult | null>(null);
  const [ai, setAi] = useState<{enabled: boolean; provider: string | null} | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const v = result && verdicts[result.verdict];
  async function check() {
    setError(''); setChecking(true); setResult(null);
    try { const r = await api(`/api/scopes/${projectId}/radar`, post({message})); setResult(r.result); setAi(r.ai); }
    catch (e) { setError((e as Error).message); } finally { setChecking(false); }
  }
  return (
    <details className="scope-check section-gap">
      <summary><Search size={15} /> Scope-creep radar: is this request covered?</summary>
      <label>Client’s request<textarea rows={3} maxLength={4000} value={message} placeholder="Paste the email or chat message" onChange={e => { setMessage(e.target.value); setResult(null); }} /></label>
      <button type="button" className="secondary" disabled={checking || message.trim().length < 5} onClick={check}>{checking ? 'Checking…' : 'Check against the agreement'}</button>
      {error && <p className="error" role="alert">{error}</p>}
      {result && v && (
        <div className="check-result" role="status">
          <div className="small-title"><strong>{v.text}</strong><span className={'tag status-' + v.tone}>{result.engine === 'llm' ? 'AI check' : 'keyword check'} · {result.confidence} confidence</span></div>
          <ul>{result.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          {result.citations.length > 0 && <ul className="citations" aria-label="Clauses cited">{result.citations.map(c => <li key={c.id}><span className="diff-badge diff-change">§{c.id}</span> <span className="quiet">{c.kind}</span> “{c.text}”</li>)}</ul>}
          {result.note && <p className="fine">{result.note}</p>}
          <p className="fine">{result.engine === 'llm' ? `An AI reading (${ai?.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}) checked against the numbered clauses; it must cite clauses that exist.` : `A keyword check against your deliverables and exclusions${ai?.enabled ? '' : ' (AI check off: no OPENAI_API_KEY or ANTHROPIC_API_KEY on this server)'}.`} Read the request yourself before replying.</p>
          <label>Suggested reply<textarea rows={3} readOnly value={result.reply} onFocus={e => e.target.select()} /></label>
          <div className="actions">
            <button type="button" className="secondary" onClick={async () => { try { await navigator.clipboard.writeText(result.reply); setCopied(true); } catch { setCopied(false); } }}><Copy size={15} />{copied ? 'Copied' : 'Copy reply'}</button>
            {result.change_order && <button type="button" className="primary" disabled={busy} onClick={() => onDraft(result.change_order!)}>Draft change order</button>}
            {result.verdict === 'revision' && result.rounds_left > 0 && <button type="button" className="secondary" disabled={busy} onClick={() => onLogRound(message.trim().slice(0, 300))}>Log as revision round</button>}
          </div>
        </div>
      )}
    </details>
  );
}
