'use client';
import Link from 'next/link';
import {useCallback, useEffect, useState} from 'react';
import {FilePlus2} from 'lucide-react';
import {toast} from 'sonner';
import {api, post, type ApiError} from './ui';
import {formatMoney} from '@/lib/scope';
import {formatDay} from '@/lib/time';
import {gstinState, stateCodes, stateName} from '@/lib/gst';

type InvoiceView = {seq: number; number: string; amount: number; currency: string; issued: string; due: string; description: string; tax_invoice: boolean; milestone: string | null; covered: number; open: number; status: 'paid' | 'part' | 'open'; overdue: boolean; days_overdue: number};
type ScheduleView = {id: string; title: string; pct: number; due: string; amount: number; invoiced: number};
type Billing = {client_gstin: string; client_state: string; client_address: string};

const statusText = (i: InvoiceView) => i.status === 'paid' ? 'Paid' : i.overdue ? `Overdue ${i.days_overdue} day${i.days_overdue === 1 ? '' : 's'}` : i.status === 'part' ? `${formatMoney(i.open, i.currency)} open` : 'Open';

/** Numbered invoices for the approved agreement: each is frozen when issued and downloads as a PDF. */
export function InvoicePanel({projectId, currency, balance, archived}: {projectId: string; currency: string; balance: number; archived: boolean}) {
  const [invoices, setInvoices] = useState<InvoiceView[] | null>(null);
  const [plan, setPlan] = useState<ScheduleView[]>([]);
  const [netDays, setNetDays] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [milestone, setMilestone] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [dueDays, setDueDays] = useState('15');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsProfile, setNeedsProfile] = useState(false);
  const [requestId, setRequestId] = useState(''); // made when the form opens, so a retried submit is not issued twice
  const [billing, setBilling] = useState<Billing | null>(null);
  const [billingOpen, setBillingOpen] = useState(false);
  const load = useCallback(() => Promise.all([
    api(`/api/scopes/${projectId}/invoices`).then(d => { setInvoices(d.invoices); setPlan(d.schedule ?? []); setNetDays(d.net_days ?? null); }, () => setInvoices([])),
    api(`/api/scopes/${projectId}`).then(d => setBilling({client_gstin: d.project.client_gstin ?? '', client_state: d.project.client_state ?? '', client_address: d.project.client_address ?? ''}), () => {}),
  ]), [projectId]);
  useEffect(() => { void load(); }, [load]);
  const openOf = (m: ScheduleView) => Math.max(0, Math.round((m.amount - m.invoiced) * 100) / 100);
  function pick(id: string) {
    setMilestone(id);
    const m = plan.find(x => x.id === id);
    setAmount(m ? String(Math.min(openOf(m), balance)) : balance > 0 ? String(balance) : '');
  }
  function start() {
    const next = plan.find(m => openOf(m) > 0);
    setMilestone(next?.id ?? ''); setAmount(next ? String(Math.min(openOf(next), balance)) : balance > 0 ? String(balance) : '');
    setDescription(''); setDueDays(String(netDays ?? 15)); setError(''); setNeedsProfile(false); setRequestId(crypto.randomUUID()); setOpen(true);
  }
  async function issue(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNeedsProfile(false);
    try {
      const r = await api(`/api/scopes/${projectId}/invoices`, post({amount: Math.round(Number(amount) * 100) / 100, description, due_days: Number(dueDays) || 0, request_id: requestId, ...(milestone ? {milestone_id: milestone} : {})}));
      toast.success(`Invoice ${r.invoice.number} issued.`); setOpen(false); await load();
    } catch (err) { const x = err as ApiError; setNeedsProfile(x.code === 'profile_required'); setError(x.message); }
    finally { setBusy(false); }
  }
  async function saveBilling(e: React.FormEvent) {
    e.preventDefault(); if (!billing) return; setBusy(true); setError('');
    try {
      const r = await api(`/api/scopes/${projectId}`, {...post(billing), method: 'PATCH'});
      setBilling({client_gstin: r.project.client_gstin, client_state: r.project.client_state, client_address: r.project.client_address}); setBillingOpen(false); toast.success('Client billing details saved. They are printed on new invoices.');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  const pos = billing ? (gstinState(billing.client_gstin) || billing.client_state) : '';
  return (
    <div className="section-gap">
      <div className="small-title"><h4 className="h-sub">Invoices</h4>{!open && !archived && balance > 0 && <button className="secondary" onClick={start}><FilePlus2 size={15} />Create invoice</button>}</div>
      {plan.length > 0 && <ul className="receipt-list payment-list" aria-label="Payment schedule">{plan.map(m => <li key={m.id}><span><strong>{m.title}</strong> · {m.pct}% · {formatMoney(m.amount, currency)}{m.due ? ` · due ${formatDay(m.due)}` : ''}</span><span className="fine">{m.invoiced >= m.amount - 0.005 ? 'Invoiced' : m.invoiced > 0 ? `${formatMoney(m.invoiced, currency)} invoiced` : 'Not invoiced'}</span></li>)}</ul>}
      {open && (
        <form className="ledger-form" aria-label="Create invoice" onSubmit={issue}>
          {plan.length > 0 && <label>Milestone<select value={milestone} onChange={e => pick(e.target.value)}><option value="">No milestone (any amount)</option>{plan.map(m => <option key={m.id} value={m.id} disabled={openOf(m) <= 0}>{m.title} · {formatMoney(openOf(m), currency)} to invoice</option>)}</select></label>}
          <div className="two-col"><label>Amount, including tax ({currency})<input type="number" min={0.01} step="0.01" max={balance} inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)} /><span className="fine block">Up to the {formatMoney(balance, currency)} still due.</span></label><label>Due in (days)<input type="number" min={0} max={120} step={1} required value={dueDays} onChange={e => setDueDays(e.target.value)} />{netDays !== null && <span className="fine block">Net {netDays} from the payment terms.</span>}</label></div>
          <label>Description <span className="quiet">· optional</span><input maxLength={200} placeholder={milestone ? 'Milestone payment for the approved scope' : 'Balance for the approved scope'} value={description} onChange={e => setDescription(e.target.value)} /></label>
          <p className="fine">Invoices are numbered in order and cannot be edited or deleted once issued. Your business details from Data controls are printed as the seller{pos ? `; place of supply ${stateName(pos)}` : ''}.</p>
          {error && <p className="error" role="alert">{error}{needsProfile && <> <Link className="help-link" href="/account#h-business">Add business details</Link></>}</p>}
          <div className="actions"><button type="submit" className="primary" disabled={busy}>{busy ? 'Issuing…' : 'Issue invoice'}</button><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
      {invoices && invoices.length > 0
        ? <ul className="receipt-list payment-list">{invoices.map(i => <li key={i.seq}><span><strong>{i.number}</strong>{i.tax_invoice ? ' (tax invoice)' : ''} · {formatMoney(i.amount, i.currency)} · issued {formatDay(i.issued)}, due {formatDay(i.due)} · <span className={i.overdue ? 'warn-text' : i.status === 'paid' ? 'ok-text' : ''}>{statusText(i)}</span></span><a className="help-link" href={`/api/scopes/${projectId}/invoices/${i.seq}`} download>PDF</a></li>)}</ul>
        : invoices && !open && <p className="fine">{balance > 0 ? 'Create a numbered invoice for the balance due, or part of it. Record the payment above when the money arrives.' : 'Nothing is due, so there is nothing to invoice.'}</p>}
      {billing && (
        <details className="disclosure" open={billingOpen || undefined} onToggle={e => setBillingOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Client billing details <span className="quiet">· {billing.client_gstin || (billing.client_state ? stateName(billing.client_state) : 'for tax invoices, optional')}</span></summary>
          <form className="ledger-form" aria-label="Client billing details" onSubmit={saveBilling}>
            <div className="two-col">
              <label>Client GSTIN <span className="quiet">· if registered</span><input maxLength={15} autoComplete="off" value={billing.client_gstin} onChange={e => setBilling({...billing, client_gstin: e.target.value.toUpperCase()})} /></label>
              <label>Client state<select value={billing.client_state} onChange={e => setBilling({...billing, client_state: e.target.value})}><option value="">{gstinState(billing.client_gstin) ? `From the GSTIN (${stateName(gstinState(billing.client_gstin))})` : 'Not set'}</option>{stateCodes.map(c => <option key={c} value={c}>{c === '96' ? stateName(c) : `${c} · ${stateName(c)}`}</option>)}</select></label>
            </div>
            <label>Billing address<textarea rows={2} maxLength={500} value={billing.client_address} onChange={e => setBilling({...billing, client_address: e.target.value})} /></label>
            <p className="fine">Printed on new invoices. The place of supply is the client’s GSTIN state, else the state above; with neither, an Indian client is billed from your own state and a client billed in another currency is treated as an export.</p>
            <div className="actions"><button type="submit" className="secondary" disabled={busy}>Save billing details</button></div>
          </form>
        </details>
      )}
    </div>
  );
}
