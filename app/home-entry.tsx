'use client';
import dynamic from 'next/dynamic';
import {useState, useSyncExternalStore} from 'react';
import Landing from './landing';
import {Header, Skeleton} from './ui';
import {SESSION_HINT_KEY} from '@/lib/theme';

// The signed-in workspace (editor, ledger, payments) stays out of the landing bundle.
const Workspace = dynamic(() => import('./workspace/shell'), {
  loading: () => <main className="shell" id="content"><div className="boot-skeleton" aria-hidden="true"><Skeleton cards={2} lines={2} /></div></main>,
});

const subscribeHint = (cb: () => void) => {
  const onStorage = (e: StorageEvent) => { if (!e.key || e.key === SESSION_HINT_KEY) cb(); };
  window.addEventListener('storage', onStorage);
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, {attributes: true, attributeFilter: ['data-auth']});
  return () => { window.removeEventListener('storage', onStorage); obs.disconnect(); };
};
function authHinted() {
  try { return localStorage.getItem(SESSION_HINT_KEY) === '1' || document.documentElement.dataset.auth === 'in'; }
  catch { return false; }
}
function useAuthHint() { return useSyncExternalStore(subscribeHint, authHinted, () => false); }

/** Landing for a signed-out visit. The workspace chunk loads only after sign-in or "try the editor". */
export default function HomeEntry({rest}: {rest?: React.ReactNode}) {
  const hinted = useAuthHint();
  const [trying, setTrying] = useState(false);
  if (hinted || trying) return <Workspace initialTrying={trying && !hinted} />;
  return <>
    <Header />
    <main className="shell" id="content" tabIndex={-1}>
      {/* In the first HTML, shown before paint when the session hint is set, so the signed-in
          heading does not wait on the workspace chunk. Hidden for signed-out visits. */}
      <div className="page-heading compact hero-in">
        <div><p className="eyebrow">Your workspace</p><h1>Scopes &amp; <em>agreements</em></h1></div>
      </div>
      <div className="boot-skeleton" aria-hidden="true"><Skeleton cards={2} lines={2} /></div>
      <div className="boot-guard"><Landing onTry={() => setTrying(true)}>{rest}</Landing></div>
    </main>
  </>;
}
