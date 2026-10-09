'use client';
import Link from 'next/link';
import {useCallback, useEffect, useState} from 'react';
import {toast} from 'sonner';
import {Copy, History, Link2, Tag} from 'lucide-react';
import {Header, api, post} from '../ui';
import {formatMoney} from '@/lib/scope';
import type {TemplateView} from '@/lib/template-store';

type Revision = {revision: number; name: string; saved: string};

/** The owner's own templates: tags, revision history with restore, share links, and importing a shared one. */
export default function Templates() {
  const [list, setList] = useState<TemplateView[] | null>(null), [signedIn, setSignedIn] = useState<boolean | null>(null), [error, setError] = useState(''), [filter, setFilter] = useState('');
  const [history, setHistory] = useState<{id: string; revisions: Revision[]; current: Revision} | null>(null), [importLink, setImportLink] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(() => api('/api/templates').then(d => { setSignedIn(!!d.signed_in); setList((d.templates as TemplateView[]).filter(t => !t.builtin)); }, e => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const replace = (t: TemplateView) => setList(l => l && l.map(x => x.id === t.id ? t : x));
  async function run(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const saveTags = (t: TemplateView, text: string) => run(async () => { const tags = text.split(',').map(x => x.trim()).filter(Boolean); const r = await api(`/api/templates/${t.id}`, {...post({tags}), method: 'PUT'}); replace(r.template); toast.success('Tags saved.'); });
  const share = (t: TemplateView, on: boolean, rotate = false) => run(async () => { const r = await api(`/api/templates/${t.id}/share`, post({share: on, ...(rotate ? {rotate} : {})})); replace(r.template); toast.success(on ? (rotate ? 'New share link made; the old one stopped working.' : 'Share link ready.') : 'Sharing turned off.'); });
  const showHistory = (t: TemplateView) => run(async () => { const r = await api(`/api/templates/${t.id}/revisions`); setHistory({id: t.id, revisions: r.revisions, current: r.current}); });
  const restore = (id: string, revision: number) => run(async () => { const r = await api(`/api/templates/${id}/revisions`, post({revision})); replace(r.template); setHistory(null); toast.success(`Revision ${revision} restored as revision ${r.template.revision}.`); });
  const importShared = () => run(async () => { const token = importLink.trim().match(/([a-f0-9]{32})\/?$/)?.[1]; if (!token) throw new Error('Paste a Scopeflow template share link.'); const r = await api(`/api/templates/shared/${token}`, post({})); setList(l => [r.template, ...(l ?? [])]); setImportLink(''); toast.success(`Added “${r.template.name}” to your templates.`); });
  const tags = [...new Set((list ?? []).flatMap(t => t.tags))].sort();
  const shown = (list ?? []).filter(t => !filter || t.tags.includes(filter));
  return <><Header /><main id="main" className="shell">
    <div className="page-heading"><div><p className="eyebrow">ACCOUNT · TEMPLATES</p><h1>Your templates</h1></div></div>
    {signedIn === false && <p className="muted-box">Sign in to keep your own templates. <Link className="help-link" href="/auth/sign-in?return_to=%2Ftemplates">Sign in</Link></p>}
    {error && <p className="error" role="alert">{error}</p>}
    {signedIn && <section className="editor">
      <p className="quiet">Save a draft as a template from the workspace. Here you can tag templates, see and restore earlier revisions, and share a template with another Scopeflow user by link. A share link shows the template, never who made it or your clients.</p>
      {tags.length > 0 && <div className="actions section-gap" role="group" aria-label="Filter by tag"><button className={filter ? 'secondary' : 'primary'} onClick={() => setFilter('')} aria-pressed={!filter}>All</button>{tags.map(t => <button key={t} className={filter === t ? 'primary' : 'secondary'} aria-pressed={filter === t} onClick={() => setFilter(t)}><Tag size={13} aria-hidden="true" />{t}</button>)}</div>}
      {list && !list.length && <p className="fine section-gap">You have no templates yet. In the workspace, use <strong>Save as template</strong> on a draft.</p>}
      <ul className="receipt-list template-admin">{shown.map(t => <li key={t.id}>
        <div><strong>{t.name}</strong> <span className="quiet">· revision {t.revision}{t.content.fee ? ` · ${formatMoney(t.content.fee, t.content.currency)}` : ''}{t.origin ? ` · ${t.origin}` : ''}</span></div>
        <form className="tag-row" onSubmit={e => { e.preventDefault(); void saveTags(t, String(new FormData(e.currentTarget).get('tags') ?? '')); }}><label>Tags <span className="quiet">· comma separated</span><input name="tags" defaultValue={t.tags.join(', ')} maxLength={220} placeholder="branding, retainer" /></label><button className="secondary" disabled={busy}>Save tags</button></form>
        {t.share_path
          ? <p className="fine"><Link2 size={13} aria-hidden="true" /> Shared: <span className="mono">{typeof location !== 'undefined' ? location.origin : ''}{t.share_path}</span> <button className="help-link" onClick={() => { void navigator.clipboard.writeText(location.origin + t.share_path); toast.success('Share link copied.'); }}><Copy size={13} aria-hidden="true" />Copy</button> · <button className="help-link" disabled={busy} onClick={() => void share(t, true, true)}>New link</button> · <button className="help-link" disabled={busy} onClick={() => void share(t, false)}>Stop sharing</button></p>
          : <div className="actions"><button className="secondary" disabled={busy} onClick={() => void share(t, true)}><Link2 size={14} aria-hidden="true" />Share by link</button><button className="secondary" disabled={busy} onClick={() => void showHistory(t)}><History size={14} aria-hidden="true" />History</button></div>}
        {t.share_path && <div className="actions"><button className="secondary" disabled={busy} onClick={() => void showHistory(t)}><History size={14} aria-hidden="true" />History</button></div>}
        {history?.id === t.id && <div className="muted-box" role="region" aria-label={`Revisions of ${t.name}`}>{history.revisions.length ? <ul>{history.revisions.map(r => <li key={r.revision}>Revision {r.revision} · “{r.name}” · saved {new Date(r.saved).toLocaleString()} <button className="help-link" disabled={busy} onClick={() => void restore(t.id, r.revision)}>Restore</button></li>)}</ul> : <p className="fine">No earlier revisions yet. Each time you update the template from a draft, the previous version is kept here (up to 20).</p>}<button className="help-link" onClick={() => setHistory(null)}>Close</button></div>}
      </li>)}</ul>
      <div className="section-gap"><h2>Add a shared template</h2><form className="tag-row" onSubmit={e => { e.preventDefault(); void importShared(); }}><label>Share link<input value={importLink} onChange={e => setImportLink(e.target.value)} placeholder="https://…/templates/shared/…" /></label><button className="primary" disabled={busy || !importLink.trim()}>Add to my templates</button></form></div>
    </section>}
  </main></>;
}
