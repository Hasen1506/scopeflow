'use client';
// Slot: PayBlock. Owner: WS-04 (implements it). Mounted by: WS-07 (client page), and by WS-04's
// own /pay/<token> page. How the client pays the freelancer directly, with no operator custody
// (LT-02, SF-02, C3): a UPI QR code and UPI app link for the exact open amount (deposit, invoice
// or balance; INR only), the freelancer's bank details, their own online checkout when they
// connected Razorpay or Stripe, and an "I've paid" claim with the UTR that the freelancer
// confirms. Usage: <PayBlock token={token} /> (optionally purpose/seq to preselect a target).
import {useCallback, useEffect, useMemo, useState} from 'react';
import QRCode from 'qrcode';
import {formatMoney} from '@/lib/currency';
import {copyText} from '@/lib/clipboard';
import {fromMinor} from '@/lib/minor';
import styles from './pay-block.module.css';

export type PayBlockProps = {token: string; purpose?: 'deposit' | 'invoice' | 'balance'; seq?: number; onPaid?: () => void};
type Target = {purpose: 'deposit' | 'invoice' | 'balance'; seq: number | null; label: string; due_minor: number; open_minor: number; upi_uri: string | null; ref: string};
type Claim = {id: string; purpose: string; invoice_seq: number | null; amount_minor: number; currency: string; method: string; utr: string; status: string; created: string};
type Options = {
  project_id: string; title: string; currency: string; payee: string;
  money: {received_minor: number; refunded_minor: number; net_minor: number; total_minor: number; balance_minor: number; deposit: {due: number; paid: number; covered: boolean}};
  targets: Target[]; upi: {vpa: string; payee_name: string} | null; bank: string | null;
  online: {enabled: boolean; provider: 'razorpay' | 'stripe' | null; status: string}; claims: Claim[];
  paths: {deposit: string; invoice: string; claim: string; verify: string};
};
type RazorpayCtor = new (o: Record<string, unknown>) => {open: () => void};

