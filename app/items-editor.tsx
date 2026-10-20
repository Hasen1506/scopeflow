'use client';
import {useRef, useState} from 'react';
import {ArrowDown, ArrowUp, Plus, X} from 'lucide-react';
import {formatMoney, newId, type ClientInput, type Item} from '@/lib/scope';
import {amountProblem, parseQty, QTY_MAX, toLineTotal, toPerUnit, withLinePrice, withUnitPrice} from '@/lib/editor';
import {itemsTotal, lineTotal} from '@/lib/money';
import {describedBy, errorId, moveFocusTarget, rowName} from '@/lib/a11y';

/** R6: the browser reports an overflowing number ("1e400") as bad input with an empty value; treat it as
 *  Infinity so amountProblem shows "Max …" instead of nothing. */
export const badNumber = (el: HTMLInputElement) => el.validity?.badInput === true;
const num = (value: string, fallback: number) => (value === '' || Number.isNaN(Number(value)) ? fallback : Number(value));

export function ItemsEditor({items, currency, onChange, errorRef}: {items: Item[]; currency: string; onChange: (items: Item[]) => void; errorRef?: string}) {
  const update = (index: number, patch: Partial<Item>) => onChange(items.map((x, i) => (i === index ? {...x, ...patch} : x)));
  const replace = (index: number, item: Item) => onChange(items.map((x, i) => (i === index ? item : x)));
  // R4-02: rows priced per unit. A row with a unit_price always is; an emptied unit-price field keeps its row here
  // so the field does not jump back to a line total while the owner retypes it.
  const [perUnit, setPerUnit] = useState<ReadonlySet<string>>(() => new Set(items.filter(i => i.unit_price != null).map(i => i.id)));
  const unitMode = (i: Item) => i.unit_price != null || perUnit.has(i.id);
  const setMode = (id: string, on: boolean) => setPerUnit(s => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const root = useRef<HTMLFieldSetElement>(null);
  const [moved, setMoved] = useState('');
  // UX-C44: after a move, focus stays on a move button of the moved row (the pressed one can become disabled at
  // the top or bottom), and the new position is announced.
  const move = (index: number, by: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    onChange(next);
    const to = index + by, target = moveFocusTarget(to, next.length, by < 0 ? 'up' : 'down');
    setMoved(`${item.title || 'Deliverable'} moved to position ${to + 1} of ${next.length}.`);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-move="${item.id}:${target}"]`)?.focus());
  };
  // A3: removing a row keeps keyboard focus in the list: on the next row's title, else the previous one, else "Add deliverable".
  const remove = (index: number) => {
    const next = items.filter((_, i) => i !== index);
    onChange(next);
    const target = next[index] ?? next[index - 1];
    requestAnimationFrame(() => (target ? root.current?.querySelector<HTMLElement>(`[data-item-title="${target.id}"]`) : root.current?.querySelector<HTMLElement>('[data-add-item]'))?.focus());
  };
  // R4-02: the same line totals as the client page and feeCheck (qty × unit_price when a unit price is set).
  const {total, priced: pricedCount, unpriced} = itemsTotal(items, currency);
  return (
    <fieldset ref={root} className="items deliverables" aria-describedby={errorRef}>
      <legend><span className="deliverables-title">Deliverables</span>{items.length > 0 && <span className="count-chip">{items.length} {items.length === 1 ? 'deliverable' : 'deliverables'}</span>}<span className="quiet deliverables-hint">Each one is tracked across versions and change orders.</span></legend>
      {items.length === 0 && <p className="fine">No deliverables yet. Add each thing you will hand over.</p>}
      {items.map((item, index) => (
        <div className="item-row" key={item.id}>
          <div className="item-main">
            <span className="item-num" aria-hidden="true">{index + 1}</span>
            <input data-item-title={item.id} aria-label={`Deliverable ${index + 1}`} placeholder="e.g. Homepage design" maxLength={200} value={item.title} onChange={e => update(index, {title: e.target.value})} />
            <div className="item-tools">
              <button type="button" className="icon" data-move={`${item.id}:up`} aria-label={`Move ${item.title || 'untitled item ' + (index + 1)} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
              <button type="button" className="icon" data-move={`${item.id}:down`} aria-label={`Move ${item.title || 'untitled item ' + (index + 1)} down`} disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
              <button type="button" className="icon" aria-label={`Remove ${rowName(items.map(x => x.title), index, 'untitled item')}`} onClick={() => remove(index)}><X size={15} /></button>
            </div>
          </div>
          <div className="item-meta">
            <label>Qty<QtyInput value={item.qty} onChange={qty => update(index, {qty})} /></label>
            <label>Unit<input maxLength={40} placeholder="pages, concepts…" value={item.unit} onChange={e => update(index, {unit: e.target.value})} /></label>
            <PriceField item={item} name={rowName(items.map(x => x.title), index, 'untitled item')} currency={currency} perUnit={unitMode(item)}
              onLine={price => replace(index, withLinePrice(item, price))} onUnit={unit => replace(index, withUnitPrice(item, unit))}
              onMode={on => { const next = on ? toPerUnit(item, currency) : toLineTotal(item, currency); if (!next) return; setMode(item.id, on); replace(index, next); }} />
          </div>
          <label className="item-accept">Done when<input maxLength={1000} placeholder="Acceptance criteria, e.g. approved in Figma, delivered as SVG" value={item.acceptance} onChange={e => update(index, {acceptance: e.target.value})} /></label>
        </div>
      ))}
      <div className="small-title">
        <button type="button" className="secondary" data-add-item="" onClick={() => onChange([...items, {id: newId(), title: '', qty: 1, unit: '', price: null, acceptance: ''}])}><Plus size={16} />Add deliverable</button>
        <span className="sr-only" role="status" aria-atomic="true">{moved}</span>
        {pricedCount > 0 && <span className="fine">Itemised total: {formatMoney(total, currency)}{unpriced ? ` (${unpriced} unpriced)` : ''}</span>}
      </div>
    </fieldset>
  );
}

