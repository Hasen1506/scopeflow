'use client';
// Slot: PaymentSettings. Owner: WS-04 (implements it). Mounted by: WS-08 (Account → Payments), and
// by WS-04's own /payments page. The owner's own payment accounts (C3, SF-20): a UPI ID (clients pay
// bank to bank), their own Razorpay (connect with Razorpay when the Technology Partner OAuth is
// live, or their API keys meanwhile), their own Stripe, and a Route linked account when the server
// enables Route; plus the inbox of clients' "I've paid" claims to confirm, and payment alerts.
// ScopeFlow never holds client money: every rail here pays the freelancer directly.
import {useCallback, useEffect, useState} from 'react';
import {formatMoney} from '@/lib/currency';
import {fromMinor} from '@/lib/minor';
import styles from './payment-settings.module.css';

export type PaymentSettingsProps = {showInbox?: boolean};
type Account = {id: string; kind: string; status: string; public: Record<string, unknown>; created: string; webhook_url: string | null};
type Accounts = {accounts: Account[]; readiness: {payments: string; warnings: string[]; encryption: boolean}; razorpay_oauth: boolean; route_enabled: boolean};
type Claim = {id: string; project_id: string; title: string; client: string; purpose: string; invoice_seq: number | null; amount_minor: number; currency: string; method: string; utr: string; payer_name: string; created: string};
type Alert = {id: string; project_id: string | null; kind: string; detail: Record<string, unknown> & {refund?: {path: string; body: Record<string, unknown>}}; created: string};

