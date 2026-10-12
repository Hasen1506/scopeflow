'use client';
// Slot: DataNotice. Owner: WS-07 (implements it). Mounted by: WS-07 (client page).
// What the client page records about the reviewer, in plain language (M32, with WS-08's retention).
import Link from 'next/link';
import {translator, type Lang} from '@/lib/i18n';
import styles from '@/app/review/[token]/client.module.css';

export type DataNoticeProps = {
  lang?: Lang;
  /**
   * Days after which the reviewer's IP address and browser are redacted (WS-08 retention, served by
   * the review API as `retention_days`). Unknown or unset: the honest "kept while the project is" line.
   */
  retentionDays?: number | null;
};

export default function DataNotice({lang = 'en', retentionDays = null}: DataNoticeProps) {
  const t = translator(lang);
  const days = typeof retentionDays === 'number' && Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : null;
  return (
    <aside className={styles.notice} aria-labelledby="data-notice-title" data-testid="data-notice">
      <p><strong id="data-notice-title">{t('notice.title')}</strong></p>
      <p className="fine">{t('notice.body')} {days ? t('notice.days', {days}) : t('notice.noDays')} <Link className="help-link" href="/privacy#client-data">{t('notice.privacy')}</Link></p>
    </aside>
  );
}
