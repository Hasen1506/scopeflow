'use client';
import Link from 'next/link';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {Header, api} from '../../ui';
// The local billing double's checkout page (localhost servers without a billing provider only;
// the API answers 404 anywhere else). Completing it replays Razorpay's subscription events.
export default function TestCheckout() {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function pay() {
    setBusy(true); setError('');
    try { const sub = new URLSearchParams(location.search).get('subscription') ?? ''; await api('/api/billing/local/pay', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({subscription: sub})}); router.push('/plans?checkout=done'); router.refresh(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <><Header/><main id="content" tabIndex={-1} className="review-shell policy"><section className="editor">
    <p className="eyebrow">TEST CHECKOUT · NO MONEY MOVES</p><h1>Confirm your <em>test subscription.</em></h1>
    <p>This server has no billing provider configured, so this local stand-in for Razorpay completes the subscription without charging anyone.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="actions"><button className="primary" disabled={busy} onClick={() => void pay()}>{busy ? 'Confirming…' : 'Pay (test)'}</button><Link className="secondary" href="/plans?checkout=cancelled">Cancel</Link></div>
  </section></main></>;
}
