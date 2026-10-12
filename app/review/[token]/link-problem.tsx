'use client';
import Link from 'next/link';
import type {Translate} from '@/lib/i18n';
import {formatInZone} from '@/lib/time';
import styles from './client.module.css';
import {askSenderHref, type LinkProblemState} from './states';
export {problemOf, askSenderHref, type LinkProblemState, type ProblemKind, type Sender} from './states';

// LT-10: a link that does not open is not a dead end. Plain words, the one thing to do next (ask the
// sender for a new link), a way to the home page, and no reload loop: an unknown, replaced or
// withdrawn link never starts working by reloading it. Only a server or network failure offers
// "Try again".

export function LinkProblem({problem, t, timeZone = 'UTC', onRetry}: {problem: LinkProblemState; t: Translate; timeZone?: string; onRetry?: () => void}) {
  const {kind, expired, sender} = problem;
  const title = kind === 'expired' ? 'problem.expired.title' : kind === 'not_found' ? 'problem.notFound.title' : 'problem.unavailable.title';
  return (
    <section className={'editor ' + styles.problem} aria-labelledby="problem-title" data-testid="link-problem" data-kind={kind}>
      <h1 id="problem-title" tabIndex={-1}>{t(title)}</h1>
      {kind === 'not_found' && <p className="section-gap">{t('problem.notFound.body')}</p>}
      {kind === 'expired' && <p className="section-gap">{expired ? t('problem.expired.body', {date: formatInZone(expired, timeZone)}) : t('problem.expired.bodyNoDate')}</p>}
      {kind === 'unavailable' && <p className="section-gap">{t('problem.unavailable.body')}</p>}
      {kind !== 'unavailable' && <p className="section-gap"><strong>{t('problem.ask')}</strong></p>}
      <div className="actions section-gap">
        {kind === 'unavailable' && onRetry && <button className="primary" onClick={onRetry}>{t('problem.retry')}</button>}
        {kind !== 'unavailable' && <a className="primary" href={askSenderHref(t, sender)}>{sender?.name ? t('problem.askSenderNamed', {name: sender.name}) : t('problem.askSender')}</a>}
        <Link className="secondary" href="/">{t('problem.home')}</Link>
        <Link className="help-link" href="/verify">{t('problem.check')}</Link>
      </div>
    </section>
  );
}
