'use client';
// Slot: RateCardPicker. Owner: WS-05 (implements it). Mounted by: WS-09 (workspace).
// Pick priced items from the account rate card into a change order: choose an item, a quantity
// and multipliers (rush +25 %…); the server prices it (minor units, the agreement's tax) and returns
// a change-order draft to prefill the form.
import {useEffect, useState} from 'react';
import type {ChangeOrder} from '@/lib/ledger';
import type {PricedLine, RateCard} from '@/lib/rate-card-core';
import {formatMoney} from '@/lib/scope';
import {fromMinor} from '@/lib/minor';
import {api, post} from '@/app/ui';
import styles from '../ws-05/ws-05.module.css';

export type RateCardPickerProps = {
  currency: string;
  projectId?: string;
  onPick: (draft: ChangeOrder, line: PricedLine, taxLabel: string) => void;
};

export default function RateCardPicker({currency, projectId, onPick}: RateCardPickerProps) {
  const [card, setCard] = useState<RateCard | null>(null);
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('1');
  const [mult, setMult] = useState<string[]>([]);
  const [line, setLine] = useState<{line: PricedLine; tax_label: string} | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let live = true; api('/api/rate-card').then(r => { if (live) setCard(r.rate_card); }, e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, []);
  const items = (card?.items ?? []).filter(i => i.currency === currency);
  if (!card) return error ? <p className="error" role="alert">{error}</p> : null;
  if (!items.length) return <p className="fine rate-card-picker">No {currency} items on your rate card yet. Add them under Account → Rate card.</p>;
  async function use() {
    setError('');
    try {
      const r = await api('/api/rate-card/quote', post({item_id: itemId || items[0].id, qty: Number(qty) || 1, multipliers: mult, ...(projectId ? {project_id: projectId} : {})}));
      setLine({line: r.line, tax_label: r.tax_label});
      onPick(r.change_order, r.line, r.tax_label);
    } catch (e) { setError((e as Error).message); }
  }
  const m = (n: number) => formatMoney(fromMinor(n, currency), currency);
  return (
    <fieldset className={'items rate-card-picker'}><legend>From your rate card</legend>
      <div className={styles.row}>
        <label>Rate-card item<select value={itemId || items[0].id} onChange={e => setItemId(e.target.value)}>{items.map(i => <option key={i.id} value={i.id}>{i.title} · {m(i.unit_price_minor)}{i.unit ? ' / ' + i.unit : ''}</option>)}</select></label>
        <label>Quantity<input type="number" min={0.25} step="0.25" value={qty} onChange={e => setQty(e.target.value)} /></label>
        {card.multipliers.map(x => <label key={x.id} className="check-row"><input type="checkbox" checked={mult.includes(x.id)} onChange={e => setMult(v => e.target.checked ? [...v, x.id] : v.filter(y => y !== x.id))} />{x.label} ({x.pct > 0 ? '+' : ''}{x.pct}%)</label>)}
        <button type="button" className="secondary" onClick={() => void use()}>Use this price</button>
      </div>
      {line && <p className="fine">{line.line.title} × {line.line.qty}: {m(line.line.subtotal_minor)}{line.line.tax.pct > 0 ? ` + ${line.tax_label} ${m(line.line.tax.amount_minor)} = ${m(line.line.total_minor)}` : ''}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </fieldset>
  );
}
