'use client';
// Retainer panel (SF-05, owner: WS-05; mounted by WS-09 in the Changes step and by the ledger panel).
// Live quota counters for the current month, a usage log that proposes an overage change order when
// a quota is exceeded, period close, and the monthly statement data.
import {useCallback, useEffect, useRef, useState} from 'react';
import RetainerCounter from './components/slots/retainer-counter';
import type {RetainerStatement, RetainerView} from '@/lib/retainer';
import type {Retainer} from '@/lib/scope';
import {formatMoney} from '@/lib/scope';
import {fromMinor} from '@/lib/minor';
import {api, post} from './ui';
import {useConfirm} from './a11y';
import styles from './components/ws-05/ws-05.module.css';

type PeriodsView = {baseline_version: number; currency: string; retainer: RetainerView; terms: Retainer; statement?: RetainerStatement};
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function RetainerPanel({projectId, items, onChanged}: {projectId: string; items: {id: string; title: string}[]; onChanged?: () => void}) {
  const [view, setView] = useState<PeriodsView | null>(null);
  const [confirm, confirmDialog] = useConfirm(); // UX-C41: closing a period is confirmed in-app
  const [statement, setStatement] = useState<RetainerStatement | null>(null);
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('1');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string>(crypto.randomUUID());
  const load = useCallback(async () => {
    try { setView(await api(`/api/scopes/${projectId}/periods`)); } catch (e) { setError((e as Error).message); }
  }, [projectId]);
  useEffect(() => { let live = true; api(`/api/scopes/${projectId}/periods`).then(v => { if (live) setView(v); }, e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, [projectId]);
  if (!view) return error ? <p className="error" role="alert">{error}</p> : null;
  const quotaItems = view.terms.quotas.map(q => ({id: q.item_id, title: items.find(i => i.id === q.item_id)?.title ?? q.item_id}));
  const current = view.retainer.periods.find(p => p.period === view.retainer.current);
  async function act(body: Record<string, unknown>, done: (r: {overage: {qty: number; priced: string} | null; entries: {seq: number; kind: string}[]}) => string) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await api(`/api/scopes/${projectId}/periods`, post({baseline_version: view!.baseline_version, ...body}));
      setNotice(done(r)); requestId.current = crypto.randomUUID();
      await load(); onChanged?.();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const m = (n: number) => formatMoney(fromMinor(n, view.currency), view.currency);
  return (
    <section className={styles.card + ' retainer-panel'} aria-label="Retainer">
      <h3>Retainer</h3>
      <RetainerCounter retainer={view.retainer} />
      <form className="ledger-form" aria-label="Log retainer usage" onSubmit={e => { e.preventDefault(); void act({action: 'usage', item_id: itemId || quotaItems[0]?.id, qty: Number(qty) || 0, date, note, request_id: requestId.current}, r => {
        const co = r.entries.find(x => x.kind === 'change_order');
        return co ? `Logged. ${r.overage?.qty} over quota: CO-${co.seq} proposed for the client${r.overage?.priced === 'unpriced' ? ' (no rate-card price found; set the fee before the client decides)' : ''}.` : 'Usage logged.';
      }); }}>
        <div className={styles.row}>
          <label>Item<select value={itemId || quotaItems[0]?.id} onChange={e => setItemId(e.target.value)}>{quotaItems.map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label>
          <label>Quantity<input type="number" min={0.25} step="0.25" required value={qty} onChange={e => setQty(e.target.value)} /></label>
          <label>Date<input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label>
          <label>Note <span className="quiet">· optional</span><input maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
          <button type="submit" className="primary" disabled={busy}>Log usage</button>
        </div>
      </form>
      {current && !current.closed_seq && <div className="actions"><button className="secondary" disabled={busy} onClick={async () => { if (await confirm({title: `Close ${current.period}?`, consequence: 'Usage can no longer be logged against it.', confirmLabel: `Close ${current.period}`, cancelLabel: 'Keep it open'})) void act({action: 'close', period: current.period}, () => `${current.period} closed.`); }}>Close {current.period}</button></div>}
      {view.retainer.periods.length > 0 && <div className="actions">{view.retainer.periods.map(p => <button key={p.period} className="link-button" onClick={() => api(`/api/scopes/${projectId}/periods?period=${p.period}`).then(r => setStatement(r.statement), e => setError((e as Error).message))}>Statement {p.period}</button>)}</div>}
      {statement && (
        <table className={styles.table} aria-label={`Retainer statement ${statement.period}`}>
          <thead><tr><th>Item</th><th className="num">Quota</th><th className="num">Carried</th><th className="num">Used</th><th className="num">Over</th></tr></thead>
          <tbody>
            {statement.lines.map(l => <tr key={l.item_id}><td>{l.title}</td><td className="num">{l.quota}</td><td className="num">{l.carried}</td><td className="num">{l.used}</td><td className="num">{l.over}</td></tr>)}
            <tr><td colSpan={4}>Retainer fee</td><td className="num">{m(statement.retainer_fee_minor)}</td></tr>
            {statement.overage.map(o => <tr key={o.seq}><td colSpan={4}>CO-{o.seq} {o.title} ({o.status})</td><td className="num">{m(o.fee_delta_minor)}</td></tr>)}
            {statement.tax.pct > 0 && <tr><td colSpan={4}>{statement.tax.label} {statement.tax.pct}%</td><td className="num">{m(statement.tax.amount_minor)}</td></tr>}
            <tr><td colSpan={4}><strong>Total</strong></td><td className="num"><strong>{m(statement.total_incl_tax_minor)}</strong></td></tr>
          </tbody>
        </table>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="muted-box" role="status">{notice}</p>}
      {confirmDialog}
    </section>
  );
}
export default RetainerPanel;
