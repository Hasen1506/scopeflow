'use client';
// Slot: TdsField. Owner: WS-03 (implements it). Mounted by: WS-09 (workspace); used by app/invoice-panel.tsx.
// TDS section and rate for a project or invoice (H19, plan §9.4). Never defaulted: "No TDS" until the
// owner picks a section AND types a rate. The s.393 table (with the old 194J/194C labels) is shown for
// reference with the CA banner; picking a section does not fill the rate.
import {useId} from 'react';
import styles from '../ws03-slots.module.css';
import {TDS_BANNER, TDS_TABLE, type TdsSection} from '@/lib/tds';

export type TdsValue = {section_2025: TdsSection; legacy_label?: string | null; rate_pct: number; base?: 'taxable_value'} | null;
export type TdsFieldProps = {value: TdsValue; onChange: (v: TdsValue) => void; disabled?: boolean; label?: string};

export default function TdsField({value, onChange, disabled, label = 'TDS the client will deduct'}: TdsFieldProps) {
  const id = useId();
  const info = value ? TDS_TABLE.find(t => t.section === value.section_2025) : null;
  return (
    <div className={styles.box}>
      <div className={styles.row}>
        <label htmlFor={id + '-s'}>{label}
          <select id={id + '-s'} disabled={disabled} value={value?.section_2025 ?? ''} onChange={e => onChange(e.target.value ? {section_2025: e.target.value as TdsSection, rate_pct: value?.rate_pct ?? 0, base: 'taxable_value'} : null)}>
            <option value="">No TDS</option>
            {TDS_TABLE.map(t => <option key={t.section} value={t.section}>{t.section === 'other' ? 'Another section' : `s.${t.section.replace(/-.*/, '')} ${t.title}${t.legacy ? ` (old ${t.legacy})` : ''}`}</option>)}
          </select>
        </label>
        {value && <label htmlFor={id + '-r'}>Rate (%)
          <input id={id + '-r'} type="number" min={0.01} max={30} step="0.01" inputMode="decimal" required disabled={disabled} placeholder={info?.statutory_rate ? `e.g. ${info.statutory_rate}` : ''} value={value.rate_pct || ''} onChange={e => onChange({...value, rate_pct: Number(e.target.value) || 0})} />
        </label>}
      </div>
      {value && info && <p className="fine">{info.title}: {info.example}.{info.statutory_rate !== null ? ` The table rate is ${info.statutory_rate}%` : ''}{info.threshold ? ` above ${info.threshold}` : ''}. TDS is worked out on the taxable value (GST excluded).</p>}
      <details><summary className="fine">TDS sections (Income-tax Act 2025, s.393)</summary>
        <table className={styles.table}><thead><tr><th>Section</th><th>Old</th><th>For</th><th>Rate</th></tr></thead>
          <tbody>{TDS_TABLE.filter(t => t.section !== 'other').map(t => <tr key={t.section}><td>{t.section}</td><td>{t.legacy}</td><td>{t.title} ({t.example})</td><td>{t.statutory_rate}%</td></tr>)}</tbody></table>
      </details>
      <p className={styles.banner} role="note">{TDS_BANNER}</p>
    </div>
  );
}