// M4 (WS-01): minor units through lib/minor.ts (ISO exponents), never Intl.
const fmt = (minor: number, currency: string) => formatMoney(fromMinor(minor, currency), currency);
async function call(path: string, init?: RequestInit) {
  const r = await fetch(path, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 202) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : 'Something went wrong. Please try again.'), {code: data.code});
  return data;
}
const postJson = (data: unknown): RequestInit => ({method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
function loadCheckout() {
  return new Promise<void>((resolve, reject) => {
    if ((window as unknown as {Razorpay?: unknown}).Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(); s.onerror = () => reject(new Error('Razorpay Checkout could not be loaded.'));
    document.head.appendChild(s);
  });
}
const keyOf = (t: Target) => t.purpose + ':' + (t.seq ?? '');

export default function PayBlock({token, purpose, seq, onPaid}: PayBlockProps) {
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState('');
  const [qr, setQr] = useState<{uri: string; url: string} | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [utr, setUtr] = useState(''), [method, setMethod] = useState<'upi' | 'bank_transfer'>('upi'), [payer, setPayer] = useState('');
  const load = useCallback(async () => {
    try { const o = await call(`/api/review/${token}/payments`) as Options; setOptions(o); setError(''); if (!o.upi) setMethod('bank_transfer'); }
    catch (e) { setError((e as Error).message); }
  }, [token]);
  useEffect(() => { let live = true; call(`/api/review/${token}/payments`).then((o: Options) => { if (!live) return; setOptions(o); if (!o.upi) setMethod('bank_transfer'); }, e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, [token]);
  const targets = useMemo(() => options?.targets.filter(t => t.open_minor > 0) ?? [], [options]);
  const preferred = targets.find(t => t.purpose === purpose && (purpose !== 'invoice' || t.seq === seq)) ?? targets[0];
  const target = targets.find(t => keyOf(t) === pick) ?? preferred;
  const uri = target?.upi_uri ?? null;
  useEffect(() => {
    let live = true;
    if (uri) QRCode.toDataURL(uri, {errorCorrectionLevel: 'M', margin: 4, scale: 6}).then(url => { if (live) setQr({uri, url}); }, () => { /* no QR: the link still works */ });
    return () => { live = false; };
  }, [uri]);

  if (error) return <section className={styles.block} aria-labelledby="pay-h"><h2 id="pay-h">Pay</h2><p role="alert">{error}</p></section>;
  if (!options) return <section className={styles.block} aria-busy="true"><p role="status">Loading payment details…</p></section>;
  const c = options.currency, payee = options.payee || 'the creator';
  const pending = options.claims.filter(x => x.status === 'pending');
  const qrUrl = qr && qr.uri === uri ? qr.url : '';

  async function payOnline(t: Target) {
    if (!options || t.purpose === 'balance') return;
    setBusy(true); setNote('');
    try {
      const path = t.purpose === 'deposit' ? options.paths.deposit : options.paths.invoice.replace('{seq}', String(t.seq));
      const o = await call(path, postJson({}));
      if (o.provider === 'stripe') { try { sessionStorage.setItem('scopeflow:payment-return', token); } catch { /* the return page finds the payment anyway */ } location.assign(o.url); return; }
      await loadCheckout();
      const Razorpay = (window as unknown as {Razorpay: RazorpayCtor}).Razorpay;
      new Razorpay({key: o.key_id, order_id: o.order_id, amount: o.amount_minor, currency: o.currency, name: o.name, description: o.description,
        handler: async (r: {razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string}) => {
          setNote('Payment submitted. Confirming…');
          try { const v = await call(o.verify_path ?? options.paths.verify, postJson(r)); setNote(v.pending ? 'Payment submitted. It shows here once Razorpay confirms it.' : 'Payment received. Thank you.'); }
          catch (e) { setNote((e as Error).message); }
          await load(); onPaid?.();
        }}).open();
    } catch (e) { setNote((e as Error).message); }
    finally { setBusy(false); }
  }
  async function claim(t: Target) {
    setBusy(true); setNote('');
    try {
      await call(options!.paths.claim, postJson({purpose: t.purpose, ...(t.seq ? {invoice_seq: t.seq} : {}), amount_minor: t.open_minor, method, utr, payer_name: payer}));
      setUtr(''); setNote(`Thanks. ${payee} has been told and confirms it once the money arrives.`);
      await load();
    } catch (e) { setNote((e as Error).message); }
    finally { setBusy(false); }
  }

  return <section className={styles.block} aria-labelledby="pay-h" data-testid="pay-block">
    <div className={styles.head}>
      <h2 id="pay-h">Pay {payee}</h2>
      <p className={styles.summary} data-testid="pay-received">Received {fmt(options.money.net_minor, c)} of {fmt(options.money.total_minor, c)}</p>
    </div>
    {options.money.deposit.due > 0 && <p className={options.money.deposit.covered ? styles.ok : styles.summary} data-testid="pay-deposit-state">{options.money.deposit.covered ? `Deposit covered (${fmt(options.money.deposit.due, c)}).` : `Deposit due: ${fmt(options.money.deposit.due - options.money.deposit.paid, c)}.`}</p>}
    {!targets.length || !target ? <p className={styles.ok} role="status">Nothing is open right now. Thank you.</p> : <>
      {targets.length > 1 && <div className={styles.targets} role="group" aria-label="What to pay">{targets.map(t => <button key={keyOf(t)} type="button" className={styles.target} aria-pressed={keyOf(t) === keyOf(target)} onClick={() => setPick(keyOf(t))}>{t.label} · {fmt(t.open_minor, c)}</button>)}</div>}
      {options.upi && uri ? <div className={styles.upi}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL QR code, nothing to optimise */}
        {qrUrl ? <img className={styles.qr} src={qrUrl} width={200} height={200} alt={`UPI QR code: pay ${fmt(target.open_minor, c)} to ${payee}`} data-upi={uri} data-testid="upi-qr"/> : <span/>}
        <div>
          <p className={styles.payto} data-testid="pay-to">Pay {fmt(target.open_minor, c)} to {payee}</p>
          <p className={styles.vpa}>UPI ID: <span data-testid="upi-vpa">{options.upi.vpa}</span> · {target.label}</p>
          <p className={styles.fine}>Scan with any UPI app, or open one from this phone. The amount and note are filled in, and the money goes straight to {payee}’s bank account.</p>
          <div className={styles.apps}>
            <a className="secondary" href={uri} data-testid="upi-intent">Open UPI app</a>
            <button type="button" className="secondary" onClick={() => { void copyText(options.upi!.vpa).then(ok => setNote(ok ? 'UPI ID copied.' : 'Copy failed. Select the UPI ID and copy it.')); }}>Copy UPI ID</button>
          </div>
        </div>
      </div> : null}
      {options.bank && <div><p className={styles.fine}>Bank transfer</p><p className={styles.bank} data-testid="pay-bank">{options.bank}</p></div>}
      {options.online.enabled && target.purpose !== 'balance' && <div>
        <button type="button" className="primary" disabled={busy} aria-busy={busy || undefined} onClick={() => void payOnline(target)} data-testid="pay-online">{busy ? 'Opening…' : `Pay ${fmt(target.open_minor, c)} by card or netbanking`}</button>
        <p className={styles.fine}>Through {payee}’s own {options.online.provider === 'stripe' ? 'Stripe' : 'Razorpay'} account.</p>
      </div>}
      {!(options.upi && uri) && !options.bank && !options.online.enabled && <p data-testid="pay-details-later">{payee} will share payment details.</p>}
      {((options.upi && uri) || options.bank) && <form className={styles.claim} onSubmit={e => { e.preventDefault(); void claim(target); }} aria-labelledby="claim-h">
        <strong id="claim-h">Already paid {fmt(target.open_minor, c)}?</strong>
        <div className={styles.claimRow}>
          <label>How<select value={method} onChange={e => setMethod(e.target.value as 'upi' | 'bank_transfer')}>{options.upi && uri && <option value="upi">UPI</option>}<option value="bank_transfer">Bank transfer</option></select></label>
          <label>Reference (UTR)<input name="utr" inputMode={method === 'upi' ? 'numeric' : 'text'} autoComplete="off" required maxLength={40} value={utr} onChange={e => setUtr(e.target.value)} placeholder={method === 'upi' ? '12-digit UPI reference' : 'Bank reference'}/></label>
          <label>Your name<input name="payer" autoComplete="name" maxLength={120} value={payer} onChange={e => setPayer(e.target.value)}/></label>
          <button type="submit" className="secondary" disabled={busy || !utr.trim()} data-testid="claim-submit">I’ve paid</button>
        </div>
        <p className={styles.fine}>It counts once {payee} confirms the money arrived.</p>
      </form>}
    </>}
    {pending.length > 0 && <ul className={styles.claims} aria-label="Payments you reported">{pending.map(p => <li key={p.id} data-testid="claim-pending">{fmt(p.amount_minor, p.currency)} · ref {p.utr} · <span className={styles.warn}>waiting for {payee} to confirm</span></li>)}</ul>}
    <p role="status" aria-live="polite" className={styles.fine}>{note}</p>
  </section>;
}
