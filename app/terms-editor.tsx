'use client';
import {Fragment, useState} from 'react';
import {Plus, X} from 'lucide-react';
import {currencyList} from '@/lib/currency';
import {schedule, totals} from '@/lib/money';
import {formatMoney, newId, type Fx, type Milestone, type RevisionBank, type Scope} from '@/lib/scope';
import {rowName} from '@/lib/a11y';

// Editors for the optional Phase 3 terms: a payment schedule (milestones), a second currency at a
// rate fixed in the signed scope, and a revision bank (hours or budget). Each calls onChange with
// undefined to remove the term, so unset terms stay out of the signed content.

const num = (v: string) => (v === '' || Number.isNaN(Number(v)) ? NaN : Number(v));

export function MilestonesEditor({scope, onChange}: {scope: Scope; onChange: (m: Milestone[] | undefined) => void}) {
  const list = scope.milestones ?? [];
  const sum = Math.round(list.reduce((a, m) => a + (Number.isFinite(m.pct) ? m.pct : 0), 0) * 100) / 100;
  const total = totals({...scope, fee: Number.isFinite(scope.fee) ? scope.fee : 0}).total;
  const lines = schedule({milestones: list.map(m => ({...m, pct: Number.isFinite(m.pct) ? m.pct : 0}))}, total);
  // Visual re-audit #5: amounts only mean something once the shares add up to 100%; until then show a dash, never $0.00.
  const balanced = Math.abs(sum - 100) <= 0.01, remaining = Math.max(0, Math.round((100 - sum) * 100) / 100);
  // Visual re-audit #5: a new milestone takes the share still unassigned; when the schedule is already at 100%, it
  // splits the last milestone in two, so adding a row never pushes the total past 100%.
  // R3-05: a new row gets a real title ("On delivery", then "Milestone 3"…), so it saves as is and never shows
  // as a bare "(50%)" in the preview; the owner renames it.
  const nextTitle = () => { const used = new Set(list.map(m => m.title.trim().toLowerCase())); if (!used.has('on delivery')) return 'On delivery'; let n = list.length + 1; while (used.has(`milestone ${n}`)) n++; return `Milestone ${n}`; };
  const addMilestone = () => {
    if (!list.length) return onChange([{id: newId('m'), title: 'On signature', pct: 100, due: ''}]);
    if (remaining > 0) return onChange([...list, {id: newId('m'), title: nextTitle(), pct: remaining, due: ''}]);
    const last = list[list.length - 1], lastPct = Number.isFinite(last.pct) ? last.pct : 0, keep = Math.round(lastPct * 50) / 100;
    onChange([...list.slice(0, -1), {...last, pct: keep}, {id: newId('m'), title: nextTitle(), pct: Math.round((lastPct - keep) * 100) / 100, due: ''}]);
  };
  // R3-09 (N6): every row has a distinct accessible name, even untitled or duplicate ones.
  const titles = list.map(m => m.title), nameOf = (i: number) => rowName(titles, i, 'untitled milestone');
  const update = (i: number, patch: Partial<Milestone>) => onChange(list.map((m, j) => (j === i ? {...m, ...patch} : m)));
  const remove = (i: number) => { const next = list.filter((_, j) => j !== i); onChange(next.length ? next : undefined); };
  // R4-10: a too-short title is flagged once the owner leaves the field (or when it arrives short), never while
  // they are retyping it, like the client email (UX-C35).
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <fieldset className="items">
      <legend>Payment schedule <span className="quiet">· milestones as a share of the total; they must add up to 100%</span></legend>
      {list.map((m, i) => {
        // R3-05: a title the schema rejects (under 2 characters) is flagged on its own row, not only under the schedule.
        const short = m.title.trim().length < 2 && editing !== m.id, errId = `milestone-title-err-${m.id}`;
        return <Fragment key={m.id}>
        <div className="input-row milestone-row">
          <input aria-label={`Milestone ${i + 1} title`} placeholder={i === 0 ? 'e.g. On signature' : 'e.g. On delivery'} maxLength={120} value={m.title} aria-invalid={short || undefined} aria-describedby={short ? errId : undefined} onFocus={() => setEditing(m.id)} onBlur={() => setEditing(null)} onChange={e => update(i, {title: e.target.value})} />
          <input aria-label={`Share for ${nameOf(i)} (%)`} type="number" min={0} max={100} step="0.01" inputMode="decimal" value={Number.isFinite(m.pct) ? m.pct : ''} onChange={e => update(i, {pct: num(e.target.value)})} />
          <input aria-label={`Due date for ${nameOf(i)}`} type="date" value={m.due} onChange={e => update(i, {due: e.target.value})} />
          <span className="fine">{balanced ? formatMoney(lines[i]?.amount ?? 0, scope.currency) : '—'}</span>
          <button type="button" className="icon" aria-label={`Remove ${nameOf(i)}`} onClick={() => remove(i)}><X size={15} /></button>
        </div>
        {short && <span className="error-text" id={errId}>Name milestone {i + 1} (at least 2 characters).</span>}
        </Fragment>;
      })}
      <div className="items-foot">
        <button type="button" className="secondary" onClick={addMilestone}><Plus size={16} />Add milestone</button>
        {list.length > 0 && <span className={Math.abs(sum - 100) > 0.01 ? 'warn-text' : 'fine'}>Adds up to {sum}%{Math.abs(sum - 100) > 0.01 ? ' (needs 100%)' : ''}{scope.deposit_pct ? ' · clear the deposit above to use milestones' : ''}{sum > 100.01 ? ' · lower a share to bring it to 100%' : ''}{!balanced && list.length > 0 ? ' · amounts show once it adds up to 100%' : ''}</span>}
      </div>
    </fieldset>
  );
}

