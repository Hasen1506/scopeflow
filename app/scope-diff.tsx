'use client';
import {semanticDiff, describeChange, type ScopeChange} from '@/lib/diff';
import type {Scope} from '@/lib/scope';

function badge(c: ScopeChange) {
  if (c.kind === 'item_added' || c.kind === 'input_added') return <span className="diff-badge diff-add">Added</span>;
  if (c.kind === 'item_removed' || c.kind === 'input_removed') return <span className="diff-badge diff-remove">Removed</span>;
  return <span className="diff-badge diff-change">Changed</span>;
}

/** Plain-language list of what changed between two versions of a scope. */
export function ScopeDiff({previous, current, title}: {previous: Scope; current: Scope; title: string}) {
  const changes = semanticDiff(previous, current);
  return (
    <section className="editor no-print" style={{marginBottom: 24}}>
      <h2>{title}</h2>
      {changes.length === 0 ? <p className="quiet section-gap">No content changes.</p> : (
        <ul className="diff-list">
          {changes.map((c, i) => {
            const longText = c.kind === 'field' && (c.field === 'exclusions' || c.field === 'notes');
            return (
              <li key={i}>
                {badge(c)}
                {longText && c.kind === 'field' ? (
                  <div><strong>{c.label}</strong><p className="line-list"><span className="quiet">Before: </span>{c.before || 'Not specified'}</p><p className="line-list"><span className="quiet">Now: </span>{c.after || 'Not specified'}</p></div>
                ) : <span>{describeChange(c, current.currency)}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
