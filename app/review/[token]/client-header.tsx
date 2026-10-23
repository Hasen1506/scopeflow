'use client';
import {Brand} from '@/app/ui';
import LanguagePicker from '@/app/components/slots/language-picker';
import type {Lang} from '@/lib/i18n';
import styles from './client.module.css';

// The client never sees the creator's navigation (Projects, Account, Sign out) or a beta badge (LT-13):
// the brand, and the interface language picker (SF-09).
// The site footer drops its beta label and owner links on client routes (app/site-footer.tsx).

export function ClientHeader({lang, onLang}: {lang: Lang; onLang: (lang: Lang) => void}) {
  return (
    <header className={'topbar ' + styles.header}>
      <Brand beta={false} />
      <LanguagePicker value={lang} onChange={onLang} />
    </header>
  );
}
