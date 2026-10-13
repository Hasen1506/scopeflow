'use client';
import Link from 'next/link';
import {useCallback, useEffect, useRef, useState} from 'react';
import {FilePlus2} from 'lucide-react';
import {toast} from 'sonner';
import {api, post, Skeleton, type ApiError} from './ui';
import {formatMoney} from '@/lib/scope';
import {formatDay} from '@/lib/time';
import {gstinState, stateCodes, stateName} from '@/lib/gst';
import TdsField, {type TdsValue} from './components/slots/tds-field';
import MsmedTerms from './components/slots/msmed-terms';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {focusFirstField, restoreFocus} from './a11y';
import {creditReasonProblem, CREDIT_REASON_MAX, describedBy} from '@/lib/a11y';

type Status = 'paid' | 'paid_net_of_tds' | 'tds_credited' | 'part' | 'open' | 'cancelled';
type InvoiceView = {seq: number; number: string; amount: number; currency: string; issued: string; due: string; description: string; tax_invoice: boolean; milestone: string | null; covered: number; open: number; status: Status; overdue: boolean; days_overdue: number; change_order: number | null; credited: number; cancelled_by: string[]; tds: {amount: number; net_receivable: number; label: string; rate_pct: number; credited: number} | null; open_with_tds: number; advance_adjusted: string[]};
type ScheduleView = {id: string; title: string; pct: number; due: string; amount: number; invoiced: number};
type CoView = {seq: number; title: string; fee_delta: number; display: string; total: number; invoiced: number};
type Voucher = {seq: number; number: string; kind: string; amount: number; received: string; adjusted: boolean};
type Credit = {seq: number; number: string; invoice_number: string; amount: number; full: boolean; reason: string};
type Billing = {client_gstin: string; client_state: string; client_address: string};
type Invoicing = {invoices: InvoiceView[]; schedule: ScheduleView[]; change_orders: CoView[]; net_days: number | null; invoiceable: {total: number; gross_total: number; advances: number; agreement_total: number} | null; receipt_vouchers: Voucher[]; credit_notes: Credit[]; tds: {terms: TdsValue}; msmed: {invoices: {seq: number; text: string}[]}};