export function FxEditor({scope, onChange}: {scope: Scope; onChange: (fx: Fx | undefined) => void}) {
  const fx = scope.fx;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const target = fx?.currency ?? (scope.currency === 'INR' ? 'USD' : 'INR');
  async function fetchRate(currency: string) {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/fx?from=${scope.currency}&to=${currency}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Rate unavailable.');
      onChange({currency, rate: d.rate, as_of: d.as_of, source: d.source});
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const set = (patch: Partial<Fx>) => onChange({currency: target, rate: fx?.rate ?? NaN, as_of: fx?.as_of ?? new Date().toISOString().slice(0, 10), source: fx?.source ?? 'Agreed rate', ...patch});
  return (
    <fieldset className="items">
      <legend>Second currency <span className="quiet">· the rate is fixed when the client signs</span></legend>
      {!fx ? (
        <div className="actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => fetchRate(target)}>{busy ? 'Fetching…' : `Show amounts in ${target} at today’s rate`}</button>
          <button type="button" className="secondary" onClick={() => set({})}>Enter a rate myself</button>
        </div>
      ) : (
        <>
          <div className="input-row fx-row">
            <select aria-label="Second currency" value={fx.currency} onChange={e => set({currency: e.target.value})}>{currencyList.filter(c => c.code !== scope.currency).map(c => <option key={c.code} value={c.code}>{c.code}</option>)}</select>
            <input aria-label={`${fx.currency} per ${scope.currency}`} type="number" min={0} step="any" inputMode="decimal" value={Number.isFinite(fx.rate) ? fx.rate : ''} onChange={e => set({rate: num(e.target.value)})} />
            <input aria-label="Rate date" type="date" value={fx.as_of} onChange={e => set({as_of: e.target.value})} />
            <input aria-label="Rate source" maxLength={80} value={fx.source} onChange={e => set({source: e.target.value})} />
            <button type="button" className="icon" aria-label="Remove second currency" onClick={() => onChange(undefined)}><X size={15} /></button>
          </div>
          <p className="fine">{fx.currency} per 1 {scope.currency}. <button type="button" className="help-link" disabled={busy} onClick={() => fetchRate(fx.currency)}>{busy ? 'Fetching…' : 'Use today’s reference rate'}</button></p>
        </>
      )}
      {error && <span className="error-text" role="alert">{error}</span>}
    </fieldset>
  );
}

export function RevisionBankEditor({scope, onChange}: {scope: Scope; onChange: (b: RevisionBank | undefined) => void}) {
  const b = scope.revision_bank;
  const set = (patch: Partial<RevisionBank>) => {
    const next = {unit: b?.unit ?? 'hours', amount: b?.amount ?? 5, ...(b?.overage_rate !== undefined ? {overage_rate: b.overage_rate} : {}), ...patch} as RevisionBank;
    if (next.unit === 'money' || next.overage_rate === undefined || Number.isNaN(next.overage_rate)) delete next.overage_rate;
    onChange(next);
  };
  return (
    <fieldset className="items">
      <legend>Revision bank <span className="quiet">· optional: hours or a budget that feedback rounds draw on</span></legend>
      {!b ? <button type="button" className="secondary" onClick={() => set({})}><Plus size={16} />Add a revision bank</button> : (
        <div className={`input-row bank-row${b.unit === 'money' ? ' bank-money' : ''}`}>
          <select aria-label="Revision bank unit" value={b.unit} onChange={e => set({unit: e.target.value as RevisionBank['unit']})}><option value="hours">Hours</option><option value="money">Budget ({scope.currency})</option></select>
          <input aria-label={b.unit === 'hours' ? 'Hours included' : 'Budget included'} type="number" min={0} step={b.unit === 'hours' ? '0.25' : '0.01'} value={Number.isFinite(b.amount) ? b.amount : ''} onChange={e => set({amount: num(e.target.value)})} />
          {b.unit === 'hours' && <input aria-label={`Overage rate per hour (${scope.currency})`} placeholder="Overage rate / hour" type="number" min={0} step="0.01" value={b.overage_rate ?? ''} onChange={e => set({overage_rate: e.target.value === '' ? undefined : num(e.target.value)})} />}
          <button type="button" className="icon" aria-label="Remove revision bank" onClick={() => onChange(undefined)}><X size={15} /></button>
        </div>
      )}
    </fieldset>
  );
}
