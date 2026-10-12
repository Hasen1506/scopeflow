'use client';
import {Brand} from '@/app/ui';
import LanguagePicker from '@/app/components/slots/language-picker';
import type {Lang} from '@/lib/i18n';
import styles from './client.module.css';

// The client never sees the creator's navigation (Projects, Account, Sign out) or a beta badge (LT-13):
// the brand, and the interface language picker (SF-09).
// The site footer (WS-09) still prints "Early beta" in its legal line; until WS-09 drops it on
// client routes (change request in the WS-07 PR), it is hidden on this page only.
const HIDE_FOOTER_BETA = '.site-footer .footer-legal>span:first-child{display:none}';

export function ClientHeader({lang, onLang}: {lang: Lang; onLang: (lang: Lang) => void}) {
  return (
    <header className={'topbar ' + styles.header}>
      <style>{HIDE_FOOTER_BETA}</style>
      <Brand beta={false} />
      <LanguagePicker value={lang} onChange={onLang} />
    </header>
  );
}
