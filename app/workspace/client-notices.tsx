'use client';
// WS-09 part D: mounts for WS-06's client notifications (H18): "Client emailed · Share on WhatsApp" next to
// change orders and invoices (`ClientNotice`, a named export of the WhatsAppShare slot) and the per-project
// "email my client" switch. On a base without WS-06 the slot has no ClientNotice export: these render
// nothing and make no request, so the workspace is unchanged until WS-06 lands.
import {useEffect, useState, type ComponentType} from 'react';
import * as share from '../components/slots/whatsapp-share';
import {api, post} from '../ui';

type Email = {status: string; at?: string | null} | null;
type ShareInfo = {phone: string | null; lang: string | null; client: string; title: string; link: string};
type Notices = {
  notify_client: boolean; client_email: boolean; share: ShareInfo | null;
  change_orders: {seq: number; title: string; status: string; amount: string | null; email: Email}[];
  invoices: {seq: number; number: string; amount: string; due: string | null; email: Email}[];
};
type NoticeProps = {kind: 'change_order' | 'invoice'; values: Record<string, unknown>; phone?: string | null; lang?: string | null; label?: string; projectId?: string; email: Email};

/** WS-06's ClientNotice when that workstream has landed, else null. */
const ClientNotice = (share as unknown as Record<string, unknown>).ClientNotice as ComponentType<NoticeProps> | undefined;
export const clientNoticesLive = typeof ClientNotice === 'function';

function useNotices(projectId: string, reload: number) {
  const [data, setData] = useState<Notices | null>(null);
  useEffect(() => {
    if (!clientNoticesLive) return;
    let live = true;
    api(`/api/scopes/${encodeURIComponent(projectId)}/notifications`).then((d: Notices) => { if (live) setData(d); }).catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, [projectId, reload]);
  return [data, setData] as const;
}

/** Notices for the project's change orders (Changes step) or invoices (Payment step). */
export function ClientNotices({projectId, list, reload = 0}: {projectId: string; list: 'change_orders' | 'invoices'; reload?: number}) {
  const [data] = useNotices(projectId, reload);
  if (!ClientNotice || !data?.share) return null;
  const s = data.share, base = {client: s.client, title: s.title, link: s.link};
  const rows = list === 'change_orders'
    ? data.change_orders.filter(c => c.status === 'proposed').map(c => ({key: 'co-' + c.seq, name: `CO-${c.seq} ${c.title}`, kind: 'change_order' as const, email: c.email, values: {...base, seq: c.seq, co_title: c.title, amount: c.amount ?? undefined}}))
    : data.invoices.map(i => ({key: 'inv-' + i.seq, name: i.number, kind: 'invoice' as const, email: i.email, values: {...base, number: i.number, amount: i.amount, due: i.due ?? undefined}}));
  if (!rows.length) return null;
  return <ul className="receipt-list" aria-label={list === 'change_orders' ? 'Client notices for change orders' : 'Client notices for invoices'}>
    {rows.map(r => <li key={r.key}><span>{r.name}</span><ClientNotice kind={r.kind} values={r.values} phone={s.phone} lang={s.lang} email={r.email} projectId={projectId} /></li>)}
  </ul>;
}

/** Project setting: email the client about change orders, invoices and reminders (WS-06 `notify_client`). */
export function NotifyToggle({projectId, disabled}: {projectId: string; disabled?: boolean}) {
  const [data, setData] = useNotices(projectId, 0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!ClientNotice || !data) return null;
  async function set(on: boolean) {
    setBusy(true); setError('');
    try { await api(`/api/scopes/${encodeURIComponent(projectId)}/notifications`, {...post({notify_client: on}), method: 'PATCH'}); setData(d => d && {...d, notify_client: on}); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <label className="check-row"><input type="checkbox" checked={data.notify_client} disabled={disabled || busy} onChange={e => void set(e.target.checked)} />Email my client about change orders, invoices and reminders{error && <span className="error-text" role="alert">{error}</span>}</label>;
}
