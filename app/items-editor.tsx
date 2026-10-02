'use client';
import {ArrowDown, ArrowUp, Plus, X} from 'lucide-react';
import {newId, type ClientInput, type Item} from '@/lib/scope';

const num = (value: string, fallback: number) => (value === '' || Number.isNaN(Number(value)) ? fallback : Number(value));

export function ItemsEditor({items, currency, onChange}: {items: Item[]; currency: string; onChange: (items: Item[]) => void}) {
  const update = (index: number, patch: Partial<Item>) => onChange(items.map((x, i) => (i === index ? {...x, ...patch} : x)));
  const move = (index: number, by: number) => {
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved);
    onChange(next);
  };
  const priced = items.filter(i => i.price != null);
  const total = priced.reduce((sum, i) => sum + (i.price ?? 0), 0);
  return (
    <fieldset className="items">
      <legend>Deliverables <span className="quiet">· each one is tracked across versions and change orders</span></legend>
      {items.length === 0 && <p className="fine">No deliverables yet. Add each thing you will hand over.</p>}
      {items.map((item, index) => (
        <div className="item-row" key={item.id}>
          <div className="item-main">
            <input aria-label={`Deliverable ${index + 1}`} placeholder="e.g. Homepage design" maxLength={200} value={item.title} onChange={e => update(index, {title: e.target.value})} />
            <div className="item-tools">
              <button type="button" className="icon" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
              <button type="button" className="icon" aria-label="Move down" disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
              <button type="button" className="icon" aria-label={`Remove ${item.title || 'deliverable'}`} onClick={() => onChange(items.filter((_, i) => i !== index))}><X size={15} /></button>
            </div>
          </div>
          <div className="item-meta">
            <label>Qty<input type="number" min={1} max={10000} value={item.qty} onChange={e => update(index, {qty: Math.max(1, Math.round(num(e.target.value, 1)))})} /></label>
            <label>Unit<input maxLength={40} placeholder="pages, concepts…" value={item.unit} onChange={e => update(index, {unit: e.target.value})} /></label>
            <label>Price ({currency})<input type="number" min={0} step="0.01" placeholder="optional" value={item.price ?? ''} onChange={e => update(index, {price: e.target.value === '' ? null : Math.max(0, num(e.target.value, 0))})} /></label>
          </div>
          <label className="item-accept">Done when<input maxLength={1000} placeholder="Acceptance criteria, e.g. approved in Figma, delivered as SVG" value={item.acceptance} onChange={e => update(index, {acceptance: e.target.value})} /></label>
        </div>
      ))}
      <div className="small-title">
        <button type="button" className="secondary" onClick={() => onChange([...items, {id: newId(), title: '', qty: 1, unit: '', price: null, acceptance: ''}])}><Plus size={16} />Add deliverable</button>
        {priced.length > 0 && <span className="fine">Itemised total: {new Intl.NumberFormat('en-US', {style: 'currency', currency}).format(total)}{priced.length < items.length ? ` (${items.length - priced.length} unpriced)` : ''}</span>}
      </div>
    </fieldset>
  );
}

export function ClientInputsEditor({inputs, onChange}: {inputs: ClientInput[]; onChange: (inputs: ClientInput[]) => void}) {
  const update = (index: number, patch: Partial<ClientInput>) => onChange(inputs.map((x, i) => (i === index ? {...x, ...patch} : x)));
  return (
    <fieldset className="items">
      <legend>Client provides <span className="quiet">· late inputs move the delivery date on the record</span></legend>
      {inputs.map((input, index) => (
        <div className="input-row" key={input.id}>
          <input aria-label={`Client input ${index + 1}`} placeholder="e.g. Final copy for every page" maxLength={200} value={input.title} onChange={e => update(index, {title: e.target.value})} />
          <input aria-label={`Due date for ${input.title || 'client input'}`} type="date" value={input.due} onChange={e => update(index, {due: e.target.value})} />
          <button type="button" className="icon" aria-label={`Remove ${input.title || 'client input'}`} onClick={() => onChange(inputs.filter((_, i) => i !== index))}><X size={15} /></button>
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => onChange([...inputs, {id: newId('c'), title: '', due: ''}])}><Plus size={16} />Add client input</button>
    </fieldset>
  );
}
