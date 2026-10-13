'use client';
import Link from 'next/link';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {Copy} from 'lucide-react';
import {toast} from 'sonner';
import {api, post, type ApiError} from '../ui';
import WhatsAppShare, {ClientNotice} from '../components/slots/whatsapp-share';
import {formatMoney} from '@/lib/currency';
import {COPY_FAILED, copyText} from '@/lib/clipboard';
import {exactUnitPrice, itemsTotal} from '@/lib/money';
import {withUnitPrice} from '@/lib/editor';
import styles from './share.module.css';

type Citation = {id: string; kind: string; text: string};
type Item = {id: string; title: string; qty: number; unit: string; price: number | null; unit_price?: number; acceptance: string};
type ChangeOrder = {title?: string; reason?: string; request_quote?: string; add_items?: Item[]; fee_delta?: number; days_delta?: number; revisions_delta?: number};
type Price = {item_id: string; unit_price: number; source: 'rate_card' | 'price_history'; matched: string};
type Radar = {verdict: string; covered: string; engine: string; reasons: string[]; citations: Citation[]; reply: string; basis: string; note: string | null; change_order: ChangeOrder | null; prices: Price[]; currency: string; baseline_version: number | null; tax_pct: number; tax_label: string};
type Capture = {id: string; project_id: string | null; source: string; text: string; url: string | null; files: number; radar: Radar | null};
type Project = {id: string; title: string; client: string; last_activity: string};
type Review = {link: string; phone: string | null} | null;
type Email = {status: string; at?: string | null} | null;
type Notices = {notify_client: boolean; client_email: boolean; share: null | {phone: string | null; lang: string | null; client: string; title: string; link: string};
  change_orders: {seq: number; title: string; status: string; amount: string | null; email: Email}[]; invoices: {seq: number; number: string; amount: string; due: string | null; email: Email}[]};

const VERDICT: Record<string, string> = {in_scope: 'Covered by the agreement', out_of_scope: 'Not covered: this needs a change order', revision: 'A revision round', ambiguous: 'Unclear: check it yourself'};
const signInHref = () => '/auth/sign-in?return_to=' + encodeURIComponent(location.pathname + location.search);

export default function ShareClient() {
  const params = useSearchParams();
  const project = params.get('project');
  if (project) return <ProjectShare projectId={project} />;
  return <CaptureFlow captureId={params.get('capture')} sharedText={params.get('text')} files={Number(params.get('files') || 0)} empty={params.has('empty')} />;
}

function SignInPrompt({what}: {what: string}) {
  return <section className={styles.panel}><h1>Sign in to continue</h1><p>{what}</p><p><a className="primary" href={signInHref()}>Sign in</a></p></section>;
}

