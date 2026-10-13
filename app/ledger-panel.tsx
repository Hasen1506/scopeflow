'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {FilePlus2, Gift, Inbox, RefreshCw, RotateCcw, ShieldCheck, ShieldAlert} from 'lucide-react';
import {coSummary, describeEntry, type Agreement, type ChangeOrder, type LedgerEntry} from '@/lib/ledger';
import {formatMoney, label, type Item, type Scope} from '@/lib/scope';
import {formatInZone, formatDay} from '@/lib/time';
import {ItemsEditor} from './items-editor';
import {ScopeCheck} from './scope-check';
import {api, post, Skeleton} from './ui';
import {changeOrderProblems, changeOrderNudges, nextForm, type LedgerForm} from '@/lib/ledger-form';
import RateCardPicker from './components/slots/rate-card-picker';
import {RetainerPanel} from './retainer-panel';

export type LedgerView = {
  open: boolean; reason: string | null;
  baseline: {version: number; signer: string | null; decided: string | null; content: Scope} | null;
  agreement: Agreement | null; entries: LedgerEntry[];
  chain: {intact: true; head: string; count: number} | {intact: false; at: number; reason: string};
};
type CoPrefill = Partial<Pick<ChangeOrder, 'title' | 'reason' | 'request_quote' | 'add_items' | 'remove_item_ids' | 'fee_delta' | 'days_delta' | 'revisions_delta' | 'bank_delta' | 'revises' | 'rate_card'>>;
type Form = LedgerForm;
// The viewer's own calendar date, not UTC's (feedback that arrived this morning in Chennai is dated today).
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function LedgerPanel({projectId, reviewUrl, timeZone = null, onView, onLoadError, openChangeOrder = 0, reload = 0}: {projectId: string; reviewUrl: string | null; timeZone?: string | null; onView?: (view: LedgerView) => void; onLoadError?: (message: string) => void; openChangeOrder?: number; reload?: number}) {
  const [view, setView] = useState<LedgerView | null>(null);
  const [form, setForm] = useState<Form>(null);
  const [coSeed, setCoSeed] = useState<CoPrefill>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [roundNote, setRoundNote] = useState('');
  const pendingWrite = useRef<{signature:string;id:string}|null>(null);
  // LT-08: withdrawals in flight (optimistic: the CO shows as withdrawn at once; a second click is ignored).
  const [withdrawing, setWithdrawing] = useState<number[]>([]);
  const withdrawInflight = useRef(new Set<number>());
  // True while the open form holds input that has not been recorded.
  const dirty = useRef(false);
  const formArea = useRef<HTMLDivElement>(null);
  const handledSignal = useRef(0);
  const setDirty = useCallback((value: boolean) => { dirty.current = value; }, []);

  const load = useCallback(async () => {
    setError('');
    try { setView(await api(`/api/scopes/${projectId}/ledger`)); } catch (e) { setError((e as Error).message); }
  }, [projectId]);
  useEffect(() => {
    let live = true;
    api(`/api/scopes/${projectId}/ledger`).then(v => { if (live) setView(v); }, e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [projectId]);

  // Something else on the page wrote to the ledger (a payment recorded in the Payment step): read it again.
  useEffect(() => { if (reload) queueMicrotask(() => void load()); }, [reload, load]);
  // The project page reads the agreement for its Payment step and stage tracker.
  useEffect(() => { if (view) onView?.(view); }, [view, onView]);
  // UX-C20: the Payment step also needs to know when the ledger never loaded (its own error stays in this panel).
  useEffect(() => { if (!view) onLoadError?.(error); }, [view, error, onLoadError]);
  // A "Record change order" press elsewhere on the page (or on a Projects card) opens the form once per press,
  // unless another form with typed input is open.
  useEffect(() => {
    if (!openChangeOrder || handledSignal.current === openChangeOrder || !view?.baseline || !view.agreement || dirty.current) return;
    handledSignal.current = openChangeOrder;
    queueMicrotask(() => { setCoSeed({}); setForm('change_order'); setError(''); setNotice(''); requestAnimationFrame(() => formArea.current?.scrollIntoView?.({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'})); });
  }, [openChangeOrder, view]);

  async function submit(kind: string, payload: unknown, requestId?: string) {
    if (busy) return false;
    if (!view?.baseline) { setError(view?.reason || 'The ledger opens once the client approves the latest version.'); return false; }
    const signature=JSON.stringify({kind,baseline_version:view.baseline.version,payload});
    if(pendingWrite.current?.signature!==signature)pendingWrite.current={signature,id:requestId??crypto.randomUUID()};
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/api/scopes/${projectId}/ledger`, post({kind, baseline_version: view.baseline.version, payload, request_id:pendingWrite.current.id}));
      pendingWrite.current=null;
      dirty.current = false;
      setView(result); setForm(null);
      setNotice(kind === 'change_order' ? `CO-${result.seq} recorded${result.withdrawn ? `, replacing CO-${result.withdrawn} (withdrawn)` : ''}. The client can approve it on their review link.` : 'Recorded on the ledger.');
      return true;
    } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }

  // LT-08: one fast, idempotent request; the UI updates before the server answers and rolls back on failure.
  async function withdraw(seq: number) {
    if (withdrawInflight.current.has(seq) || !view?.baseline) return;
    withdrawInflight.current.add(seq);
    setWithdrawing(w => [...w, seq]); setError(''); setNotice('');
    try {
      const result = await api(`/api/scopes/${projectId}/ledger`, post({kind: 'settle', baseline_version: view.baseline.version, payload: {ref_seq: seq, outcome: 'withdrawn'}}));
      setView(result); setNotice(`CO-${seq} withdrawn.`);
    } catch (e) { setError((e as Error).message); } finally { withdrawInflight.current.delete(seq); setWithdrawing(w => w.filter(x => x !== seq)); }
  }

  if (!view) return <section className="ledger section-gap"><h3>Agreement ledger</h3>{error ? <p className="error" role="alert">{error}</p> : <Skeleton lines={3} cards={1} label="Loading ledger…" />}</section>;
  const a = view.agreement, base = view.baseline?.content;
  const cur = a?.currency ?? 'USD';
  const items = base ? [...(a?.items ?? []), ...(a?.removed ?? [])] : [];
  // Toolbar buttons only open or switch forms; they never close one or discard typed input (see lib/ledger-form.ts).
  const openForm = (f: Exclude<Form, null>, seed: CoPrefill = {}) => {
    const next = nextForm(form, f, {dirty: dirty.current, reseed: Object.keys(seed).length > 0, confirmDiscard: () => window.confirm('Discard the form you started? Nothing from it has been recorded.')});
    if (next.reset) { setCoSeed(seed); setForm(next.form); dirty.current = false; setError(''); setNotice(''); }
    requestAnimationFrame(() => formArea.current?.scrollIntoView?.({block: 'nearest', behavior: 'smooth'}));
  };
  const closeForm = () => {
    if (dirty.current && !window.confirm('Discard the form you started? Nothing from it has been recorded.')) return;
    dirty.current = false; setForm(null); setError('');
  };
  const toggle = (f: Exclude<Form, null>) => 'secondary' + (form === f ? ' selected' : '');

  return (
    <section className="ledger section-gap">
      <div className="small-title">
        <h3>Agreement ledger</h3>
        {(view.open || !view.chain.intact || view.chain.count > 0) && <span className="actions">
          {view.chain.intact
            ? <span className="chain ok" title={`Chain head ${view.chain.head}`}><ShieldCheck size={14} />{view.chain.count} {view.chain.count === 1 ? 'entry' : 'entries'} · {view.chain.head.slice(0, 8)}</span>
            : <span className="chain bad"><ShieldAlert size={14} />Record check failed at entry {view.chain.at}</span>}
          <button className="icon" aria-label="Refresh ledger" onClick={load}><RefreshCw size={14} /></button>
        </span>}
      </div>
      {!view.open && <p className="muted-box">{view.reason}</p>}
      {a && base && (
        <>
          <div className="agreement-grid">
            <div><span>Current fee</span><strong>{formatMoney(a.fee, cur)}</strong>{a.fee !== a.fee_base && <em>was {formatMoney(a.fee_base, cur)}</em>}</div>
            <div><span>Delivery</span><strong>{formatDay(a.due) || 'Not set'}</strong>{a.days_shift !== 0 && <em>{a.days_shift > 0 ? '+' : ''}{a.days_shift} days{a.due_base ? ` from ${formatDay(a.due_base)}` : ''}</em>}</div>
            <div><span>Revision rounds</span><strong className={a.rounds_over ? 'over' : ''}>{a.revisions_used} / {a.revisions_allowed}</strong><meter min={0} max={Math.max(1, a.revisions_allowed)} value={Math.min(a.revisions_used, Math.max(1, a.revisions_allowed))} /></div>
            {a.bank && <div><span>Revision {a.bank.unit === 'hours' ? 'hours' : 'budget'}</span><strong className={a.bank.over ? 'over' : ''}>{a.bank.unit === 'hours' ? `${a.bank.used}h / ${a.bank.allowed}h` : `${formatMoney(a.bank.used, cur)} / ${formatMoney(a.bank.allowed, cur)}`}</strong><meter min={0} max={Math.max(1, a.bank.allowed)} value={Math.min(a.bank.used, Math.max(1, a.bank.allowed))} />{a.bank.over > 0 && <em>{a.bank.unit === 'hours' ? `${a.bank.over}h over` : `${formatMoney(a.bank.over, cur)} over`}{a.bank.overage_value > 0 ? ` · ${formatMoney(a.bank.overage_value, cur)} billable` : ''}</em>}</div>}
            <div><span>Goodwill absorbed</span><strong>{formatMoney(a.goodwill_value, cur)}</strong>{a.goodwill_hours > 0 && <em>{a.goodwill_hours}h unbilled</em>}</div>
          </div>
          {a.bank && a.bank.left === 0 && (
            <div className="muted-box warn-box">
              {a.bank.over ? `The revision ${a.bank.unit === 'hours' ? 'hours are' : 'budget is'} overdrawn by ${a.bank.unit === 'hours' ? a.bank.over + 'h' : formatMoney(a.bank.over, cur)}${a.bank.overage_value ? `, ${formatMoney(a.bank.overage_value, cur)} at the agreed overage rate` : ''}.` : `The revision ${a.bank.unit === 'hours' ? 'hours are' : 'budget is'} used up.`}
              <div className="actions gap-top"><button className="secondary" onClick={() => openForm('change_order', {title: a.bank!.unit === 'hours' ? 'Top up revision hours' : 'Top up revision budget', reason: 'The revision bank in the approved scope is used up.', bank_delta: a.bank!.unit === 'hours' ? 5 : 0, fee_delta: a.bank!.overage_value || 0})}>Draft a top-up change order</button></div>
            </div>
          )}
          {a.revisions_used >= a.revisions_allowed && !a.bank && (
            <div className="muted-box warn-box">
              {a.rounds_over ? `${a.rounds_over} round${a.rounds_over > 1 ? 's' : ''} over the allowance.` : 'The included revision rounds are used up.'} The next round of feedback is new work.
              <div className="actions gap-top"><button className="secondary" onClick={() => openForm('change_order', {title: 'Additional revision round', reason: 'All included revision rounds have been used.', revisions_delta: 1})}>Draft a change order for an extra round</button></div>
            </div>
          )}
          {a.pending > 0 && <p className="fine">{a.pending} change order{a.pending > 1 ? 's' : ''} awaiting the client{reviewUrl ? ' on ' : '.'}{reviewUrl && <a className="help-link" href={reviewUrl} target="_blank" rel="noreferrer">their review link</a>}</p>}
          {base.engagement === 'retainer' && base.retainer && <RetainerPanel projectId={projectId} items={a.items} onChanged={load} />}
          <ScopeCheck projectId={projectId} busy={busy} onDraft={co => openForm('change_order', co)} onLogRound={note => { if (a.bank) { setRoundNote(note); openForm('revision_round'); } else void submit('revision_round', {feedback_date: today(), note}); }} />
          <div className="actions section-gap">
            <button type="button" className={toggle('change_order')} aria-pressed={form === 'change_order'} disabled={busy} onClick={() => openForm('change_order')}><FilePlus2 size={16} />Change order</button>
            <button type="button" className={toggle('revision_round')} aria-pressed={form === 'revision_round'} disabled={busy} onClick={() => openForm('revision_round')}><RotateCcw size={16} />Revision round</button>
            {!!base.client_inputs?.length && <button type="button" className={toggle('client_input')} aria-pressed={form === 'client_input'} disabled={busy} onClick={() => openForm('client_input')}><Inbox size={16} />Client input received</button>}
            <button type="button" className={toggle('goodwill')} aria-pressed={form === 'goodwill'} disabled={busy} onClick={() => openForm('goodwill')}><Gift size={16} />Goodwill</button>
          </div>
          <div ref={formArea}>
            {form === 'change_order' && <ChangeOrderForm key={JSON.stringify(coSeed)} seed={coSeed} agreement={a} scope={base} projectId={projectId} busy={busy} error={error} onInvalid={setError} onDirty={setDirty} onSubmit={(p, id) => submit('change_order', p, id)} onCancel={closeForm} />}
            {form === 'revision_round' && <RoundForm key={roundNote} busy={busy} error={error} used={a.revisions_used} allowed={a.revisions_allowed} bank={a.bank} currency={cur} seedNote={roundNote} onSubmit={p => submit('revision_round', p)} onCancel={closeForm} />}
            {form === 'client_input' && <InputForm busy={busy} error={error} inputs={(base.client_inputs ?? []).filter(i => !a.delays.some(d => d.input_id === i.id))} onSubmit={p => submit('client_input', p)} onCancel={closeForm} />}
            {form === 'goodwill' && <GoodwillForm busy={busy} error={error} currency={cur} onDirty={setDirty} onSubmit={p => submit('goodwill', p)} onCancel={closeForm} />}
          </div>
        </>
      )}
      {error && !form && <p className="error" role="alert">{error}</p>}
      {notice && <p className="muted-box" role="status">{notice}</p>}
      {view.entries.length > 0 && (
        <ol className="timeline">
          {[...view.entries].reverse().map(e => {
            const found = a?.change_orders.find(c => c.seq === e.seq);
            const co = found && withdrawing.includes(found.seq) ? {...found, status: 'withdrawn' as const} : found;
            const stale = view.baseline && e.baseline_version !== view.baseline.version;
            return (
              <li key={e.seq} className={'kind-' + e.kind}>
                <div className="small-title">
                  <span>{describeEntry(e, cur, items, base?.client_inputs ?? [])}</span>
                  {co && <span className={'tag status-' + (co.status === 'proposed' ? 'pending' : co.status === 'approved' ? 'approved' : 'changes_requested')}>{label(co.status)}</span>}
                </div>
                <span className="fine">Entry {e.seq} · {formatInZone(e.created, timeZone)} · {e.actor === 'client' ? 'client' : e.actor === 'system' ? 'Scopeflow (Razorpay)' : 'you'}{stale || !view.baseline ? ` · on version ${e.baseline_version}` : ''}</span>
                {co?.status === 'proposed' && <span className="actions">
                  <button className="link-button" disabled={busy} onClick={() => openForm('change_order', {title: co.title, reason: co.reason, request_quote: co.request_quote, add_items: co.add_items, remove_item_ids: co.remove_item_ids, fee_delta: co.fee_delta, days_delta: co.days_delta, revisions_delta: co.revisions_delta, ...(co.bank_delta ? {bank_delta: co.bank_delta} : {}), revises: co.seq})}>Revise</button>
                  <button className="link-button" disabled={withdrawing.includes(co.seq)} onClick={() => { if (window.confirm(`Withdraw CO-${co.seq}? The client will no longer be able to approve it.`)) void withdraw(co.seq); }}>Withdraw</button>
                </span>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function InlineError({error}: {error: string}) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}

function ChangeOrderForm({seed, agreement, scope, projectId, busy, error, onInvalid, onDirty, onSubmit, onCancel}: {seed: CoPrefill; agreement: Agreement; scope: Scope; projectId: string; busy: boolean; error: string; onInvalid: (message: string) => void; onDirty: (dirty: boolean) => void; onSubmit: (p: ChangeOrder, requestId: string) => Promise<boolean>; onCancel: () => void}) {
  const [title, setTitle] = useState(seed.title ?? '');
  const [reason, setReason] = useState(seed.reason ?? '');
  const [quote, setQuote] = useState(seed.request_quote ?? '');
  const [add, setAdd] = useState<Item[]>(seed.add_items ?? []);
  const [remove, setRemove] = useState<string[]>(seed.remove_item_ids ?? []);
  const [rateCard, setRateCard] = useState<ChangeOrder['rate_card']>(seed.rate_card);
  const [fee, setFee] = useState(String(seed.fee_delta ?? 0));
  const [days, setDays] = useState(String(seed.days_delta ?? 0));
  const [rounds, setRounds] = useState(String(seed.revisions_delta ?? 0));
  const [bankDelta, setBankDelta] = useState(String(seed.bank_delta ?? 0));
  // One id per drafted change order, so a retried submit cannot record it twice.
  const [requestId] = useState(() => crypto.randomUUID());
  const cur = agreement.currency;
  const payload: ChangeOrder = {title, reason, request_quote: quote, add_items: add, remove_item_ids: remove, fee_delta: Number(fee) || 0, days_delta: Math.round(Number(days) || 0), revisions_delta: Math.round(Number(rounds) || 0), ...(agreement.bank && Number(bankDelta) ? {bank_delta: Number(bankDelta)} : {}), ...(seed.revises ? {revises: seed.revises} : {}), ...(rateCard ? {rate_card: rateCard} : {})};
  const nudges = changeOrderNudges(payload);
  const itemTotal = add.reduce((s, i) => s + (i.price ?? 0), 0);
  const fingerprint = JSON.stringify(payload);
  const [initial] = useState(fingerprint);
  useEffect(() => { onDirty(fingerprint !== initial); }, [fingerprint, initial, onDirty]);
  function record() {
    const problems = changeOrderProblems(payload);
    if (problems.length) { onInvalid(problems.join(' · ')); return; }
    void onSubmit(payload, requestId);
  }
  return (
    <form className="ledger-form" aria-label={seed.revises ? `Revise CO-${seed.revises}` : 'New change order'} onSubmit={e => { e.preventDefault(); record(); }}>
      {seed.revises && <p className="muted-box">Recording this withdraws CO-{seed.revises} and proposes the revised change order in its place, in one step.</p>}
      <RateCardPicker currency={agreement.currency} projectId={projectId} onPick={draft => { setTitle(draft.title); setReason(r => r || draft.reason); setAdd(a => [...a, ...draft.add_items]); setFee(f => String(Math.round(((Number(f) || 0) + draft.fee_delta) * 100) / 100)); setRateCard(draft.rate_card); }} />
      <label>Change order title<input required minLength={3} maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Instagram templates" /></label>
      <label>Client’s request, in their words <span className="quiet">· optional</span><textarea rows={2} maxLength={2000} value={quote} onChange={e => setQuote(e.target.value)} /></label>
      <label>Why this is a change <span className="quiet">· optional</span><input maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Social templates are listed as outside this scope" /></label>
      <ItemsEditor items={add} currency={cur} onChange={setAdd} />
      {agreement.items.length > 0 && (
        <fieldset className="items"><legend>Remove from the agreement</legend>
          {agreement.items.map(i => (
            <label key={i.id} className="check-row"><input type="checkbox" checked={remove.includes(i.id)} onChange={e => setRemove(r => e.target.checked ? [...r, i.id] : r.filter(x => x !== i.id))} />{i.title}{i.source !== 'baseline' && <span className="quiet"> (CO-{i.source})</span>}</label>
          ))}
        </fieldset>
      )}
      <div className="three-col">
        <label>Fee change ({cur})<input type="number" step="0.01" value={fee} onChange={e => setFee(e.target.value)} /></label>
        <label>Schedule change (days)<input type="number" step="1" value={days} onChange={e => setDays(e.target.value)} /></label>
        <label>Extra revision rounds<input type="number" step="1" value={rounds} onChange={e => setRounds(e.target.value)} /></label>
      </div>
      {agreement.bank && <label>Revision {agreement.bank.unit === 'hours' ? 'hours added' : `budget added (${cur})`} <span className="quiet">· {agreement.bank.left} left now</span><input type="number" step={agreement.bank.unit === 'hours' ? '0.25' : '0.01'} value={bankDelta} onChange={e => setBankDelta(e.target.value)} /></label>}
      {itemTotal > 0 && Number(fee) !== itemTotal && <p className="fine">Added deliverables are priced at {formatMoney(itemTotal, cur)}. <button type="button" className="link-button" onClick={() => setFee(String(itemTotal))}>Use as fee change</button></p>}
      {nudges.map(n => <p key={n} className="muted-box warn-box" role="note">{n}</p>)}
      <p className="muted-box">Client will see: <strong>{title || 'Untitled'}</strong>{coSummary(payload, cur, agreement.items) ? ' · ' + coSummary(payload, cur, agreement.items) : ''}. New fee {formatMoney(agreement.fee + payload.fee_delta, cur)}{scope.tax_pct ? ` + ${scope.tax_label || 'Tax'} ${scope.tax_pct}% = ${formatMoney(Math.round((agreement.fee + payload.fee_delta) * (100 + scope.tax_pct)) / 100, cur)}` : ''}.</p>
      <InlineError error={error} />
      <div className="actions"><button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : seed.revises ? `Record revision of CO-${seed.revises}` : 'Record for client review'}</button><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function RoundForm({busy, error, used, allowed, bank, currency, seedNote, onSubmit, onCancel}: {busy: boolean; error: string; used: number; allowed: number; bank: Agreement['bank']; currency: string; seedNote: string; onSubmit: (p: unknown) => Promise<boolean>; onCancel: () => void}) {
  const [date, setDate] = useState(today());
  const [note, setNote] = useState(seedNote);
  const [spent, setSpent] = useState('');
  return (
    <form className="ledger-form" onSubmit={e => { e.preventDefault(); void onSubmit({feedback_date: date, note, ...(bank ? {used: Number(spent) || 0} : {})}); }}>
      {bank
        ? <p className="fine">{bank.unit === 'hours' ? `${bank.left}h of ${bank.allowed}h` : `${formatMoney(bank.left, currency)} of ${formatMoney(bank.allowed, currency)}`} left in the revision bank.</p>
        : <p className="fine">This will be round {used + 1} of {allowed} included.{used + 1 > allowed ? ' It is over the allowance, so consider a change order instead.' : ''}</p>}
      {bank && <label>{bank.unit === 'hours' ? 'Hours this round took' : `Cost of this round (${currency})`}<input type="number" required min={0} step={bank.unit === 'hours' ? '0.25' : '0.01'} value={spent} onChange={e => setSpent(e.target.value)} /></label>}
      <div className="two-col"><label>Feedback received<input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label><label>Note <span className="quiet">· optional</span><input maxLength={2000} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Logo colour feedback" /></label></div>
      <InlineError error={error} />
      <div className="actions"><button type="submit" className="primary" disabled={busy}>Log revision round</button><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function InputForm({busy, error, inputs, onSubmit, onCancel}: {busy: boolean; error: string; inputs: {id: string; title: string; due: string}[]; onSubmit: (p: unknown) => Promise<boolean>; onCancel: () => void}) {
  const [id, setId] = useState(inputs[0]?.id ?? '');
  const [date, setDate] = useState(today());
  const [shift, setShift] = useState(true);
  const [note, setNote] = useState('');
  const chosen = inputs.find(i => i.id === id);
  const late = chosen?.due && date > chosen.due ? Math.round((Date.parse(date) - Date.parse(chosen.due)) / 86400000) : 0;
  if (!inputs.length) return <p className="fine">Every client input has been recorded.</p>;
  return (
    <form className="ledger-form" onSubmit={e => { e.preventDefault(); void onSubmit({input_id: id, received: date, shift, note}); }}>
      <div className="two-col">
        <label>What arrived<select value={id} onChange={e => setId(e.target.value)}>{inputs.map(i => <option key={i.id} value={i.id}>{i.title}{i.due ? ` (due ${formatDay(i.due)})` : ''}</option>)}</select></label>
        <label>Received on<input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label>
      </div>
      {late > 0 && <label className="check-row"><input type="checkbox" checked={shift} onChange={e => setShift(e.target.checked)} />{late} day{late > 1 ? 's' : ''} late: move the delivery date by the same amount</label>}
      <label>Note <span className="quiet">· optional</span><input maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <InlineError error={error} />
      <div className="actions"><button type="submit" className="primary" disabled={busy}>Record</button><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function GoodwillForm({busy, error, currency, onDirty, onSubmit, onCancel}: {busy: boolean; error: string; currency: string; onDirty: (dirty: boolean) => void; onSubmit: (p: unknown) => Promise<boolean>; onCancel: () => void}) {
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(true);
  const typed = !!(title || value || hours || note);
  useEffect(() => { onDirty(typed); }, [typed, onDirty]);
  return (
    <form className="ledger-form" onSubmit={e => { e.preventDefault(); void onSubmit({title, value: Number(value) || 0, hours: Number(hours) || 0, note, visible}); }}>
      <p className="fine">Work you did outside the scope without charging. Logging it makes the generosity visible, and gives you a basis for the next conversation about fees.</p>
      <label>What you did<input required minLength={3} maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Extra logo concept" /></label>
      <div className="two-col"><label>Value ({currency})<input type="number" min={0} step="0.01" required value={value} onChange={e => setValue(e.target.value)} /></label><label>Hours <span className="quiet">· optional</span><input type="number" min={0} step="0.25" value={hours} onChange={e => setHours(e.target.value)} /></label></div>
      <label>Note <span className="quiet">· optional</span><input maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <label className="check-row"><input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} />Show this to the client (unchecked entries stay private but still count in the record’s fingerprint)</label>
      <InlineError error={error} />
      <div className="actions"><button type="submit" className="primary" disabled={busy}>Log goodwill</button><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button></div>
    </form>
  );
}