/**
 * R4-02: one price field per row. A line total ("Price", for all of the qty) or, per unit, "Price each" with the
 * line total it makes shown under it (no "unit" in these names: the row's Unit field keeps its label to itself). The switch keeps the money the same; it is offered per unit only when the
 * line total divides exactly by the qty, so switching never changes what the client pays.
 */
function PriceField({item, name, currency, perUnit, onLine, onUnit, onMode}: {item: Item; name: string; currency: string; perUnit: boolean; onLine: (price: number | null) => void; onUnit: (unit: number | null) => void; onMode: (perUnit: boolean) => void}) {
  const value = perUnit ? item.unit_price : item.price, what = perUnit ? 'Price each' : 'Price';
  // R5-04: the field keeps exactly what was typed ("1e400" stays "1e400" with its inline error); the item gets the
  // parsed number, and nothing that renders it throws (computable / feeCheck / itemsTotal never throw).
  const [raw, setRaw] = useState(value == null ? '' : String(value)), [seen, setSeen] = useState(value);
  const parse = (r: string) => (r === '' ? null : num(r, 0));
  if (!Object.is(value, seen)) { setSeen(value); if (!Object.is(parse(raw), value ?? null)) setRaw(value == null ? '' : String(value)); }
  const problem = amountProblem(value, currency, what), id = errorId((perUnit ? 'unit_price-' : 'price-') + item.id), hint = errorId('price-mode-' + item.id);
  let line: number | null = null;
  try { line = lineTotal(item, currency); } catch { /* shown as a field problem on save */ }
  const canPerUnit = !perUnit && item.qty > 1 && toPerUnit(item, currency) != null;
  const note = perUnit ? (line != null ? `= ${formatMoney(line, currency)} for ${item.qty}` : `× ${item.qty}`) : item.qty > 1 ? `Total for all ${item.qty}` : '';
  return (
    <div className="price-cell">
      <label>{perUnit ? `Price each (${currency})` : `Price (${currency})`}
        <input type="number" min={0} step="0.01" placeholder="optional" value={raw} aria-invalid={!!problem} aria-describedby={describedBy(!!problem && id, !!note && hint)}
          onChange={e => { setRaw(e.target.value); const v = badNumber(e.target) ? Infinity : parse(e.target.value); setSeen(v); if (perUnit) onUnit(v); else onLine(v); }} />
      </label>
      {problem && <span id={id} className="error-text">{problem}</span>}
      {(note || perUnit || canPerUnit) && <span className="fine price-mode">
        {note && <span id={hint}>{note}</span>}
        {perUnit ? <button type="button" className="link-button" aria-label={`Enter a line total for ${name}`} onClick={() => onMode(false)}>Enter a line total</button>
          : canPerUnit ? <button type="button" className="link-button" aria-label={`Price ${name} each`} onClick={() => onMode(true)}>Price each</button> : null}
      </span>}
    </div>
  );
}

/** UX-C37: the field keeps what is typed, so clearing it to type a new number does not snap back to 1. The item
 *  keeps its last valid quantity while the field is empty; on blur an empty or invalid field shows that value again. */
function QtyInput({value, onChange}: {value: number; onChange: (qty: number) => void}) {
  const [raw, setRaw] = useState(String(value));
  const [seen, setSeen] = useState(value);
  // The item changed from outside (undo, template, AI draft): show the new quantity.
  if (value !== seen) { setSeen(value); if (parseQty(raw) !== value) setRaw(String(value)); }
  return <input type="number" min={1} max={QTY_MAX} step={1} inputMode="numeric" value={raw}
    onChange={e => { setRaw(e.target.value); const q = parseQty(e.target.value); if (q != null && q !== value) { setSeen(q); onChange(q); } }}
    onBlur={() => setRaw(String(parseQty(raw) ?? value))} />;
}

export function ClientInputsEditor({inputs, onChange}: {inputs: ClientInput[]; onChange: (inputs: ClientInput[]) => void}) {
  const update = (index: number, patch: Partial<ClientInput>) => onChange(inputs.map((x, i) => (i === index ? {...x, ...patch} : x)));
  return (
    <fieldset className="items">
      <legend>Client provides <span className="quiet">· late inputs move the delivery date on the record</span></legend>
      {inputs.map((input, index) => (
        <div className="input-row" key={input.id}>
          <input aria-label={`Client input ${index + 1}`} placeholder="e.g. Final copy for every page" maxLength={200} value={input.title} onChange={e => update(index, {title: e.target.value})} />
          <input aria-label={`Due date for ${rowName(inputs.map(x => x.title), index, 'untitled client input')}`} type="date" value={input.due} onChange={e => update(index, {due: e.target.value})} />
          <button type="button" className="icon" aria-label={`Remove ${rowName(inputs.map(x => x.title), index, 'untitled client input')}`} onClick={() => onChange(inputs.filter((_, i) => i !== index))}><X size={15} /></button>
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => onChange([...inputs, {id: newId('c'), title: '', due: ''}])}><Plus size={16} />Add client input</button>
    </fieldset>
  );
}
