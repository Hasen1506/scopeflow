'use client';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import {Header} from '../ui';

/**
 * Where Stripe Checkout sends the client back (L5). The success URL carries Stripe's session id
 * and an opaque reference, never the review link: the server looks the session up on the
 * freelancer's Stripe account, records the payment when it is paid, and answers with the review
 * link to return to. That works in a new tab or an in-app browser. Older sessions fall back to the
 * review link kept in this tab's session storage.
 */
export default function PaymentReturn() {
  const [state, setState] = useState<'checking' | 'none' | 'pending'>('checking');
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const status = q.get('status') === 'success' ? 'success' : 'cancel';
    const sessionId = q.get('session_id') ?? '', ref = q.get('ref') ?? '';
    let stored = '';
    try { stored = sessionStorage.getItem('scopeflow:payment-return') ?? ''; sessionStorage.removeItem('scopeflow:payment-return'); } catch { /* storage blocked */ }
    const fallback = () => { if (/^[a-f0-9]{64}$/.test(stored)) location.replace(`/review/${stored}?payment=${status}`); else setState('none'); };
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId) || !/^[a-f0-9]{32}$/.test(ref)) { queueMicrotask(fallback); return; }
    fetch(`/api/payments/stripe/return?session_id=${encodeURIComponent(sessionId)}&ref=${ref}`).then(r => r.json()).then((d: {token?: string | null; paid?: boolean}) => {
      if (d.token && /^[a-f0-9]{64}$/.test(d.token)) location.replace(`/review/${d.token}?payment=${status === 'success' ? (d.paid ? 'success' : 'pending') : 'cancel'}`);
      else fallback();
    }, fallback);
  }, []);
  return <><Header /><main id="main" className="shell" aria-busy={state === 'checking'}>
    {state === 'checking' ? <p role="status">Returning to your scope…</p> : <section className="editor"><h1>Payment</h1><p className="section-gap">If you completed the payment, it appears on your scope’s record once the payment provider confirms it. Open your review link again from the email you received to see it.</p><p className="section-gap"><Link className="secondary" href="/">Scopeflow home</Link></p></section>}
  </main></>;
}
