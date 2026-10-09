'use client';
import {useState} from 'react';
import {api, post} from '@/app/ui';

/**
 * PR B: the email one-time code the creator can require before the client records a decision,
 * on the scope itself or on a change order. A verified code yields a short-lived otp_session
 * that the decision request carries; the server records the confirmation with the decision.
 */
export function OtpGate({token, to, session, onVerified, purpose = 'a decision'}: {token: string; to: string | null; session: string; onVerified: (session: string, email: string) => void; purpose?: string}) {
  const [sent, setSent] = useState(''), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [email, setEmail] = useState('');
  async function send() {
    setError(''); setBusy(true);
    try { const r = await api(`/api/review/${token}/otp`, post({action: 'send'})); setSent(r.to || 'your email'); setCode(''); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function verify() {
    setError(''); setBusy(true);
    try { const r = await api(`/api/review/${token}/otp`, post({action: 'verify', code})); setEmail(r.email || sent); onVerified(r.otp_session, r.email || sent); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (session) return <p className="chain ok" role="status">Email confirmed{email || sent ? ' (' + (email || sent) + ')' : ''}</p>;
  return (
    <div className="muted-box otp-step">
      <strong>Confirm your email first</strong>
      <p className="fine">The creator asks you to confirm a one-time code sent to {to ?? 'your email'} before recording {purpose}. The confirmation is recorded with your decision.</p>
      {!sent
        ? <button className="secondary" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Email me a code'}</button>
        : <>
          <label>6-digit code sent to {sent}<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} aria-describedby={error ? 'otp-error' : undefined} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={e => { if (e.key === 'Enter' && code.length === 6 && !busy) void verify(); }} /></label>
          <div className="actions"><button className="primary" disabled={busy || code.length !== 6} onClick={verify}>{busy ? 'Checking…' : 'Verify code'}</button><button className="secondary" disabled={busy} onClick={send}>Send a new code</button></div>
        </>}
      {error && <p className="error" role="alert" id="otp-error">{error}</p>}
    </div>
  );
}
