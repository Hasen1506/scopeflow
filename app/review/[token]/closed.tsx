'use client';
import type {Translate} from '@/lib/i18n';
import {formatInZone} from '@/lib/time';
import styles from './client.module.css';
import type {ReadonlyInfo} from './states';
export {readonlyOf, type ReadonlyInfo, type ReadonlyReason} from './states';

// Read-only and closed states of a client link (H4 UI, H10 UI; owner: WS-07). The review API
// (WS-02 for revoke/rotate, WS-08 for account closure) marks such a link with
//   readonly: true, readonly_reason: 'revoked' | 'rotated' | 'account_closed', kept_until?: ISO date
// (`account_closed: true` is accepted as the same thing). The page then shows the record, the
// receipt, statement and invoice downloads, and no action that would write anything.

export function ClosedBanner({info, t, timeZone}: {info: ReadonlyInfo; t: Translate; timeZone: string}) {
  if (!info.readonly) return null;
  const account = info.reason === 'account_closed';
  return (
    <section className={styles.banner + ' no-print'} role="status" aria-labelledby="closed-title" data-testid="readonly-banner">
      <h2 id="closed-title">{t(account ? 'closed.account.title' : 'closed.revoked.title')}</h2>
      <p>{t(account ? 'closed.account.body' : 'closed.revoked.body')}</p>
      {account && info.keptUntil && <p>{t('closed.account.until', {date: formatInZone(info.keptUntil, timeZone)})}</p>}
    </section>
  );
}

/** L12: a newer version was shared after this one; the typed comment is kept on the device. */
export function NewerBanner({version, url, t, hasDraft}: {version: number; url: string | null; t: Translate; hasDraft: boolean}) {
  return (
    <section className={styles.banner + ' ' + styles.bannerWarn + ' no-print'} role="status" aria-labelledby="newer-title" data-testid="newer-banner">
      <h2 id="newer-title">{t('newer.title')}</h2>
      <p>{t('newer.body', {version})}</p>
      <p>{url ? <a className="primary" href={url}>{t('newer.open', {version})}</a> : t('newer.ask')}</p>
      {hasDraft && <p className="fine">{t('newer.kept')}</p>}
    </section>
  );
}
