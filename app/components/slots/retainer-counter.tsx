'use client';
// Slot: RetainerCounter. Owner: WS-05 (implements it). Mounted by: WS-07 (client page), WS-09 (workspace).
// Retainer period usage against quotas: "11/12 posts used" per item for the current (or a given) period.
import type {RetainerView} from '@/lib/retainer';
import styles from '../ws-05/ws-05.module.css';

export type RetainerCounterProps = {retainer: RetainerView | null | undefined; period?: string; title?: string};

export default function RetainerCounter({retainer, period, title = 'This month'}: RetainerCounterProps) {
  if (!retainer) return null;
  const p = retainer.periods.find(x => x.period === (period ?? retainer.current));
  if (!p) return <p className="fine retainer-counter">No retainer period has started yet.</p>;
  return (
    <div className={styles.counter + ' retainer-counter'} aria-label={`Retainer usage ${p.period}`}>
      <p className={styles.eyebrow}>{title} · {p.period}{p.closed_seq ? ' · closed' : ''}</p>
      {p.lines.map(l => (
        <div key={l.item_id} className={styles.counterRow} data-item={l.item_id}>
          <span>{l.title}{l.carried > 0 ? <span className="quiet"> (incl. {l.carried} carried over)</span> : null}</span>
          <strong className={l.over > 0 ? styles.over : ''}>{l.used}/{l.allowance} {l.unit || 'used'}{l.unit ? ' used' : ''}</strong>
          <meter min={0} max={Math.max(1, l.allowance)} value={Math.min(l.used, Math.max(1, l.allowance))} />
          {l.over > 0 && <span className={styles.over}>{l.over} over quota{p.overage_cos.some(o => o.item_id === l.item_id) ? ` · ${p.overage_cos.filter(o => o.item_id === l.item_id).map(o => `CO-${o.seq} ${o.status}`).join(', ')}` : ''}</span>}
        </div>
      ))}
    </div>
  );
}