function CaptureFlow({captureId, sharedText, files, empty}: {captureId: string | null; sharedText: string | null; files: number; empty: boolean}) {
  const [state, setState] = useState<{capture: Capture; projects?: Project[]; review: Review} | null>(null);
  const [error, setError] = useState(''), [signedOut, setSignedOut] = useState(false), [busy, setBusy] = useState(false);
  const load = useCallback((id: string) => api('/api/share?capture=' + encodeURIComponent(id)).then(setState,
    (e: ApiError) => { if (e.status === 401) setSignedOut(true); else setError(e.message); }), []);
  useEffect(() => {
    if (captureId) { void load(captureId); return; }
    if (!sharedText) return;
    // Back from sign-in with the shared text: turn it into a capture now.
    api('/api/share', post({text: sharedText})).then((r: {capture_id: string}) => { history.replaceState(null, '', '/share?capture=' + r.capture_id); return load(r.capture_id); },
      (e: ApiError) => { if (e.status === 401) setSignedOut(true); else setError(e.message); });
  }, [captureId, sharedText, load]);
  async function choose(projectId: string) {
    setBusy(true); setError('');
    try { const r = await api('/api/share', {...post({capture_id: state!.capture.id, project_id: projectId}), method: 'PATCH'}); setState(s => ({...s!, ...r})); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (signedOut) return <SignInPrompt what={`Sign in to check this message against your agreements${files ? ` (${files} shared image${files === 1 ? '' : 's'} can’t be read yet)` : ''}.`} />;
  if (empty || (!captureId && !sharedText)) return <section className={styles.panel}><h1>Share a client’s message</h1><p>Share a client’s message to Scopeflow from WhatsApp, email or any app (install Scopeflow on your phone first), or paste it into the scope-creep radar on a project.</p>{files > 0 && <p className={styles.fine}>Images can’t be read yet: share the text of the message instead.</p>}<p><Link className="secondary" href="/">Open your projects</Link></p></section>;
  if (error) return <section className={styles.panel}><h1>Share</h1><p className="error" role="alert">{error}</p></section>;
  if (!state) return <p role="status">Checking the message…</p>;
  const {capture} = state;
  return <section className={styles.panel} aria-labelledby="share-h">
    <h1 id="share-h">Check a client’s message</h1>
    <blockquote className={styles.quote}>{capture.text}</blockquote>
    {capture.files > 0 && <p className={styles.fine}>{capture.files} shared image{capture.files === 1 ? '' : 's'} can’t be read yet; only the text is checked.</p>}
    {!capture.project_id || !capture.radar
      ? <div role="group" aria-labelledby="pick-h"><h2 id="pick-h">Which project is this about?</h2>
          {state.projects?.length ? <ul className={styles.list}>{state.projects.map(p => <li className={styles.item} key={p.id}><span><strong>{p.title}</strong>{p.client ? <span className={styles.fine}> · {p.client}</span> : null}</span><button className="secondary" disabled={busy} onClick={() => void choose(p.id)}>Check against {p.title}</button></li>)}</ul> : <p>You have no open projects yet. <Link href="/">Create one</Link> first.</p>}</div>
      : <Verdict capture={capture} review={state.review} project={state.projects?.find(p => p.id === capture.project_id)} />}
  </section>;
}

function Verdict({capture, review, project}: {capture: Capture; review: Review; project?: Project}) {
  const radar = capture.radar!;
  return <>
    <div role="status"><p className={styles.verdict}><strong>{VERDICT[radar.verdict] ?? radar.verdict}</strong></p>
      {radar.reasons.map(r => <p className={styles.fine} key={r}>{r}</p>)}
      {radar.citations.length > 0 && <ul className={styles.list}>{radar.citations.map(c => <li key={c.id}><strong>{c.id}</strong> {c.text}</li>)}</ul>}
      {radar.note && <p className={styles.fine}>{radar.note}</p>}</div>
    {radar.reply && <p className={styles.actions}><span className={styles.fine}>Suggested reply: “{radar.reply}”</span><button className="help-link" onClick={() => { void copyText(radar.reply).then(ok => ok ? toast.success('Suggested reply copied.') : toast.error(COPY_FAILED)); }}><Copy size={13} aria-hidden="true" />Copy</button></p>}
    {radar.change_order && (radar.basis === 'agreement' && radar.baseline_version
      ? <ChangeOrderDraft capture={capture} radar={radar} review={review} project={project} />
      : <p className={styles.fine}>This project’s scope is not approved yet, so extra work goes into a revised version of the scope rather than a change order. <Link href={'/?project=' + encodeURIComponent(capture.project_id!)}>Open the project</Link></p>)}
  </>;
}

function ChangeOrderDraft({capture, radar, review, project}: {capture: Capture; radar: Radar; review: Review; project?: Project}) {
  const co = radar.change_order!;
  const [title, setTitle] = useState(co.title ?? 'Additional work'), [items, setItems] = useState<Item[]>(co.add_items ?? []);
  const [fee, setFee] = useState<string>(co.fee_delta ? String(co.fee_delta) : ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [proposed, setProposed] = useState<{seq: number; email: Email; amount: string | null} | null>(null);
  // R4-03: a change-order item's `price` is its line total. The field here is a price per unit, so it is kept as
  // unit_price and the fee is the sum of the line totals (qty × unit), exactly as the agreement will show them.
  const computed = useMemo(() => itemsTotal(items, radar.currency).total, [items, radar.currency]);
  const unitOf = (it: Item) => { const u = exactUnitPrice(it, radar.currency); return u ?? (typeof it.price === 'number' ? Math.round(it.price / Math.max(1, it.qty) * 100) / 100 : null); };
  const setQty = (i: number, qty: number) => setItems(list => list.map((x, n) => { if (n !== i) return x; const u = x.unit_price == null && typeof x.price === 'number' ? exactUnitPrice(x, radar.currency) : null; return u != null ? withUnitPrice({...x, qty}, u) : {...x, qty}; }));
  const feeValue = fee === '' ? computed : Number(fee);
  const withTax = Math.round(feeValue * (1 + (radar.tax_pct || 0) / 100) * 100) / 100;
  const source = (id: string) => radar.prices.find(p => p.item_id === id);
  const setItem = (i: number, patch: Partial<Item>) => setItems(list => list.map((x, n) => n === i ? {...x, ...patch} : x));
  async function propose() {
    setBusy(true); setError('');
    try {
      const payload = {title, reason: co.reason ?? '', request_quote: co.request_quote ?? capture.text.slice(0, 2000), add_items: items.map(({unit_price, ...i}) => ({...i, price: typeof i.price === 'number' && Number.isFinite(i.price) ? i.price : null, ...(typeof unit_price === 'number' && Number.isFinite(unit_price) ? {unit_price} : {})})), fee_delta: Number.isFinite(feeValue) ? feeValue : 0, days_delta: co.days_delta ?? 0, revisions_delta: co.revisions_delta ?? 0};
      const r = await api(`/api/scopes/${encodeURIComponent(capture.project_id!)}/ledger`, post({kind: 'change_order', baseline_version: radar.baseline_version, payload, request_id: 'share-' + capture.id.replaceAll('-', '')}));
      const n: Notices = await api(`/api/scopes/${encodeURIComponent(capture.project_id!)}/notifications`);
      const mine = n.change_orders.find(c => c.seq === r.seq);
      setProposed({seq: r.seq, email: mine?.email ?? null, amount: mine?.amount ?? null});
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (proposed) return <div role="status" className={styles.panel}><h2>Change order CO-{proposed.seq} proposed</h2><p className={styles.fine}>It applies only after your client approves it on their review page.</p>
    {review && <ClientNotice email={proposed.email} kind="change_order" phone={review.phone} values={{client: project?.client, title: project?.title, seq: proposed.seq, co_title: title, amount: proposed.amount ?? undefined, link: review.link}} label="Back to WhatsApp" projectId={capture.project_id!} />}</div>;
  return <form className={styles.panel} onSubmit={e => { e.preventDefault(); void propose(); }} aria-labelledby="co-h">
    <h2 id="co-h">Draft change order</h2>
    <label className={styles.field}>Title<input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} required minLength={3} /></label>
    {items.map((it, i) => <div className={styles.grid} key={it.id}>
      <label className={styles.field}>Deliverable<input value={it.title} onChange={e => setItem(i, {title: e.target.value})} maxLength={200} /></label>
      <label className={styles.field}>Qty<input type="number" min={1} value={it.qty} onChange={e => setQty(i, Math.max(1, Math.round(Number(e.target.value)) || 1))} /></label>
      <label className={styles.field}>Unit price ({radar.currency})<input type="number" min={0} step="0.01" value={unitOf(it) ?? ''} onChange={e => setItems(list => list.map((x, n) => n === i ? withUnitPrice(x, e.target.value === '' ? null : Number(e.target.value)) : x))} data-testid="co-unit-price" /></label>
      {it.qty > 1 && unitOf(it) != null && <p className={styles.fine} data-testid="co-line-total">{it.qty} × {formatMoney(unitOf(it)!, radar.currency)} = {formatMoney(itemsTotal([it], radar.currency).total, radar.currency)}</p>}
      {source(it.id) && <p className={styles.fine}>{source(it.id)!.source === 'rate_card' ? `From your rate card: ${source(it.id)!.matched}` : `From your earlier scope: ${source(it.id)!.matched}`}</p>}
    </div>)}
    <label className={styles.field}>Fee change ({radar.currency})<input type="number" step="0.01" value={fee === '' ? (computed || '') : fee} onChange={e => setFee(e.target.value)} data-testid="co-fee" /></label>
    <p data-testid="co-total"><strong>{formatMoney(feeValue || 0, radar.currency)}</strong>{radar.tax_pct ? ` + ${radar.tax_label} ${radar.tax_pct}% = ${formatMoney(withTax, radar.currency)}` : ''}</p>
    <div className={styles.actions}><button className="primary" disabled={busy}>Propose change order</button><span className={styles.fine}>Your client is emailed and can approve or decline it.</span></div>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

/** The project's "tell the client" view: review link, change orders and invoices, each with its email status and a WhatsApp share. */
function ProjectShare({projectId}: {projectId: string}) {
  const [data, setData] = useState<Notices | null>(null), [error, setError] = useState(''), [signedOut, setSignedOut] = useState(false);
  const load = useCallback(() => api(`/api/scopes/${encodeURIComponent(projectId)}/notifications`).then(setData, (e: ApiError) => { if (e.status === 401) setSignedOut(true); else setError(e.message); }), [projectId]);
  useEffect(() => { void load(); }, [load]);
  async function toggle(on: boolean) {
    try { await api(`/api/scopes/${encodeURIComponent(projectId)}/notifications`, {...post({notify_client: on}), method: 'PATCH'}); await load(); } catch (e) { setError((e as Error).message); }
  }
  if (signedOut) return <SignInPrompt what="Sign in to share this project with your client." />;
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p role="status">Loading…</p>;
  const s = data.share;
  return <section className={styles.panel} aria-labelledby="ps-h">
    {/* #28: a way back, and the project title as a quiet line rather than a display-size H1. */}
    <p className={styles.fine}><Link className="help-link" href={'/?project=' + encodeURIComponent(projectId)}>← Back to project</Link></p>
    <div><h1 id="ps-h" className={styles.title}>Tell your client</h1>{s && <p className={styles.subtitle}>{s.title}</p>}</div>
    {s && <div className={styles.actions} role="group" aria-label="Review link">
      <button className="secondary" onClick={() => { void copyText(s.link).then(ok => { if (!ok) { toast.error(COPY_FAILED); return; } void fetch(`/api/scopes/${encodeURIComponent(projectId)}/notifications`, post({shared: 'link'})); toast.success('Review link copied.'); }); }}><Copy size={14} aria-hidden="true" />Copy link</button>
      <WhatsAppShare kind="scope" phone={s.phone} lang={s.lang} values={{client: s.client, title: s.title, link: s.link}} projectId={projectId} />
    </div>}
    {(() => { const canEmail = data.client_email; const why = canEmail ? '' : 'Add the client’s email on the project first.'; return <>
      <label className="check-row">{/* R4-09: box beside its label at 390 */}<input type="checkbox" checked={canEmail ? data.notify_client : false} disabled={!canEmail} aria-describedby={why ? 'ps-email-why' : undefined} onChange={e => void toggle(e.target.checked)} /><span>Email the client when I propose a change order or issue an invoice</span></label>
      {why && <p id="ps-email-why" className={styles.fine}>{why}</p>}</>; })()}
    {data.change_orders.length > 0 && <><h2>Change orders</h2><ul className={styles.list}>{data.change_orders.map(c => <li className={styles.item} key={c.seq} data-testid={`co-${c.seq}`}>
      <span><strong>CO-{c.seq}</strong> {c.title}{c.amount ? ` · ${c.amount}` : ''} <span className={styles.fine}>({c.status})</span></span>
      {s && <ClientNotice email={c.email} kind="change_order" phone={s.phone} lang={s.lang} values={{client: s.client, title: s.title, seq: c.seq, co_title: c.title, amount: c.amount ?? undefined, link: s.link}} projectId={projectId} />}
    </li>)}</ul></>}
    {data.invoices.length > 0 && <><h2>Invoices</h2><ul className={styles.list}>{data.invoices.map(i => <li className={styles.item} key={i.seq}>
      <span><strong>{i.number}</strong> · {i.amount}{i.due ? ` · due ${i.due}` : ''}</span>
      {s && <span className={styles.actions}><ClientNotice email={i.email} kind="invoice" phone={s.phone} lang={s.lang} values={{client: s.client, title: s.title, number: i.number, amount: i.amount, due: i.due ?? undefined, link: s.link}} projectId={projectId} />
        <WhatsAppShare kind="reminder" phone={s.phone} lang={s.lang} values={{client: s.client, title: s.title, number: i.number, amount: i.amount, link: s.link}} label="Send a reminder on WhatsApp" editable={false} /></span>}
    </li>)}</ul></>}
  </section>;
}
