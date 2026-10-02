'use client';
import {useState} from 'react';
import {Copy, Search} from 'lucide-react';
import {checkRequest, type CheckResult} from '@/lib/check';
import type {Agreement, ChangeOrder} from '@/lib/ledger';
import type {Scope} from '@/lib/scope';

const verdicts: Record<CheckResult['verdict'], {text: string; tone: string}> = {
  in_scope: {text: 'Looks in scope', tone: 'approved'},
  revision: {text: 'Revision round', tone: 'pending'},
  out_of_scope: {text: 'Looks out of scope', tone: 'changes_requested'},
  ambiguous: {text: 'Unclear', tone: 'pending'},
};

/** Paste a client message and get a cited, explainable first read on whether it is covered. */
export function ScopeCheck({scope, agreement, busy, onDraft, onLogRound}: {
  scope: Scope; agreement: Agreement; busy: boolean;
  onDraft: (co: Partial<ChangeOrder>) => void;
  onLogRound: (note: string) => void;
}) {
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [copied, setCopied] = useState(false);
  const v = result && verdicts[result.verdict];
  return (
    <details className="scope-check section-gap">
      <summary><Search size={15} /> Is this in scope?</summary>
      <label>Client’s request<textarea rows={3} maxLength={4000} value={message} placeholder="Paste the email or chat message" onChange={e => { setMessage(e.target.value); setResult(null); }} /></label>
      <button type="button" className="secondary" disabled={message.trim().length < 5} onClick={() => setResult(checkRequest(message, scope, agreement))}>Check against the agreement</button>
      {result && v && (
        <div className="check-result" role="status">
          <div className="small-title"><strong>{v.text}</strong><span className={'tag status-' + v.tone}>{result.confidence} confidence</span></div>
          <ul>{result.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <p className="fine">A keyword check against your deliverables and exclusions, not a judgment. Read the request yourself before replying.</p>
          <label>Suggested reply<textarea rows={3} readOnly value={result.reply} onFocus={e => e.target.select()} /></label>
          <div className="actions">
            <button type="button" className="secondary" onClick={async () => { try { await navigator.clipboard.writeText(result.reply); setCopied(true); } catch { setCopied(false); } }}><Copy size={15} />{copied ? 'Copied' : 'Copy reply'}</button>
            {result.change_order && <button type="button" className="primary" disabled={busy} onClick={() => onDraft(result.change_order!)}>Draft change order from this</button>}
            {result.verdict === 'revision' && result.rounds_left > 0 && <button type="button" className="secondary" disabled={busy} onClick={() => onLogRound(message.trim().slice(0, 300))}>Log as revision round</button>}
          </div>
        </div>
      )}
    </details>
  );
}
