'use client';
import {useEffect, useState} from 'react';
import {useParams} from 'next/navigation';
import {Header, api} from '../../../ui';
import type {BillingInvoiceContent} from '@/lib/billing';
// Printable copy of ScopeFlow's own invoice for a subscription payment.
const m = (minor: number, currency: string) => new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {style: 'currency', currency}).format(minor / 100);
export default function BillingInvoice() {
  const {id} = useParams<{id: string}>();
  const [inv, setInv] = useState<BillingInvoiceContent | null>(null), [error, setError] = useState('');
  useEffect(() => { api('/api/billing/invoices/' + id).then(r => setInv(r.invoice), e => setError(e.message)); }, [id]);
  return <><Header/><main id="content" tabIndex={-1} className="review-shell policy"><section className="editor">
    {error && <p className="error" role="alert">{error}</p>}
    {inv && <article aria-label={inv.title}>
      <p className="eyebrow">{inv.title.toUpperCase()} · {inv.number}</p><h1>{inv.seller.name}</h1>
      <p className="fine">{inv.seller.address}{inv.seller.gstin ? ` · GSTIN ${inv.seller.gstin}` : ''} · Issued {inv.issued.slice(0, 10)}</p>
      <p><strong>Billed to</strong><br/>{inv.buyer.name}{inv.buyer.gstin ? ` · GSTIN ${inv.buyer.gstin}` : ''}{inv.buyer.address ? <><br/>{inv.buyer.address}</> : null}</p>
      <p className="terms-line"><span>ScopeFlow {inv.plan}{inv.interval ? ` (${inv.interval}ly)` : ''}{inv.period.start ? `, ${inv.period.start.slice(0, 10)} to ${inv.period.end?.slice(0, 10) ?? ''}` : ''} · SAC {inv.seller.sac}</span><strong>{m(inv.tax.taxable_minor, inv.currency)}</strong></p>
      {inv.tax.cgst_minor > 0 && <><p className="terms-line"><span>CGST ({inv.tax.rate / 2}%)</span><strong>{m(inv.tax.cgst_minor, inv.currency)}</strong></p><p className="terms-line"><span>SGST ({inv.tax.rate / 2}%)</span><strong>{m(inv.tax.sgst_minor, inv.currency)}</strong></p></>}
      {inv.tax.igst_minor > 0 && <p className="terms-line"><span>IGST ({inv.tax.rate}%)</span><strong>{m(inv.tax.igst_minor, inv.currency)}</strong></p>}
      <p className="terms-line"><span>Total paid ({inv.provider}, {inv.payment})</span><strong>{m(inv.total_minor, inv.currency)}</strong></p>
      {inv.notes.map(n => <p key={n} className="fine">{n}</p>)}
      <button className="secondary" onClick={() => print()}>Print or save as PDF</button>
    </article>}
  </section></main></>;
}
