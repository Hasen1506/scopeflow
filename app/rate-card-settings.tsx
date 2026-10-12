'use client';
// Rate card settings (SF-06, owner: WS-05; mounted by WS-08 in Account). Items are priced in the
// currency's major unit here and stored as integer minor units.
import {useEffect, useState} from 'react';
import {Plus, Trash2} from 'lucide-react';
import type {Multiplier, RateCard, RateItem} from '@/lib/rate-card-core';
import {currencies} from '@/lib/scope';
import {fromMinor, toMinor} from '@/lib/minor';
import {api} from './ui';
import styles from './components/ws-05/ws-05.module.css';

type Row = Omit<RateItem, 'unit_price_minor' | 'tags'> & {price: string; tags: string};
const toRow = (i: RateItem): Row => ({id: i.id, title: i.title, unit: i.unit, currency: i.currency, tax_pct: i.tax_pct, price: String(fromMinor(i.unit_price_minor, i.currency)), tags: i.tags.join(', ')});

export function RateCardSettings({defaultCurrency = 'INR'}: {defaultCurrency?: string}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [mult, setMult] = useState<Multiplier[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; api('/api/rate-card').then((r: {rate_card: RateCard}) => { if (live) { setRows(r.rate_card.items.map(toRow)); setMult(r.rate_card.multipliers); } }, e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, []);
  if (!rows) return error ? <p className="error" role="alert">{error}</p> : null;
  const set = (n: number, patch: Partial<Row>) => setRows(rs => rs!.map((r, i) => i === n ? {...r, ...patch} : r));
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try {
      const card: RateCard = {items: rows!.map(r => ({id: r.id, title: r.title, unit: r.unit, currency: r.currency, tax_pct: Number(r.tax_pct) || 0, unit_price_minor: toMinor(Number(r.price) || 0, r.currency), tags: r.tags.split(',').map(t => t.trim()).filter(Boolean)})), multipliers: mult.map(m => ({...m, pct: Number(m.pct) || 0}))};
      const r = await api('/api/rate-card', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(card)});
      setRows(r.rate_card.items.map(toRow)); setMult(r.rate_card.multipliers); setNotice('Rate card saved.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className={styles.card + ' rate-card-settings'} aria-label="Rate card">
      <h3>Rate card</h3>
      <p className="fine">Prices for work you sell often. Change orders, the radar and retainer overage use them. Tag an item <code>item:&lt;deliverable id&gt;</code> to price overage on a retainer quota.</p>
      {rows.map((r, n) => (
        <div key={n} className={styles.row} aria-label={`Rate card item ${n + 1}`}>
          <label>Id<input value={r.id} maxLength={40} onChange={e => set(n, {id: e.target.value})} /></label>
          <label>Title<input value={r.title} maxLength={160} onChange={e => set(n, {title: e.target.value})} /></label>
          <label>Unit<input value={r.unit} maxLength={40} onChange={e => set(n, {unit: e.target.value})} /></label>
          <label>Price<input type="number" min={0} step="0.01" value={r.price} onChange={e => set(n, {price: e.target.value})} /></label>
          <label>Currency<select value={r.currency} onChange={e => set(n, {currency: e.target.value})}>{currencies.map(c => <option key={c}>{c}</option>)}</select></label>
          <label>Tax %<input type="number" min={0} max={100} step="0.01" value={r.tax_pct} onChange={e => set(n, {tax_pct: Number(e.target.value)})} /></label>
          <label>Tags<input value={r.tags} onChange={e => set(n, {tags: e.target.value})} placeholder="video, item:posts" /></label>
          <button type="button" className="icon" aria-label={`Remove ${r.title || 'item'}`} onClick={() => setRows(rs => rs!.filter((_, i) => i !== n))}><Trash2 size={14} /></button>
        </div>
      ))}
      <div className="actions"><button type="button" className="secondary" onClick={() => setRows(rs => [...rs!, {id: 'rc_' + crypto.randomUUID().slice(0, 6), title: '', unit: '', currency: defaultCurrency, tax_pct: 18, price: '0', tags: ''}])}><Plus size={14} />Add item</button></div>
      <h4>Multipliers</h4>
      {mult.map((m, n) => (
        <div key={n} className={styles.row}>
          <label>Label<input value={m.label} onChange={e => setMult(ms => ms.map((x, i) => i === n ? {...x, label: e.target.value} : x))} /></label>
          <label>Change %<input type="number" step="0.01" value={m.pct} onChange={e => setMult(ms => ms.map((x, i) => i === n ? {...x, pct: Number(e.target.value)} : x))} /></label>
          <button type="button" className="icon" aria-label={`Remove ${m.label}`} onClick={() => setMult(ms => ms.filter((_, i) => i !== n))}><Trash2 size={14} /></button>
        </div>
      ))}
      <div className="actions"><button type="button" className="secondary" onClick={() => setMult(ms => [...ms, {id: 'm_' + crypto.randomUUID().slice(0, 6), label: 'Weekend', pct: 50}])}><Plus size={14} />Add multiplier</button><button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save rate card'}</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="muted-box" role="status">{notice}</p>}
    </section>
  );
}
export default RateCardSettings;
