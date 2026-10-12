'use client';
import {useCallback, useEffect, useState} from 'react';
import {MessageCircle} from 'lucide-react';
import {api, post} from './ui';

// Account → WhatsApp (SF-04, WS-06; mounted by WS-08 in the account page). Links the owner's number
// to Scopeflow's WhatsApp bot with a one-time code, after the owner accepts the consent text.
type State = {configured: boolean; linked: null | {phone: string; since: string}; bot_number: string | null; consent: string};
export function WhatsAppSettings() {
  const [s, setS] = useState<State | null>(null), [phone, setPhone] = useState(''), [code, setCode] = useState(''), [consent, setConsent] = useState(false);
  const [step, setStep] = useState<'idle' | 'code'>('idle'), [busy, setBusy] = useState(false), [msg, setMsg] = useState(''), [error, setError] = useState('');
  const load = useCallback(() => api('/api/whatsapp/link').then(setS, () => setS(null)), []);
  useEffect(() => { void load(); }, [load]);
  if (!s) return null;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); setMsg(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <div className="section-gap" role="group" aria-labelledby="h-wa">
    <h3 className="h-sub" id="h-wa"><MessageCircle size={15} aria-hidden="true" /> WhatsApp bot</h3>
    {!s.configured ? <p className="fine">The WhatsApp bot is not set up on this server.</p>
      : s.linked ? <><p>Linked to {s.linked.phone}. Forward a client’s message {s.bot_number ? <>to <strong>{s.bot_number}</strong></> : 'to the Scopeflow number'} and the bot checks it against the agreement and drafts a change order. It replies only to you and never messages your clients.</p>
          <button className="secondary" disabled={busy} onClick={() => void run(async () => { await api('/api/whatsapp/link', {method: 'DELETE', headers: {'Content-Type': 'application/json'}}); await load(); })}>Unlink</button></>
      : step === 'idle'
        ? <form onSubmit={e => { e.preventDefault(); void run(async () => { await api('/api/whatsapp/link', post({phone: phone.trim(), consent: true})); setStep('code'); setMsg('We sent a 6-digit code to that number on WhatsApp.'); }); }}>
            <label>Your WhatsApp number<input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+919876543210" inputMode="tel" required /></label>
            <label className="fine"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required /> {s.consent}</label>
            <button className="secondary" disabled={busy || !consent}>Send code</button>
          </form>
        : <form onSubmit={e => { e.preventDefault(); void run(async () => { await api('/api/whatsapp/link', post({phone: phone.trim(), code: code.trim()})); setStep('idle'); await load(); }); }}>
            <label>Code<input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" pattern="\d{6}" maxLength={6} required /></label>
            <button className="secondary" disabled={busy}>Link number</button>
          </form>}
    {msg && <p className="fine" role="status">{msg}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
