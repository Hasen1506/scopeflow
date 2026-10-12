'use client';
// Slot: CoCard. Owner: WS-05 (implements it). Mounted by: WS-07 (client page), WS-09 (workspace).
// One change order as a decision card: what it changes, the fee and total before/after (with the
// agreed tax), and, on the client page, the decision form. The client's decision carries
// `acknowledged: true` and `co_sha256`, the hash of the change order exactly as rendered here
// (lib/ledger.ts coCanonical); the server refuses a decision on content that changed (409 co_changed).
import {useEffect, useRef, useState} from 'react';
import {coSha256, coSummary, coTotals, pctOfMinor, type Agreement, type CoView} from '@/lib/ledger';
import {formatMoney, type Scope} from '@/lib/scope';
import {fromMinor, toMinor} from '@/lib/minor';
import {api, post} from '@/app/ui';
import styles from '../ws-05/ws-05.module.css';

export type CoCardProps = {
  co: CoView;
  agreement: Pick<Agreement, 'fee' | 'items' | 'removed' | 'currency'>;
  /** The approved scope's money terms (currency and tax). */
  scope: Pick<Scope, 'currency' | 'tax_pct' | 'tax_label'>;
  mode: 'client' | 'owner';
  /** Client mode: the review link token, the OTP session when required, and whether the record check passed. */
  token?: string; otpSession?: string; needsOtp?: boolean; verified?: boolean;
  onDecided?: (result: {status: string; receipt: Record<string, unknown>}) => void;
  /** Owner mode: withdraw / revise a proposed change order. */
  onWithdraw?: (seq: number) => void; onRevise?: (co: CoView) => void; busy?: boolean;
};

export default function CoCard({co, agreement, scope, mode, token, otpSession, needsOtp, verified = true, onDecided, onWithdraw, onRevise, busy}: CoCardProps) {
  const cur = scope.currency;
  const [hash, setHash] = useState('');
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inflight = useRef(false);
  useEffect(() => { let live = true; void coSha256(co, scope).then(h => { if (live) setHash(h); }); return () => { live = false; }; }, [co, scope]);
  const t = coTotals(co, scope);
  const feeNow = toMinor(agreement.fee, cur);
  const taxNow = scope.tax_pct ? pctOfMinor(feeNow, scope.tax_pct) : 0;
  const m = (n: number) => formatMoney(fromMinor(n, cur), cur);
  async function decide(decision: 'approved' | 'declined') {
    if (inflight.current) return;
    setError('');
    if (!verified) return setError('Wait for the record check to pass before recording a decision.');
    if (name.trim().length < 2) return setError('Enter your name to record this decision.');
    if (!checked) return setError(`Confirm that you reviewed CO-${co.seq} before recording a decision.`);
    if (decision === 'declined' && !comment.trim()) return setError('Please say why, so the creator can follow up.');
    if (needsOtp && !otpSession) return setError('Confirm your email with the code first.');
    if (!hash) return setError('Still preparing the fingerprint of this change order. Try again in a moment.');
    inflight.current = true; setSaving(true);
    try {
      const result = await api(`/api/review/${token}/change-order`, post({seq: co.seq, decision, signer: name, comment, acknowledged: true, co_sha256: hash, ...(otpSession ? {otp_session: otpSession} : {})}));
      onDecided?.(result);
    } catch (e) { setError((e as Error).message); } finally { inflight.current = false; setSaving(false); }
  }
  return (
    <div className={styles.card + ' co-card'} id={'co-card-' + co.seq} data-co-sha256={hash}>
      <p className={styles.eyebrow}>Change order CO-{co.seq}{co.revises ? ` · replaces CO-${co.revises}` : ''} · {co.status === 'proposed' ? (mode === 'client' ? 'awaiting you' : 'awaiting the client') : co.status}</p>
      <h3>{co.title}</h3>
      {co.request_quote && <blockquote>“{co.request_quote}”</blockquote>}
      {co.reason && <p className="quiet">{co.reason}</p>}
      <p><strong>{coSummary(co, cur, [...agreement.items, ...agreement.removed])}</strong></p>
      <div className={styles.totals}>
        <div><span>This change</span><strong>{m(t.fee_delta_minor)}</strong>{t.tax.pct > 0 && <span>+ {t.tax.label} {t.tax.pct}%: {m(t.tax.amount_minor)} = {m(t.total_incl_tax_minor)}</span>}</div>
        <div><span>Fee now{t.tax.pct > 0 ? ` (with ${t.tax.label})` : ''}</span><strong>{m(feeNow + taxNow)}</strong></div>
        <div><span>If approved{t.tax.pct > 0 ? ` (with ${t.tax.label})` : ''}</span><strong>{m(feeNow + taxNow + t.total_incl_tax_minor)}</strong></div>
      </div>
      {hash && <p className={styles.hash}>Fingerprint {hash}</p>}
      {mode === 'client' && co.status === 'proposed' && (
        <div className="no-print">
          <label>Your name<input maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
          <label>Comment <span className="quiet">· required if declining</span><textarea rows={2} maxLength={3000} value={comment} onChange={e => setComment(e.target.value)} /></label>
          <label className="consent"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />I have reviewed CO-{co.seq}, including its effect on the fee{t.tax.pct > 0 ? ` and ${t.tax.label}` : ''} and timeline.</label>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions"><button className="primary" disabled={saving || !verified} onClick={() => decide('approved')}>{saving ? 'Saving…' : 'Approve change'}</button><button className="secondary" disabled={saving || !verified} onClick={() => decide('declined')}>Decline</button></div>
        </div>
      )}
      {mode === 'owner' && co.status === 'proposed' && (onWithdraw || onRevise) && (
        <div className="actions">
          {onRevise && <button className="secondary" disabled={busy} onClick={() => onRevise(co)}>Revise</button>}
          {onWithdraw && <button className="link-button" disabled={busy} onClick={() => onWithdraw(co.seq)}>Withdraw</button>}
        </div>
      )}
    </div>
  );
}
