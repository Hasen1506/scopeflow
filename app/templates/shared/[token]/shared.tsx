'use client';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import {useRouter} from 'next/navigation';
import {Header, Paper, Skeleton, api, post} from '@/app/ui';
import type {Scope} from '@/lib/scope';

/** A template someone shared by link: preview it and add a copy to your own library. */
export default function SharedTemplate({token}: {token: string}) {
  const router = useRouter();
  const [t, setT] = useState<{name: string; content: Scope; tags: string[]; revision: number} | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => { api(`/api/templates/shared/${token}`).then(d => setT(d.template), e => setError(e.message)); api('/api/me').then(d => setSignedIn(!!d.signedIn), () => setSignedIn(false)); }, [token]);
  async function add() { setBusy(true); setError(''); try { await api(`/api/templates/shared/${token}`, post({})); router.push('/templates'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <><Header /><main id="content" tabIndex={-1} className="shell" aria-busy={!t && !error}>
    <div className="page-heading"><div><p className="eyebrow">SHARED TEMPLATE</p><h1>{t?.name ?? 'Template'}</h1>{t && <p className="quiet">Revision {t.revision}{t.tags.length ? ` · ${t.tags.join(', ')}` : ''}</p>}</div></div>
    {error && <p className="error" role="alert">{error}</p>}
    {!t && !error && <div className="paper"><Skeleton lines={6} label="Loading the template…" /></div>}
    {t && <><div className="actions section-gap">{signedIn ? <button className="primary" disabled={busy} onClick={add}>{busy ? 'Adding…' : 'Add to my templates'}</button> : <Link className="primary" href={`/auth/sign-in?return_to=${encodeURIComponent('/templates/shared/' + token)}`}>Sign in to add it</Link>}<Link className="secondary" href="/">Back to projects</Link></div><Paper scope={t.content} /></>}
  </main></>;
}
