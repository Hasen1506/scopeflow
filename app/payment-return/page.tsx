'use client';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import {Header} from '../ui';

/**
 * Where Stripe Checkout sends the client back. The review link is never given to Stripe: the review
 * page keeps it in this tab's session storage before leaving, and this page returns to it.
 */
export default function PaymentReturn() {
  const [state, setState] = useState<'checking' | 'none'>('checking');
  useEffect(() => {
    const status = new URLSearchParams(location.search).get('status') === 'success' ? 'success' : 'cancel';
    let token = '';
    try { token = sessionStorage.getItem('scopeflow:payment-return') ?? ''; sessionStorage.removeItem('scopeflow:payment-return'); } catch { /* storage blocked */ }
    if (/^[a-f0-9]{64}$/.test(token)) location.replace(`/review/${token}?payment=${status}`);
    else queueMicrotask(() => setState('none'));
  }, []);
  return <><Header /><main id="main" className="shell" aria-busy={state === 'checking'}>
    {state === 'checking' ? <p role="status">Returning to your scope…</p> : <section className="editor"><h1>Payment</h1><p className="section-gap">If you completed the payment, it appears on your scope’s record once the payment provider confirms it. Open your review link again from the email you received to see it.</p><p className="section-gap"><Link className="secondary" href="/">Scopeflow home</Link></p></section>}
  </main></>;
}
