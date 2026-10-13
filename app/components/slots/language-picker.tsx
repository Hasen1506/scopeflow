'use client';
// Slot: LanguagePicker. Owner: WS-07 (implements it). Mounted by: WS-07 (client page).
// Interface language for the client page (en/hi/ta chrome). SF-09: only the page chrome changes;
// the scope the client approves is always shown exactly as written.
import {LANGS, LANG_NAMES, isLang, translator, type Lang} from '@/lib/i18n';
import styles from '@/app/review/[token]/client.module.css';

export type LanguagePickerProps = {
  value: Lang;
  onChange: (lang: Lang) => void;
  /** Overrides the select's id (several pickers on one page). */
  id?: string;
};

export default function LanguagePicker({value, onChange, id = 'client-language'}: LanguagePickerProps) {
  const t = translator(value);
  return (
    <span className={styles.picker}>
      <label htmlFor={id}>{t('lang.label')}{value !== 'en' ? ' · Language' : ''}</label>
      <select id={id} value={value} onChange={e => { if (isLang(e.target.value)) onChange(e.target.value); }}>
        {LANGS.map(l => <option key={l} value={l} lang={l}>{LANG_NAMES[l]}</option>)}
      </select>
    </span>
  );
}
