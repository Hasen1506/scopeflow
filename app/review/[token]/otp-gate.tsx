'use client';
import {useEffect, useRef, useState} from 'react';
import {api, post} from '@/app/ui';

/**
 * PR B: the email one-time code the creator can require before the client records a decision,
 * on the scope itself or on a change order. A verified code yields a short-lived otp_session
 * that the decision request carries; the server records the confirmation with the decision.
 */
const WORDS = {email: {where: 'your email', send: 'Email me a code', what: 'email'}, sms: {where: 'your phone', send: 'Text me a code', what: 'phone number'}, whatsapp: {where: 'your WhatsApp', send: 'Send a code on WhatsApp', what: 'phone number'}} as const;
export function OtpGate({token, to, channel = 'email', session, onVerified, purpose = 'a decision'}: {token: string; to: string | null; channel?: 'email' | 'sms' | 'whatsapp'; session: string; onVerified: (session: string, email: string) => void; purpose?: string}) {
  const w = WORDS[channel] ?? WORDS.email;
  const [sent, setSent] = useState(''), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [email, setEmail] = useState('');
  // Accessibility: focus the code field as soon as a code is sent, and announce where it went.
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (sent) input.current?.focus(); }, [sent]);
  async function send() {
    setError(''); setBusy(true);
    try { const r = await api(`/api/review/${token}/otp`, post({action: 'send'})); setSent(r.to || w.where); setCode(''); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function verify() {
    setError(''); setBusy(true);
    try { const r = await api(`/api/review/${token}/otp`, post({action: 'verify', code})); setEmail(r.email || sent); onVerified(r.otp_session, r.email || sent); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (session) return <p className="chain ok" role="status">{channel === 'email' ? 'Email' : 'Phone number'} confirmed{email || sent ? ' (' + (email || sent) + ')' : ''}</p>;
  return (
    <div className="muted-box otp-step" role="group" aria-labelledby="otp-title">
      <strong id="otp-title">Confirm your {w.what} first</strong>
      <p className="fine">The creator asks you to confirm a one-time code sent to {to ?? w.where} before recording {purpose}. The confirmation is recorded with your decision.</p>
      {!sent
        ? <button className="secondary" disabled={busy} aria-busy={busy || undefined} onClick={send}>{busy ? 'Sending…' : w.send}</button>
        : <>
          <p className="fine" role="status">Code sent to {sent}. It expires in 10 minutes.</p>
          <label>6-digit code<input ref={input} inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={6} value={code} aria-invalid={error ? true : undefined} aria-describedby={error ? 'otp-error' : undefined} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={e => { if (e.key === 'Enter' && code.length === 6 && !busy) void verify(); }} /></label>
          <div className="actions"><button className="primary" disabled={busy || code.length !== 6} onClick={verify}>{busy ? 'Checking…' : 'Verify code'}</button><button className="secondary" disabled={busy} onClick={send}>Send a new code</button></div>
        </>}
      {error && <p className="error" role="alert" id="otp-error">{error}</p>}
    </div>
  );
}
