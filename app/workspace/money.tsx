'use client';
import Link from 'next/link';
import {useState} from 'react';
import {Download,Banknote,FolderArchive} from 'lucide-react';
import {toast} from 'sonner';
import {Version,label,formatMoney} from '@/lib/scope';
import {paymentsOf,paymentMethods,PAYMENT_METHOD_LABEL,refundableOf} from '@/lib/ledger';
import {InvoicePanel} from '../invoice-panel';
import {ClientNotices} from './client-notices';
import type {Agreement,LedgerEntry,PaymentLine} from '@/lib/ledger';
import {api,post} from '../ui';
import {totals} from '@/lib/money';
import {formatDay} from '@/lib/time';
import type {Ws} from './state';

/** Step 4: what the agreement says is owed, what has been received, what is still due, and the receipts. Real records only. */
export function PaymentPanel({version,agreement,entries,onlineDeposits,receiptUrl,history,archived,onRecorded}:{version:Version;agreement:Agreement|null;entries:LedgerEntry[];onlineDeposits:boolean|null;receiptUrl:(v:Version)=>string;history:Version[];archived:boolean;onRecorded:()=>void}){
 const c=version.content,cur=c.currency,decided=history.filter(v=>v.status!=='pending'&&v.decided);
 const [formOpen,setFormOpen]=useState(false),[refundFor,setRefundFor]=useState<PaymentLine|'offline'|null>(null);
 if(version.status!=='approved'||!agreement){const q=totals(c);return <><p className="quiet">Payment details are fixed when your client approves. Until then this is the quote on version {version.version}.</p><dl className="pay-grid"><div><dt>Quoted fee</dt><dd>{formatMoney(c.fee,cur)}</dd></div>{q.tax_pct>0&&<div><dt>Total with {q.tax_label}</dt><dd>{formatMoney(q.total,cur)}</dd></div>}{q.deposit_pct>0&&<div><dt>Deposit on signature</dt><dd>{formatMoney(q.deposit,cur)}</dd></div>}</dl>{decided.length>0&&<ReceiptList decided={decided} receiptUrl={receiptUrl}/>}</>;}
 const now=totals(c,agreement.fee),signed=totals(c);
 const {lines,paid}=paymentsOf(entries.filter(e=>e.baseline_version===version.version));
 const balance=Math.max(0,Math.round((now.total-paid)*100)/100);
 const refundable=(l:PaymentLine)=>refundableOf(l,lines);
 const depositOpen=signed.deposit_pct>0&&paid<signed.deposit;
 return <>
  <dl className="pay-grid">
   <div><dt>{now.tax_pct>0?`Agreed total with ${now.tax_label}`:'Agreed fee'}</dt><dd>{formatMoney(now.total,cur)}<span className="pay-note">{now.tax_pct>0?`${formatMoney(agreement.fee,cur)} + ${now.tax_pct}% ${now.tax_label}`:''}{agreement.fee!==agreement.fee_base?`${now.tax_pct>0?' · ':''}fee was ${formatMoney(agreement.fee_base,cur)} at approval`:''}</span></dd></div>
   {signed.deposit_pct>0&&<div><dt>Deposit on signature ({signed.deposit_pct}%)</dt><dd>{formatMoney(signed.deposit,cur)}<span className="pay-note">{!depositOpen?'Covered by payments received':onlineDeposits?'Your client can pay it on the review link':'Collect it the way you agreed, then record it'}</span></dd></div>}
   <div><dt>Received</dt><dd>{formatMoney(paid,cur)}<span className="pay-note">{lines.length?`${lines.length} payment${lines.length>1?'s':''} on the record`:'Nothing recorded yet'}</span></dd></div>
   <div className={balance>0?'pay-due':'pay-clear'}><dt>Balance due</dt><dd>{formatMoney(balance,cur)}<span className="pay-note">{balance>0?(agreement.pending>0?'Before pending change orders':'Still to collect'):'Paid in full'}</span></dd></div>
  </dl>
  {c.payment_terms&&<p className="line-list section-gap"><strong>Payment terms</strong><br/>{c.payment_terms}</p>}
  {agreement.pending>0&&<p className="fine">{agreement.pending} change order{agreement.pending>1?'s':''} still awaiting the client: the agreed total changes only once they approve.</p>}
  <div className="section-gap"><div className="small-title"><h4 className="h-sub">Payments</h4><div className="pay-actions"><a className="secondary" href={`/api/scopes/${version.project_id}/statement`} download><Download size={15}/>Statement PDF</a><a className="secondary" href={`/api/scopes/${version.project_id}/dispute-pack`} download title="Every receipt, the statement, invoices, the signed record with its chain proof, timestamps and a BSA 2023 Section 63 certificate template, in one ZIP"><FolderArchive size={15}/>Dispute pack</a>{!formOpen&&!archived&&<button className="secondary" onClick={()=>setFormOpen(true)}><Banknote size={15}/>Record a payment</button>}{!archived&&paid>0&&!refundFor&&<button className="secondary" onClick={()=>setRefundFor('offline')}>Record a refund</button>}</div></div>
   {refundFor&&<RefundForm projectId={version.project_id} baseline={version.version} currency={cur} line={refundFor==='offline'?null:refundFor} max={refundFor==='offline'?paid:refundable(refundFor)} onDone={()=>{setRefundFor(null);onRecorded();}} onCancel={()=>setRefundFor(null)}/>}
   {formOpen&&<PaymentForm projectId={version.project_id} baseline={version.version} currency={cur} suggested={depositOpen?Math.round((signed.deposit-paid)*100)/100:balance} balance={balance} onDone={()=>{setFormOpen(false);onRecorded();}} onCancel={()=>setFormOpen(false)}/>}
   {lines.length>0?<ul className="receipt-list payment-list">{lines.map(l=><li key={l.seq}><span><strong>{formatMoney(l.amount,cur)}</strong> · {l.method} · {formatDay(l.received)}{l.reference&&<span className="quiet"> · ref. {l.reference}</span>}{l.note&&(l.source==='owner'||l.source==='refund')&&<span className="quiet"> · {l.note}</span>}</span><span className="fine">{l.source==='razorpay'||l.source==='stripe'?<>Confirmed by {l.method}{!archived&&refundable(l)>0&&<> · <button className="help-link" onClick={()=>setRefundFor(l)}>Refund</button></>}</>:l.source==='refund'?(l.provider_refund_id?'Refunded online':'Refund recorded by you'):'Recorded by you'}</span></li>)}</ul>:!formOpen&&<p className="fine">Record money as it arrives (bank transfer, UPI, cash…). Each payment goes on the signed record your client sees, and the balance updates here and on your Projects home.</p>}
   <p className="fine">The statement PDF shows the agreed total, every payment on the record and the balance due. Send it with an invoice or a payment reminder; your client can download the same statement from their review link.</p>
  </div>
  <InvoicePanel projectId={version.project_id} currency={cur} balance={balance} archived={archived}/>
  {/* WS-09 mount (WS-06): invoice email status and WhatsApp share; nothing until WS-06 lands. */}
  <ClientNotices projectId={version.project_id} list="invoices" reload={entries.length}/>
  <ReceiptList decided={decided} receiptUrl={receiptUrl}/>
 </>;
}
/** A refund: through Razorpay or Stripe for an online payment (money goes back to the client's card or account), or one the creator made outside Scopeflow. Either way it goes on the signed record. */
export function RefundForm({projectId,baseline,currency,line,max,onDone,onCancel}:{projectId:string;baseline:number;currency:string;line:PaymentLine|null;max:number;onDone:()=>void;onCancel:()=>void}){
 const [amount,setAmount]=useState(String(max)),[method,setMethod]=useState<(typeof paymentMethods)[number]>('bank_transfer'),[refunded,setRefunded]=useState(today()),[reference,setReference]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [requestId]=useState(()=>crypto.randomUUID());
 const value=Math.round(Number(amount)*100)/100;
 async function submit(e:React.FormEvent){e.preventDefault();if(!(value>0)||value>max+0.005){setError(`Enter an amount up to ${formatMoney(max,currency)}.`);return;}setBusy(true);setError('');try{
  if(line)await api(`/api/scopes/${projectId}/refunds`,post({payment_seq:line.seq,amount:value,note,request_id:requestId}));
  else await api(`/api/scopes/${projectId}/ledger`,post({kind:'refund',baseline_version:baseline,payload:{amount:value,method,refunded,reference,note},request_id:requestId}));
  toast.success(line?`${formatMoney(value,currency)} refunded through ${line.method}.`:`Refund of ${formatMoney(value,currency)} recorded.`);onDone();}catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 return <form className="ledger-form" aria-label={line?'Refund an online payment':'Record a refund'} onSubmit={submit}>
  {line&&<p className="fine">Refunds {formatMoney(max,currency)} or less of the {line.method} payment {line.reference} back to your client through {line.method}. This cannot be undone.</p>}
  <div className="two-col"><label>Amount to refund ({currency})<input type="number" min={0.01} max={max} step="0.01" inputMode="decimal" required value={amount} onChange={e=>setAmount(e.target.value)}/></label>{!line&&<label>Refunded on<input type="date" required max={today()} value={refunded} onChange={e=>setRefunded(e.target.value)}/></label>}</div>
  {!line&&<div className="two-col"><label>Method<select value={method} onChange={e=>setMethod(e.target.value as (typeof paymentMethods)[number])}>{paymentMethods.map(m=><option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}</select></label><label>Reference <span className="quiet">· optional</span><input maxLength={80} value={reference} onChange={e=>setReference(e.target.value)}/></label></div>}
  <label>Reason <span className="quiet">· shown to your client</span><input maxLength={500} placeholder="e.g. Deliverable D3 dropped by agreement" value={note} onChange={e=>setNote(e.target.value)}/></label>
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="actions"><button type="submit" className="primary" disabled={busy}>{busy?'Refunding…':line?'Refund through '+line.method:'Record refund'}</button><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button></div>
 </form>;
}
/** Today in the viewer's own calendar (a payment that arrived this morning in Chennai is not "tomorrow"). */
export const today=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
/** Records money received outside Scopeflow as a ledger entry (kind payment_received). */
export function PaymentForm({projectId,baseline,currency,suggested,balance,onDone,onCancel}:{projectId:string;baseline:number;currency:string;suggested:number;balance:number;onDone:()=>void;onCancel:()=>void}){
 const [amount,setAmount]=useState(suggested>0?String(suggested):''),[method,setMethod]=useState<(typeof paymentMethods)[number]>('bank_transfer'),[received,setReceived]=useState(today()),[reference,setReference]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [requestId]=useState(()=>crypto.randomUUID());
 const value=Number(amount);
 async function record(e:React.FormEvent){e.preventDefault();if(!(value>0)){setError('Enter the amount you received.');return;}setBusy(true);setError('');try{await api(`/api/scopes/${projectId}/ledger`,post({kind:'payment_received',baseline_version:baseline,payload:{amount:Math.round(value*100)/100,method,received,reference,note},request_id:requestId}));toast.success(`${formatMoney(value,currency)} recorded.`);onDone();}catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 return <form className="ledger-form" aria-label="Record a payment" onSubmit={record}>
  <div className="two-col"><label>Amount received ({currency})<input type="number" min={0.01} step="0.01" inputMode="decimal" required value={amount} onChange={e=>setAmount(e.target.value)}/>{value>balance&&balance>0&&<span className="warn-text" role="status">More than the {formatMoney(balance,currency)} still due.</span>}</label><label>Received on<input type="date" required max={today()} value={received} onChange={e=>setReceived(e.target.value)}/></label></div>
  <div className="two-col"><label>Method<select value={method} onChange={e=>setMethod(e.target.value as (typeof paymentMethods)[number])}>{paymentMethods.map(m=><option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}</select></label><label>Reference <span className="quiet">· optional</span><input maxLength={80} placeholder="e.g. UTR or cheque number" value={reference} onChange={e=>setReference(e.target.value)}/></label></div>
  <label>Note <span className="quiet">· optional</span><input maxLength={500} placeholder="e.g. Deposit, second instalment" value={note} onChange={e=>setNote(e.target.value)}/></label>
  <p className="fine">Your client sees this on their record, and it cannot be edited or deleted later, so check the amount and date first.</p>
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="actions"><button type="submit" className="primary" disabled={busy}>{busy?'Recording…':'Record payment'}</button><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button></div>
 </form>;
}
export function ReceiptList({decided,receiptUrl}:{decided:Version[];receiptUrl:(v:Version)=>string}){return <div className="section-gap"><h4 className="h-sub">Signed receipts</h4><ul className="receipt-list">{decided.map(v=><li key={v.id}><span>Version {v.version} · {label(v.status)}</span><a className="help-link" href={receiptUrl(v)} download>PDF receipt</a></li>)}</ul><p className="fine">Each PDF carries a QR code your client (or anyone) can check at <Link className="help-link" href="/verify">Verify a receipt</Link>.</p></div>;}

export function paymentStep(w:Ws){const {active,archived,history,ledgerView,loadOverview,overview,receiptUrl,setLedgerReload}=w;
  return (active&&<section id="step-payment" className="editor flow-step" aria-labelledby="h-payment">
      <div className="step-head"><span className="step-num" aria-hidden="true">4</span><h3 id="h-payment">Payment &amp; receipts</h3></div>
      <PaymentPanel version={active} agreement={ledgerView?.agreement??null} entries={ledgerView?.entries??[]} onlineDeposits={overview?.online_deposits??null} receiptUrl={receiptUrl} history={history} archived={!!archived} onRecorded={()=>{setLedgerReload(n=>n+1);void loadOverview();}}/>
     </section>
  );
}
