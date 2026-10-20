'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {api, post} from '@/app/ui';

/**
 * PR B + M14: the one-time code the creator can require before a decision, a change order or a
 * countersignature. A verified code yields a short-lived otp_session that backs exactly one record
 * (it is bound to that step and used once); the next step asks for a fresh code inline.
 *
 * `endpoint` defaults to the client link's /api/review/<token>/otp; a countersigner's own link
 * passes /api/cosign/<token>/otp. `target` binds a change-order code to one change order.
 */
const WORDS = {email: {where: 'your email', send: 'Email me a code', what: 'email'}, sms: {where: 'your phone', send: 'Text me a code', what: 'phone number'}, whatsapp: {where: 'your WhatsApp', send: 'Send a code on WhatsApp', what: 'phone number'}} as const;
export function OtpGate({token, to, channel = 'email', session, onVerified, purpose = 'a decision', endpoint, target}: {token: string; to: string | null; channel?: 'email' | 'sms' | 'whatsapp'; session: string; onVerified: (session: string, email: string) => void; purpose?: string; endpoint?: string; target?: number | null}) {
  const w = WORDS[channel] ?? WORDS.email;
  const path = endpoint ?? `/api/review/${token}/otp`;
  const [sent, setSent] = useState(''), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [email, setEmail] = useState(''), [wait, setWait] = useState(0);
  // Accessibility: focus the code field as soon as a code is sent, and announce where it went.
  const input = useRef<HTMLInputElement>(null);
  // A2: more than one gate can be on a page (decision, change order, countersign): ids are unique per instance.
  const uid = useId(), titleId = `otp-title-${uid}`, errorElId = `otp-error-${uid}`;
  useEffect(() => { if (sent) input.current?.focus(); }, [sent]);
  // M15: a cooldown between codes; the button says how long.
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(s => s - 1), 1000); return () => clearTimeout(t); }, [wait]);
  async function send() {
    setError(''); setBusy(true);
    try { const r = await api(path, post({action: 'send', ...(target != null ? {target} : {})})); setSent(r.to || w.where); setCode(''); }
    catch (e) { const err = e as Error & {data?: {retry_after?: number}}; setError(err.message); if (err.data?.retry_after) setWait(Math.min(900, Number(err.data.retry_after) || 0)); }
    finally { setBusy(false); }
  }
  async function verify() {
    setError(''); setBusy(true);
    try { const r = await api(path, post({action: 'verify', code})); setEmail(r.email || sent); onVerified(r.otp_session, r.email || sent); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (session) return <p className="chain ok" role="status">{channel === 'email' ? 'Email' : 'Phone number'} confirmed{email || sent ? ' (' + (email || sent) + ')' : ''} for {purpose}. A new code is needed for each signature.</p>;
  const sendLabel = wait > 0 ? `Wait ${wait}s` : null;
  return (
    <div className="muted-box otp-step" role="group" aria-labelledby={titleId}>
      <strong id={titleId}>Confirm your {w.what} first</strong>
      <p className="fine">The creator asks you to confirm a one-time code sent to {to ?? w.where} before recording {purpose}. The confirmation is recorded with it; each code is good for one step only.</p>
      {!sent
        ? <button className="secondary" disabled={busy || wait > 0} aria-busy={busy || undefined} onClick={send}>{busy ? 'Sending…' : sendLabel ?? w.send}</button>
        : <>
          <p className="fine" role="status">Code sent to {sent}. It expires in 10 minutes.</p>
          <label>6-digit code<input ref={input} inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={6} value={code} aria-invalid={error ? true : undefined} aria-describedby={error ? errorElId : undefined} onChange={e => { setCode(e.target.value.replace(/\D/g, '')); if (error) setError(''); /* A5: the error clears once the reader types again */ }} onKeyDown={e => { if (e.key === 'Enter' && code.length === 6 && !busy) void verify(); }} /></label>
          <div className="actions"><button className="primary" disabled={busy || code.length !== 6} onClick={verify}>{busy ? 'Checking…' : 'Verify code'}</button><button className="secondary" disabled={busy || wait > 0} onClick={send}>{sendLabel ?? 'Send a new code'}</button></div>
        </>}
      {error && <p className="error" role="alert" id={errorElId}>{error}</p>}
    </div>
  );
}