const statusText = (i: InvoiceView) => i.status === 'cancelled' ? `Cancelled by ${i.cancelled_by.join(', ')}` : i.status === 'paid' ? 'Paid' : i.status === 'paid_net_of_tds' ? 'Paid net of TDS (certificate pending)' : i.status === 'tds_credited' ? 'Paid (TDS credited)' : i.overdue ? `Overdue ${i.days_overdue} day${i.days_overdue === 1 ? '' : 's'}` : i.status === 'part' ? `${formatMoney(i.open, i.currency)} open` : 'Open';
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Numbered invoices for the approved agreement: each is frozen when issued and downloads as a PDF. */
export function InvoicePanel({projectId, currency, balance, archived}: {projectId: string; currency: string; balance: number; archived: boolean}) {
  const [data, setData] = useState<Invoicing | null>(null);
  const [open, setOpen] = useState(false);
  const [milestone, setMilestone] = useState('');
  const [co, setCo] = useState('');
  const [amount, setAmount] = useState('');
  const [includesTax, setIncludesTax] = useState(false);
  const [tds, setTds] = useState<TdsValue>(null);
  const [description, setDescription] = useState('');
  const [dueDays, setDueDays] = useState('15');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsProfile, setNeedsProfile] = useState(false);
  const [requestId, setRequestId] = useState(''); // made when the form opens, so a retried submit is not issued twice
  const [billing, setBilling] = useState<Billing | null>(null);
  const [billingOpen, setBillingOpen] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [loadError, setLoadError] = useState('');
  const load = useCallback(() => Promise.all([
    // UX-C21: a failed load is an error with a retry, never an empty list (which reads as "no invoices yet").
    api(`/api/scopes/${projectId}/invoices`).then((d: Invoicing) => { setData(d); setLoadError(''); }, (e: Error) => setLoadError(e.message || 'Request failed.')),
    api(`/api/scopes/${projectId}`).then(d => setBilling({client_gstin: d.project.client_gstin ?? '', client_state: d.project.client_state ?? '', client_address: d.project.client_address ?? ''}), () => {}),
  ]), [projectId]);
  useEffect(() => { void load(); }, [load]);
  const invoices = data?.invoices ?? null, plan = data?.schedule ?? [], cos = data?.change_orders ?? [];
  // C2: what is still uninvoiced on the agreement (falls back to the balance before the API answers).
  const left = data?.invoiceable ? data.invoiceable.total : balance;
  const leftGross = data?.invoiceable ? data.invoiceable.gross_total : balance;
  const openOf = (m: {amount?: number; total?: number; invoiced: number}) => Math.max(0, r2((m.amount ?? m.total ?? 0) - m.invoiced));
  function pick(id: string) {
    setMilestone(id); setCo('');
    const m = plan.find(x => x.id === id);
    if (m) { setAmount(String(Math.min(openOf(m), leftGross))); setIncludesTax(true); } else { setAmount(''); setIncludesTax(false); }
  }
  function pickCo(seq: string) {
    setCo(seq); setMilestone('');
    const c = cos.find(x => String(x.seq) === seq);
    if (c) { setAmount(String(Math.min(openOf(c), leftGross))); setIncludesTax(true); } else { setAmount(''); setIncludesTax(false); }
  }
  function start() {
    const next = plan.find(m => openOf(m) > 0);
    setMilestone(next?.id ?? ''); setCo(''); setAmount(next ? String(Math.min(openOf(next), leftGross)) : ''); setIncludesTax(!!next);
    setTds(data?.tds.terms ?? null); setDescription(''); setDueDays(String(data?.net_days ?? 15)); setError(''); setNeedsProfile(false); setRequestId(crypto.randomUUID()); opener.current = document.activeElement as HTMLElement | null; setOpen(true);
  }
  async function issue(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNeedsProfile(false);
    try {
      const r = await api(`/api/scopes/${projectId}/invoices`, post({amount: r2(Number(amount)), includes_tax: includesTax, description, due_days: Number(dueDays) || 0, request_id: requestId, tds: tds && tds.rate_pct > 0 ? {section_2025: tds.section_2025, rate_pct: tds.rate_pct} : null, ...(milestone ? {milestone_id: milestone} : {}), ...(co ? {change_order_seq: Number(co)} : {})}));
      toast.success(`Invoice ${r.invoice.number} issued.`); closeForm(); await load();
    } catch (err) { const x = err as ApiError; setNeedsProfile(x.code === 'profile_required'); setError(x.message); }
    finally { setBusy(false); }
  }
  // UX-C41: the credit-note reason is asked in an in-app dialog (required, 3–300 characters), not window.prompt,
  // so an empty reason and a cancel are no longer the same thing and the reason can be checked before it is printed.
  const [crediting, setCrediting] = useState<InvoiceView | null>(null);
  async function cancelInvoice(i: InvoiceView, reason: string) {
    setBusy(true);
    try { const r = await api(`/api/scopes/${projectId}/credit-notes`, post({invoice_seq: i.seq, reason: reason.trim(), request_id: crypto.randomUUID()})); toast.success(`Credit note ${r.credit_note.number} issued.`); setCrediting(null); await load(); return null; }
    catch (err) { return (err as Error).message; } finally { setBusy(false); }
  }
  // UX-C46: the invoice form takes focus when it opens and gives it back to "Create invoice" when it closes.
  const formRef = useRef<HTMLFormElement>(null), opener = useRef<HTMLElement | null>(null), headRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) focusFirstField(formRef.current); }, [open]);
  function closeForm() { setOpen(false); restoreFocus(opener.current, headRef.current?.querySelector('button')); }
  async function saveBilling(e: React.FormEvent) {
    e.preventDefault(); if (!billing) return; setBusy(true); setBillingError('');
    try {
      const r = await api(`/api/scopes/${projectId}`, {...post(billing), method: 'PATCH'});
      setBilling({client_gstin: r.project.client_gstin, client_state: r.project.client_state, client_address: r.project.client_address}); setBillingOpen(false); toast.success('Client billing details saved. They are printed on new invoices.');
    } catch (err) { setBillingError((err as Error).message); } finally { setBusy(false); }
  }
  const pos = billing ? (gstinState(billing.client_gstin) || billing.client_state) : '';
  const interest = new Map((data?.msmed.invoices ?? []).map(x => [x.seq, x.text]));
  return (
    <div className="section-gap">
      <div className="small-title" ref={headRef}><h4 className="h-sub">Invoices</h4>{data && !open && !archived && leftGross > 0 && <button className="secondary" onClick={start}><FilePlus2 size={15} />Create invoice</button>}</div>
      {loadError
        ? <p className="error" role="alert">Couldn’t load invoices ({loadError}). <button type="button" className="help-link" onClick={() => void load()}>Retry</button></p>
        : !data && <Skeleton lines={2} label="Loading invoices…" />}
      {data?.invoiceable && <p className="fine" data-testid="invoiceable">Up to {formatMoney(left, currency)} still to invoice{data.invoiceable.advances > 0 ? `, plus ${formatMoney(data.invoiceable.advances, currency)} received as an advance that the final invoice adjusts` : ''} (agreed total {formatMoney(data.invoiceable.agreement_total, currency)}).</p>}
      {plan.length > 0 && <ul className="receipt-list payment-list" aria-label="Payment schedule">{plan.map(m => <li key={m.id}><span><strong>{m.title}</strong> · {m.pct}% · {formatMoney(m.amount, currency)}{m.due ? ` · due ${formatDay(m.due)}` : ''}</span><span className="fine">{m.invoiced >= m.amount - 0.005 ? 'Invoiced' : m.invoiced > 0 ? `${formatMoney(m.invoiced, currency)} invoiced` : 'Not invoiced'}</span></li>)}</ul>}
      {cos.length > 0 && <ul className="receipt-list payment-list" aria-label="Approved change orders">{cos.map(c => <li key={c.seq}><span><strong>CO {c.title}</strong> · <span data-testid="co-display">{c.display}</span></span><span className="fine">{c.invoiced >= c.total - 0.005 ? 'Invoiced' : c.invoiced > 0 ? `${formatMoney(c.invoiced, currency)} invoiced` : 'Not invoiced'}</span></li>)}</ul>}
      {open && (
        <form ref={formRef} className="ledger-form" aria-label="Create invoice" onSubmit={issue}>
          {plan.length > 0 && <label>Milestone<select value={milestone} onChange={e => pick(e.target.value)}><option value="">No milestone (any amount)</option>{plan.map(m => <option key={m.id} value={m.id} disabled={openOf(m) <= 0}>{m.title} · {formatMoney(openOf(m), currency)} to invoice</option>)}</select></label>}
          {cos.length > 0 && <label>Change order<select value={co} onChange={e => pickCo(e.target.value)}><option value="">None</option>{cos.map(c => <option key={c.seq} value={c.seq} disabled={openOf(c) <= 0}>{c.title} · {formatMoney(openOf(c), currency)} to invoice</option>)}</select></label>}
          <div className="two-col"><label>{includesTax ? `Amount, including tax (${currency})` : `Amount before tax, the taxable value (${currency})`}<input type="number" min={0.01} step="0.01" inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)} /><span className="fine block">Up to {formatMoney(left, currency)} with tax still to invoice.</span></label><label>Due in (days)<input type="number" min={0} max={120} step={1} required value={dueDays} onChange={e => setDueDays(e.target.value)} />{data?.net_days != null && <span className="fine block">Net {data.net_days} from the payment terms.</span>}</label></div>
          <label className="consent"><input type="checkbox" checked={includesTax} onChange={e => setIncludesTax(e.target.checked)} /> The amount includes GST</label>
          <label>Description <span className="quiet">· optional</span><input maxLength={200} placeholder={milestone ? 'Milestone payment for the approved scope' : 'Balance for the approved scope'} value={description} onChange={e => setDescription(e.target.value)} /></label>
          <TdsField value={tds} onChange={setTds} label="TDS on this invoice" />
          <p className="consequence">Invoices are numbered in order and cannot be edited or deleted once issued; cancel one with a credit note. Your business details from Data controls are printed as the seller{pos ? `; place of supply ${stateName(pos)}` : ''}.</p>
          {error && <p className="error" role="alert">{error}{needsProfile && <> <Link className="help-link" href="/account#h-business">Add business details</Link></>}</p>}
          <div className="actions"><button type="submit" className="primary" disabled={busy}>{busy ? 'Issuing…' : 'Issue invoice'}</button><button type="button" className="secondary" disabled={busy} onClick={closeForm}>Cancel</button></div>
        </form>
      )}
      {invoices && invoices.length > 0
        ? <ul className="receipt-list payment-list">{invoices.map(i => <li key={i.seq}><span><strong>{i.number}</strong>{i.tax_invoice ? ' (tax invoice)' : ''} · {formatMoney(i.amount, i.currency)} · issued {formatDay(i.issued)}, due {formatDay(i.due)} · <span className={i.overdue ? 'warn-text' : i.status === 'paid' || i.status === 'tds_credited' ? 'ok-text' : ''}>{statusText(i)}</span>{i.tds && <span className="fine block" data-testid="tds-line">TDS expected {formatMoney(i.tds.amount, i.currency)} ({i.tds.label}); net receivable {formatMoney(i.tds.net_receivable, i.currency)}</span>}{i.advance_adjusted.length > 0 && <span className="fine block">Adjusts advance {i.advance_adjusted.join(', ')}</span>}{interest.get(i.seq) && <span className="fine block warn-text" data-testid="msmed-interest">{interest.get(i.seq)}</span>}</span><span className="pay-actions">{!archived && i.status !== 'cancelled' && <button className="help-link" onClick={() => setCrediting(i)}>Credit note</button>}<a className="help-link" href={`/api/scopes/${projectId}/invoices/${i.seq}`} download>PDF</a></span></li>)}</ul>
        : invoices && !open && <p className="fine">{leftGross > 0 ? 'Create a numbered invoice for what is left to invoice, or part of it. Record the payment above when the money arrives.' : 'Everything agreed has been invoiced.'}</p>}
      {data && data.receipt_vouchers.length > 0 && <ul className="receipt-list payment-list" aria-label="Receipt vouchers">{data.receipt_vouchers.map(v => <li key={v.seq}><span><strong>{v.number}</strong> · {v.kind === 'receipt_voucher' ? 'receipt voucher' : 'payment receipt'} for an advance of {formatMoney(v.amount, currency)} received {formatDay(v.received)}{v.adjusted ? ' · adjusted' : ''}</span><a className="help-link" href={`/api/scopes/${projectId}/invoices/receipt-vouchers/${v.seq}`} download>PDF</a></li>)}</ul>}
      {data && data.credit_notes.length > 0 && <ul className="receipt-list payment-list" aria-label="Credit notes">{data.credit_notes.map(c => <li key={c.seq}><span><strong>{c.number}</strong> · against {c.invoice_number} · {formatMoney(c.amount, currency)}{c.full ? ' (full)' : ''} · {c.reason}</span><a className="help-link" href={`/api/scopes/${projectId}/credit-notes/${c.seq}`} download>PDF</a></li>)}</ul>}
      <MsmedTerms projectId={projectId} disabled={archived} onChanged={() => void load()} />
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
            {billingError && <p className="error" role="alert">{billingError}</p>}
            <div className="actions"><button type="submit" className="secondary" disabled={busy}>Save billing details</button></div>
          </form>
        </details>
      )}
      <CreditNoteDialog invoice={crediting} busy={busy} onCancel={() => { if (!busy) setCrediting(null); }} onIssue={cancelInvoice} />
    </div>
  );
}

