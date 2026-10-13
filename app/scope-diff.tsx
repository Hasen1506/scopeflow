'use client';
import {semanticDiff, describeChange, type ScopeChange} from '@/lib/diff';
import type {Scope} from '@/lib/scope';
import {tEn, type Translate} from '@/lib/i18n';

function badge(c: ScopeChange, t: Translate) {
  if (c.kind === 'item_added' || c.kind === 'input_added') return <span className="diff-badge diff-add">{t('diff.added')}</span>;
  if (c.kind === 'item_removed' || c.kind === 'input_removed') return <span className="diff-badge diff-remove">{t('diff.removed')}</span>;
  return <span className="diff-badge diff-change">{t('diff.changed')}</span>;
}

/**
 * Plain-language list of what changed between two versions of a scope. `t` translates the chrome
 * (badges, Before/Now) on the client page (SF-09); the workspace passes nothing and keeps English.
 * The changed values themselves are shown as written.
 */
export function ScopeDiff({previous, current, title, t = tEn}: {previous: Scope; current: Scope; title: string; t?: Translate}) {
  const changes = semanticDiff(previous, current);
  return (
    <section className="editor no-print" data-gap="bottom">
      <h2>{title}</h2>
      {changes.length === 0 ? <p className="quiet section-gap">{t('diff.none')}</p> : (
        <ul className="diff-list">
          {changes.map((c, i) => {
            const longText = c.kind === 'field' && (c.field === 'exclusions' || c.field === 'notes');
            return (
              <li key={i}>
                {badge(c, t)}
                {longText && c.kind === 'field' ? (
                  <div><strong>{c.label}</strong><p className="line-list"><span className="quiet">{t('diff.before')}</span>{c.before || t('diff.notSpecified')}</p><p className="line-list"><span className="quiet">{t('diff.now')}</span>{c.after || t('diff.notSpecified')}</p></div>
                ) : <span>{describeChange(c, current.currency)}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
