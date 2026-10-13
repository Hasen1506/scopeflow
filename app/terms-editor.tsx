'use client';
import {useState} from 'react';
import {Plus, X} from 'lucide-react';
import {currencyList} from '@/lib/currency';
import {schedule, totals} from '@/lib/money';
import {formatMoney, newId, type Fx, type Milestone, type RevisionBank, type Scope} from '@/lib/scope';

// Editors for the optional Phase 3 terms: a payment schedule (milestones), a second currency at a
// rate fixed in the signed scope, and a revision bank (hours or budget). Each calls onChange with
// undefined to remove the term, so unset terms stay out of the signed content.

const num = (v: string) => (v === '' || Number.isNaN(Number(v)) ? NaN : Number(v));

export function MilestonesEditor({scope, onChange}: {scope: Scope; onChange: (m: Milestone[] | undefined) => void}) {
  const list = scope.milestones ?? [];
  const sum = Math.round(list.reduce((a, m) => a + (Number.isFinite(m.pct) ? m.pct : 0), 0) * 100) / 100;
  const total = totals({...scope, fee: Number.isFinite(scope.fee) ? scope.fee : 0}).total;
  const lines = schedule({milestones: list.map(m => ({...m, pct: Number.isFinite(m.pct) ? m.pct : 0}))}, total);
  const update = (i: number, patch: Partial<Milestone>) => onChange(list.map((m, j) => (j === i ? {...m, ...patch} : m)));
  const remove = (i: number) => { const next = list.filter((_, j) => j !== i); onChange(next.length ? next : undefined); };
  return (
    <fieldset className="items">
      <legend>Payment schedule <span className="quiet">· milestones as a share of the total; they must add up to 100%</span></legend>
      {list.map((m, i) => (
        <div className="input-row milestone-row" key={m.id}>
          <input aria-label={`Milestone ${i + 1}`} placeholder={i === 0 ? 'e.g. On signature' : 'e.g. On delivery'} maxLength={120} value={m.title} onChange={e => update(i, {title: e.target.value})} />
          <input aria-label={`Share for ${m.title || 'milestone ' + (i + 1)} (%)`} type="number" min={0} max={100} step="0.01" inputMode="decimal" value={Number.isFinite(m.pct) ? m.pct : ''} onChange={e => update(i, {pct: num(e.target.value)})} />
          <input aria-label={`Due date for ${m.title || 'milestone ' + (i + 1)}`} type="date" value={m.due} onChange={e => update(i, {due: e.target.value})} />
          <span className="fine">{formatMoney(lines[i]?.amount ?? 0, scope.currency)}</span>
          <button type="button" className="icon" aria-label={`Remove ${m.title || 'milestone'}`} onClick={() => remove(i)}><X size={15} /></button>
        </div>
      ))}
      <div className="items-foot">
        <button type="button" className="secondary" onClick={() => onChange([...list, {id: newId('m'), title: list.length ? '' : 'On signature', pct: Math.max(0, Math.round((100 - sum) * 100) / 100) || 50, due: ''}])}><Plus size={16} />Add milestone</button>
        {list.length > 0 && <span className={Math.abs(sum - 100) > 0.01 ? 'warn-text' : 'fine'} role="status">Adds up to {sum}%{Math.abs(sum - 100) > 0.01 ? ' (needs 100%)' : ''}{scope.deposit_pct ? ' · remove the deposit above: the first milestone replaces it' : ''}</span>}
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