/** UX-C41: why the invoice is being cancelled, printed on the credit note. Required, with the consequence spelled out. */
function CreditNoteDialog({invoice, busy, onCancel, onIssue}: {invoice: InvoiceView | null; busy: boolean; onCancel: () => void; onIssue: (i: InvoiceView, reason: string) => Promise<string | null>}) {
  const [shown, setShown] = useState<InvoiceView | null>(invoice);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [wasOpen, setWasOpen] = useState(!!invoice);
  // A new invoice, or reopening the same one (N7), opens a fresh form; the last one stays rendered while the dialog animates closed.
  if (!!invoice !== wasOpen) setWasOpen(!!invoice);
  if (invoice && (invoice !== shown || !wasOpen)) { setShown(invoice); setReason(''); setTouched(false); setError(''); }
  const i = invoice ?? shown;
  const problem = creditReasonProblem(reason);
  const showProblem = touched && problem;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setTouched(true);
    if (!i || problem) return;
    const failed = await onIssue(i, reason);
    setError(failed ?? '');
  }
  return (
    <Dialog open={!!invoice} onOpenChange={o => { if (!o && !busy) onCancel(); }}>
      {/* N7: while the credit note is being issued, Esc and outside clicks do not close the dialog. */}
      <DialogContent onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onInteractOutside={e => { if (busy) e.preventDefault(); }}>
        {i && <form onSubmit={submit} noValidate>
          <DialogTitle>Cancel {i.number} with a credit note?</DialogTitle>
          <DialogDescription>A credit note for {formatMoney(Math.max(0, r2(i.amount - i.credited)), i.currency)} is issued against {i.number} and takes the next number in your credit-note series (CN-…). The amount can then be invoiced again.</DialogDescription>
          <p className="consequence">Credit notes are permanent: once issued it cannot be edited or deleted.</p>
          <label>Reason <span className="quiet">· printed on the credit note</span>
            <textarea rows={3} required minLength={3} maxLength={CREDIT_REASON_MAX} value={reason} autoFocus
              aria-invalid={!!showProblem} aria-describedby={describedBy(showProblem && 'credit-reason-err', error && 'credit-issue-err')}
              onChange={e => { setReason(e.target.value); setError(''); }} onBlur={() => setTouched(true)}
              placeholder="e.g. Invoice raised on the wrong milestone" />
            {showProblem && <span id="credit-reason-err" className="error-text">{problem}</span>}
          </label>
          {error && <p id="credit-issue-err" className="error" role="alert">{error}</p>}
          <div className="actions">
            <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Keep the invoice</button>
            <button type="submit" className="primary danger" disabled={busy}>{busy ? 'Issuing…' : 'Issue credit note'}</button>
          </div>
        </form>}
      </DialogContent>
    </Dialog>
  );
}
