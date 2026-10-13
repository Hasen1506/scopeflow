'use client';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import {Header, api} from '../../ui';
import {NextStep} from '../../workflow';
import {MODE_LABEL, featuresFor, type Feature, type Mode} from '@/lib/mode-core';
// SF-17: "All features". Every feature, in the order of the workspace's mode. A mode never
// removes anything from this list; it only changes what comes first.
export default function AllFeatures() {
  const [mode, setMode] = useState<Mode>('freelancer'), [features, setFeatures] = useState<Feature[]>(featuresFor('freelancer'));
  useEffect(() => { api('/api/workspace/mode').then(r => { setMode(r.mode); setFeatures(r.features); }, () => {/* signed out: the default order */}); }, []);
  return <><Header/><main id="content" tabIndex={-1} className="review-shell policy"><section className="editor">
    <p className="eyebrow">ACCOUNT · ALL FEATURES</p><h1>Everything ScopeFlow <em>does.</em></h1>
    <NextStep title={`${MODE_LABEL[mode]} mode`} actions={<Link className="secondary" href="/account#h-mode">Change mode</Link>}>Your mode puts the features you use most first. Every feature is listed here in every mode.</NextStep>
    <ol className="bullets section-gap" aria-label="All features" data-mode={mode}>
      {features.map(f => <li key={f.id} data-feature={f.id}><Link className="help-link" href={f.href}>{f.title}</Link> <span className="quiet">· {f.group} · {f.description}</span></li>)}
    </ol>
  </section></main></>;
}