const LABEL: Record<string, string> = {upi: 'UPI ID', razorpay_keys: 'Razorpay (your API keys)', razorpay_oauth: 'Razorpay (connected)', razorpay_route: 'Razorpay Route linked account', stripe_keys: 'Stripe (your key)'};
const ALERT: Record<string, string> = {excess_payment: 'A client paid more than was due', short_payment: 'A payment was less than its order', payment_unrecorded: 'A payment arrived but is not on the record yet', refund_unrecorded: 'A refund was issued but is not on the record yet', stale_order: 'An old unpaid order needs a check', currency_mismatch: 'A payment came in another currency'};
// M4 (WS-01): minor units through lib/minor.ts (ISO exponents), never Intl.
const fmt = (minor: number, currency: string) => formatMoney(fromMinor(minor, currency), currency);
async function call(path: string, init?: RequestInit) {
  const r = await fetch(path, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : 'Something went wrong. Please try again.'), {status: r.status});
  return data;
}
const send = (method: string, data?: unknown): RequestInit => ({method, headers: {'Content-Type': 'application/json'}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
const describe = (a: Account) => {
  const p = a.public;
  if (a.kind === 'upi') return `${String(p.vpa)} · ${String(p.payee_name ?? '')}`;
  if (a.kind === 'razorpay_keys') return `${String(p.key_id)} (${String(p.mode)})${p.has_webhook_secret ? '' : ' · webhook secret missing'}`;
  if (a.kind === 'razorpay_oauth') return `${String(p.razorpay_account_id)} (${String(p.mode)})`;
  if (a.kind === 'razorpay_route') return String(p.linked_account_id);
  if (a.kind === 'stripe_keys') return `${String(p.key_hint)} (${String(p.mode)})${p.has_webhook_secret ? '' : ' · webhook secret missing'}`;
  return '';
};

export default function PaymentSettings({showInbox = true}: PaymentSettingsProps) {
  const [data, setData] = useState<Accounts | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [note, setNote] = useState(''), [error, setError] = useState('');
  const [vpa, setVpa] = useState(''), [payee, setPayee] = useState('');
  const [rz, setRz] = useState({key_id: '', key_secret: '', webhook_secret: ''});
  const [st, setSt] = useState({secret_key: '', webhook_secret: '', include_inr: false});
  const [route, setRoute] = useState('');
  const load = useCallback(async () => {
    try {
      setData(await call('/api/payment-accounts'));
      if (showInbox) { setClaims((await call('/api/payments/claims')).claims); setAlerts((await call('/api/payments/alerts')).alerts); }
      setError('');
    } catch (e) { setError((e as Error & {status?: number}).status === 401 ? 'Sign in to manage payments.' : (e as Error).message); }
  }, [showInbox]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  const act = async (fn: () => Promise<unknown>, done: string) => { setNote(''); try { await fn(); setNote(done); await load(); } catch (e) { setNote((e as Error).message); } };

  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Loading payment settings…</p>;
  const active = data.accounts.filter(a => a.status === 'active');
  return <div className={styles.wrap} data-testid="payment-settings">
    <p className={styles.fine}>Clients pay you directly: to your UPI ID or bank, or through your own Razorpay or Stripe account. ScopeFlow never holds the money.</p>
    {data.readiness.warnings.map(w => <p key={w} className={styles.warn} role="note">{w}</p>)}
    {!data.readiness.encryption && <p className={styles.warn} role="note">This server cannot store payment keys yet (encryption key missing). A UPI ID still works.</p>}
    <section className={styles.card} aria-labelledby="pa-h">
      <h3 id="pa-h">Connected</h3>
      {active.length ? <ul className={styles.list}>{active.map(a => <li key={a.id} className={styles.item} data-testid={'account-' + a.kind}>
        <span><strong>{LABEL[a.kind] ?? a.kind}</strong> · {describe(a)}{a.webhook_url && <><br/><span className={styles.fine}>Webhook URL: <span className={styles.mono}>{a.webhook_url}</span></span></>}</span>
        <button type="button" className="secondary" onClick={() => void act(() => call('/api/payment-accounts/' + a.id, send('DELETE')), 'Disconnected.')}>Disconnect</button>
      </li>)}</ul> : <p className={styles.fine}>Nothing connected yet. Add your UPI ID so clients can pay you from the review page.</p>}
    </section>
    <section className={styles.card} aria-labelledby="upi-h">
      <h3 id="upi-h">UPI ID</h3>
      <form className={styles.row} onSubmit={e => { e.preventDefault(); void act(() => call('/api/payment-accounts', send('POST', {kind: 'upi', vpa, payee_name: payee})), 'UPI ID saved.'); }}>
        <label>UPI ID<input name="vpa" value={vpa} onChange={e => setVpa(e.target.value)} placeholder="name@bank" autoComplete="off" required/></label>
        <label>Name clients see<input name="payee_name" value={payee} onChange={e => setPayee(e.target.value)} maxLength={50} required/></label>
        <button type="submit" className="primary">Save UPI ID</button>
      </form>
      <p className={styles.fine}>A business (merchant) UPI ID is better for regular client payments. INR only.</p>
    </section>
    <section className={styles.card} aria-labelledby="rz-h">
      <h3 id="rz-h">Your Razorpay account</h3>
      {data.razorpay_oauth && <p><button type="button" className="primary" onClick={() => location.assign('/api/payment-accounts/razorpay/connect')}>Connect with Razorpay</button></p>}
      <form className={styles.row} onSubmit={e => { e.preventDefault(); void act(() => call('/api/payment-accounts', send('POST', {kind: 'razorpay_keys', key_id: rz.key_id, key_secret: rz.key_secret, ...(rz.webhook_secret ? {webhook_secret: rz.webhook_secret} : {})})), 'Razorpay connected. Add the webhook URL shown above in your Razorpay dashboard.'); }}>
        <label>Key ID<input name="key_id" value={rz.key_id} onChange={e => setRz({...rz, key_id: e.target.value})} placeholder="rzp_live_…" autoComplete="off" required/></label>
        <label>Key secret<input name="key_secret" type="password" value={rz.key_secret} onChange={e => setRz({...rz, key_secret: e.target.value})} autoComplete="off" required/></label>
        <label>Webhook secret<input name="webhook_secret" type="password" value={rz.webhook_secret} onChange={e => setRz({...rz, webhook_secret: e.target.value})} autoComplete="off"/></label>
        <button type="submit" className="secondary">Connect keys</button>
      </form>
      <p className={styles.fine}>Card and netbanking payments settle to your own Razorpay account. Keys are encrypted at rest. Online payment turns on once the webhook secret is set.</p>
    </section>
    <section className={styles.card} aria-labelledby="st-h">
      <h3 id="st-h">Your Stripe account</h3>
      <form className={styles.row} onSubmit={e => { e.preventDefault(); void act(() => call('/api/payment-accounts', send('POST', {kind: 'stripe_keys', secret_key: st.secret_key, include_inr: st.include_inr, ...(st.webhook_secret ? {webhook_secret: st.webhook_secret} : {})})), 'Stripe connected. Add the webhook URL shown above in your Stripe dashboard.'); }}>
        <label>Secret or restricted key<input name="secret_key" type="password" value={st.secret_key} onChange={e => setSt({...st, secret_key: e.target.value})} placeholder="rk_live_…" autoComplete="off" required/></label>
        <label>Webhook signing secret<input name="stripe_webhook_secret" type="password" value={st.webhook_secret} onChange={e => setSt({...st, webhook_secret: e.target.value})} placeholder="whsec_…" autoComplete="off"/></label>
        <label className="check-row">{/* R5: box beside its text */}<input type="checkbox" checked={st.include_inr} onChange={e => setSt({...st, include_inr: e.target.checked})}/><span>Also take INR</span></label>
        <button type="submit" className="secondary">Connect Stripe</button>
      </form>
      <p className={styles.fine}>For clients paying in other currencies. Stripe is invite-only for new Indian accounts.</p>
    </section>
    {data.route_enabled && <section className={styles.card} aria-labelledby="route-h">
      <h3 id="route-h">Razorpay Route</h3>
      <form className={styles.row} onSubmit={e => { e.preventDefault(); void act(() => call('/api/payment-accounts', send('POST', {kind: 'razorpay_route', linked_account_id: route})), 'Linked account saved.'); }}>
        <label>Linked account ID<input name="linked_account_id" value={route} onChange={e => setRoute(e.target.value)} placeholder="acc_…" required/></label>
        <button type="submit" className="secondary">Save</button>
      </form>
    </section>}
    {showInbox && <section className={styles.card} aria-labelledby="claims-h">
      <h3 id="claims-h">Payments clients reported</h3>
      {claims.length ? <ul className={styles.list}>{claims.map(c => <li key={c.id} className={styles.item} data-testid="claim">
        <span><strong>{fmt(c.amount_minor, c.currency)}</strong> · {c.title} ({c.client}) · {c.purpose === 'invoice' ? `invoice #${c.invoice_seq}` : c.purpose} · {c.method === 'upi' ? 'UPI' : 'bank transfer'} ref <span className={styles.mono}>{c.utr}</span>{c.payer_name ? ` · from ${c.payer_name}` : ''}</span>
        <span><button type="button" className="primary" onClick={() => void act(() => call('/api/payments/claims/' + c.id, send('POST', {action: 'confirm'})), 'Payment confirmed and recorded.')} data-testid="claim-confirm">Confirm received</button> <button type="button" className="secondary" onClick={() => void act(() => call('/api/payments/claims/' + c.id, send('POST', {action: 'reject'})), 'Claim rejected.')}>Not received</button></span>
      </li>)}</ul> : <p className={styles.fine}>No payments waiting for your confirmation.</p>}
    </section>}
    {showInbox && alerts.length > 0 && <section className={styles.card} aria-labelledby="alerts-h">
      <h3 id="alerts-h">Needs your attention</h3>
      <ul className={styles.list}>{alerts.map(a => <li key={a.id} className={styles.item} data-testid="payment-alert">
        <span><strong>{ALERT[a.kind] ?? a.kind}</strong>{typeof a.detail.excess_minor === 'number' && typeof a.detail.currency === 'string' ? ` · ${fmt(a.detail.excess_minor, a.detail.currency)} extra` : ''}{typeof a.detail.short_minor === 'number' && typeof a.detail.currency === 'string' ? ` · ${fmt(a.detail.short_minor, a.detail.currency)} short` : ''}</span>
        <span>{a.detail.refund && <button type="button" className="secondary" onClick={() => void act(() => call(a.detail.refund!.path, send('POST', a.detail.refund!.body)), 'Refund issued.')}>Refund the extra</button>} <button type="button" className="secondary" onClick={() => void act(() => call('/api/payments/alerts/' + a.id, send('POST', {})), 'Marked as dealt with.')}>Dismiss</button></span>
      </li>)}</ul>
    </section>}
    <p role="status" aria-live="polite" className={styles.fine}>{note}</p>
  </div>;
}
