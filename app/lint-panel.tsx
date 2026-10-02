'use client';
import {useMemo, useState} from 'react';
import {AlertTriangle, Info, OctagonAlert, ShieldCheck} from 'lucide-react';
import {lintScope} from '@/lib/lint';
import type {Scope} from '@/lib/scope';

const icons = {error: OctagonAlert, warn: AlertTriangle, info: Info};

/** Live clarity check for the draft. Advisory only: it never blocks saving. */
export function LintPanel({scope}: {scope: Scope}) {
  const [open, setOpen] = useState(false);
  const result = useMemo(() => lintScope(scope), [scope]);
  const serious = result.issues.filter(i => i.severity !== 'info').length;
  const shown = open ? result.issues : result.issues.filter(i => i.severity !== 'info').slice(0, 4);
  return (
    <section className={'lint grade-' + result.grade.replace(' ', '-')} aria-live="polite">
      <div className="small-title">
        <strong><ShieldCheck size={16} /> Clarity {result.score}/100 · {result.grade}</strong>
        {result.issues.length > 0 && <button type="button" className="link-button" onClick={() => setOpen(x => !x)}>{open ? 'Show fewer' : `Show all ${result.issues.length}`}</button>}
      </div>
      {result.issues.length === 0 && <p className="fine">No ambiguity found. Both sides should read this the same way.</p>}
      {result.issues.length > 0 && !open && serious === 0 && <p className="fine">Only suggestions left. Open the list to see them.</p>}
      <ul>
        {shown.map((issue, n) => {
          const Icon = icons[issue.severity];
          return <li key={issue.rule + n} className={'lint-' + issue.severity}><Icon size={15} /><span>{issue.message}{issue.fix && <span className="quiet"> {issue.fix}</span>}</span></li>;
        })}
      </ul>
    </section>
  );
}
