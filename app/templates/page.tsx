'use client';
import Link from 'next/link';
import {useCallback, useEffect, useState} from 'react';
import {toast} from 'sonner';
import {Copy, GitCompare, History, Link2, Tag} from 'lucide-react';
import {Header, Skeleton, api, post} from '../ui';
import {formatMoney} from '@/lib/scope';
import {filterTemplates, revisionDiff, type RevisionView, type TemplateView} from '@/lib/template-store';
import {MODES, type Mode} from '@/lib/mode-core'; // integration: client page uses WS-08's pure module (lib/mode.ts reads the database)

const MODE_LABEL: Record<Mode, string> = {freelancer: 'Freelancer', agency: 'Agency', consumer: 'Home & events', enterprise: 'Enterprise'};

/**
 * SF-18 (WS-09): Templates as a top-level section. Your templates (search, tag filter, tags, revision history
 * with diff and restore, share links with revoke, Use template), the built-in starters and vertical packs
 * (SF-22) ordered by mode, and importing a template someone shared by link.
 */
export default function Templates() {
  const [list, setList] = useState<TemplateView[] | null>(null), [builtins, setBuiltins] = useState<TemplateView[]>([]), [signedIn, setSignedIn] = useState<boolean | null>(null), [error, setError] = useState(''), [filter, setFilter] = useState(''), [query, setQuery] = useState(''), [mode, setMode] = useState<Mode>('freelancer');
  const [history, setHistory] = useState<{id: string; revisions: RevisionView[]; current: RevisionView; compare: number | null} | null>(null), [importLink, setImportLink] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(() => api('/api/templates').then(d => { const all = d.templates as TemplateView[]; setSignedIn(!!d.signed_in); setBuiltins(all.filter(t => t.builtin)); setList(all.filter(t => !t.builtin)); }, e => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const replace = (t: TemplateView) => setList(l => l && l.map(x => x.id === t.id ? t : x));
  async function run(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const saveTags = (t: TemplateView, text: string) => run(async () => { const tags = text.split(',').map(x => x.trim()).filter(Boolean); const r = await api(`/api/templates/${t.id}`, {...post({tags}), method: 'PUT'}); replace(r.template); toast.success('Tags saved.'); });
  const share = (t: TemplateView, on: boolean, rotate = false) => run(async () => { const r = await api(`/api/templates/${t.id}/share`, post({share: on, ...(rotate ? {rotate} : {})})); replace(r.template); toast.success(on ? (rotate ? 'New share link made; the old one stopped working.' : 'Share link ready.') : 'Sharing turned off.'); });
  const showHistory = (t: TemplateView) => run(async () => { const r = await api(`/api/templates/${t.id}/revisions`); setHistory({id: t.id, revisions: r.revisions, current: r.current, compare: null}); });
  const restore = (id: string, revision: number) => run(async () => { const r = await api(`/api/templates/${id}/revisions`, post({revision})); replace(r.template); setHistory(null); toast.success(`Revision ${revision} restored as revision ${r.template.revision}.`); });
  const importShared = () => run(async () => { const token = importLink.trim().match(/([a-f0-9]{32})\/?$/)?.[1]; if (!token) throw new Error('Paste a Scopeflow template share link.'); const r = await api(`/api/templates/shared/${token}`, post({})); setList(l => [r.template, ...(l ?? [])]); setImportLink(''); toast.success(`Added “${r.template.name}” to your templates.`); });
  const tags = [...new Set((list ?? []).flatMap(t => t.tags))].sort();
  const shown = filterTemplates(list ?? [], query, filter);
  const starters = filterTemplates(builtins, query).sort((a, b) => Number(!!b.modes?.includes(mode)) - Number(!!a.modes?.includes(mode)));
  const packs = starters.filter(t => t.pack), general = starters.filter(t => !t.pack);
  const templateLink = (t: TemplateView) => <Link className="secondary" href={`/?template=${encodeURIComponent(t.id)}`} aria-label={`Use template ${t.name}`}>Use template</Link>;
  const starterCard = (t: TemplateView) => <li key={t.id}>
    <div><strong>{t.name}</strong> <span className="quiet">· {t.pack ?? 'Starter'} · {t.content.items?.length ?? 0} deliverables{t.content.engagement === 'retainer' ? ' · monthly retainer' : ''}{t.content.milestones?.length ? ` · ${t.content.milestones.length} payment stages` : ''}{t.modes?.includes(mode) ? ` · suggested for ${MODE_LABEL[mode].toLowerCase()}` : ''}</span></div>
    {t.tags.length > 0 && <p className="fine">{t.tags.join(' · ')}</p>}
    {t.rate_card?.length ? <p className="fine">Rate card: {t.rate_card.map(r => `${r.title} (per ${r.unit})`).join(', ')}</p> : null}
    <div className="actions">{templateLink(t)}</div>
  </li>;
  return <><Header /><main id="content" tabIndex={-1} className="shell">
    <div className="page-heading"><div><p className="eyebrow">TEMPLATES</p><h1>Templates</h1></div></div>
    {error && <p className="error" role="alert">{error}</p>}
    <label className="section-gap">Search templates<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, tag or trade" /></label>
    {/* UX-C23: while the library loads, show that it is loading instead of an empty Starters list */}
    {list === null && !error && <Skeleton cards={3} lines={1} label="Loading templates…" />}
    {signedIn === false && <p className="muted-box">Sign in to keep your own templates. <Link className="help-link" href="/auth/sign-in?return_to=%2Ftemplates">Sign in</Link></p>}
    {signedIn && <section className="editor" aria-labelledby="your-templates">
      <h2 id="your-templates">Your templates</h2>
      <p className="quiet">Save a draft as a template from the workspace. Here you can tag templates, see, compare and restore earlier revisions, and share a template with another Scopeflow user by link. A share link shows the template, never who made it or your clients.</p>
      {tags.length > 0 && <div className="actions section-gap" role="group" aria-label="Filter by tag"><button className={filter ? 'secondary' : 'primary'} onClick={() => setFilter('')} aria-pressed={!filter}>All</button>{tags.map(t => <button key={t} className={filter === t ? 'primary' : 'secondary'} aria-pressed={filter === t} onClick={() => setFilter(t)}><Tag size={13} aria-hidden="true" />{t}</button>)}</div>}
      {list && !list.length && <p className="fine section-gap">You have no templates yet. In the workspace, use <strong>Save as template</strong> on a draft.</p>}
      {list && list.length > 0 && !shown.length && <p className="fine section-gap">No templates match.</p>}
      <ul className="receipt-list template-admin">{shown.map(t => <li key={t.id} aria-label={t.name}>
        <div><strong>{t.name}</strong> <span className="quiet">· revision {t.revision}{t.content.fee ? ` · ${formatMoney(t.content.fee, t.content.currency)}` : ''}{t.origin ? ` · ${t.origin}` : ''}</span></div>
        <form className="tag-row" onSubmit={e => { e.preventDefault(); void saveTags(t, String(new FormData(e.currentTarget).get('tags') ?? '')); }}><label>Tags <span className="quiet">· comma separated</span><input name="tags" defaultValue={t.tags.join(', ')} maxLength={220} placeholder="branding, retainer" /></label><button className="secondary" disabled={busy}>Save tags</button></form>
        {t.share_path
          ? <p className="fine"><Link2 size={13} aria-hidden="true" /> Shared: <span className="mono">{typeof location !== 'undefined' ? location.origin : ''}{t.share_path}</span> <button className="help-link" onClick={() => { navigator.clipboard.writeText(location.origin + t.share_path).then(() => toast.success('Share link copied.'), () => toast.error('Copy failed. Select the link and copy it.')); }}><Copy size={13} aria-hidden="true" />Copy</button> · <button className="help-link" disabled={busy} onClick={() => void share(t, true, true)}>New link</button> · <button className="help-link" disabled={busy} onClick={() => void share(t, false)}>Stop sharing</button></p>
          : null}
        <div className="actions">{templateLink(t)}{!t.share_path && <button className="secondary" disabled={busy} onClick={() => void share(t, true)}><Link2 size={14} aria-hidden="true" />Share by link</button>}<button className="secondary" disabled={busy} onClick={() => void showHistory(t)}><History size={14} aria-hidden="true" />History</button></div>
        {history?.id === t.id && <div className="muted-box" role="region" aria-label={`Revisions of ${t.name}`}>
          <ul>
            <li>Revision {history.current.revision} · “{history.current.name}” · current · saved {new Date(history.current.saved).toLocaleString()}</li>
            {history.revisions.map(r => <li key={r.revision}>Revision {r.revision} · “{r.name}” · saved {new Date(r.saved).toLocaleString()} <button className="help-link" disabled={busy} onClick={() => setHistory(h => h && {...h, compare: h.compare === r.revision ? null : r.revision})} aria-expanded={history.compare === r.revision}><GitCompare size={13} aria-hidden="true" />Compare with current</button> · <button className="help-link" disabled={busy} onClick={() => void restore(t.id, r.revision)}>Restore revision {r.revision}</button>
              {history.compare === r.revision && (() => { const lines = revisionDiff(r, history.current); return <div role="region" aria-label={`Changes from revision ${r.revision} to ${history.current.revision}`}>{lines.length ? <ul className="observations">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : <p className="fine">No differences.</p>}</div>; })()}
            </li>)}
          </ul>
          {!history.revisions.length && <p className="fine">No earlier revisions yet. Each time you update the template from a draft, the previous version is kept here (up to 20).</p>}
          <button className="help-link" onClick={() => setHistory(null)}>Close</button></div>}
      </li>)}</ul>
      <div className="section-gap"><h2>Add a shared template</h2><form className="tag-row" onSubmit={e => { e.preventDefault(); void importShared(); }}><label>Share link<input value={importLink} onChange={e => setImportLink(e.target.value)} placeholder="https://…/templates/shared/…" /></label><button className="primary" disabled={busy || !importLink.trim()}>Add to my templates</button></form></div>
    </section>}
    {list !== null && <section className="editor section-gap" aria-labelledby="starter-templates">
      <h2 id="starter-templates">Starters and vertical packs</h2>
      <div className="actions" role="group" aria-label="Suggested for">{MODES.map(m => <button key={m} className={mode === m ? 'primary' : 'secondary'} aria-pressed={mode === m} onClick={() => setMode(m)}>{MODE_LABEL[m]}</button>)}</div>
      <p className="fine">Every starter works in every mode; the mode only puts its suggestions first.</p>
      {packs.length > 0 && <><h3 className="section-gap">Vertical packs</h3><ul className="receipt-list template-admin">{packs.map(starterCard)}</ul></>}
      {general.length > 0 && <><h3 className="section-gap">General starters</h3><ul className="receipt-list template-admin">{general.map(starterCard)}</ul></>}
    </section>}
  </main></>;
}
