'use client';
import {useCallback, useEffect, useState} from 'react';
import {Copy, Inbox} from 'lucide-react';
import {toast} from 'sonner';
import {formatInZone} from '@/lib/time';
import {COPY_FAILED, copyText} from '@/lib/clipboard';
import {api, post} from './ui';

type Citation = {id: string; kind: string; text: string};
type Message = {id: string; received: string; sender: string | null; subject: string | null; body: string; status: 'new' | 'done'; radar: null | {verdict: string; covered: string; engine: string; citations: Citation[]; reply: string; basis: string}};
type Held = {id: string; received: string; sender: string | null; subject: string | null; body: string; reason: 'unknown_sender' | 'auth_failed'};
const VERDICT: Record<string, string> = {in_scope: 'Covered by the agreement', out_of_scope: 'Not covered: a change order', revision: 'A revision round', ambiguous: 'Unclear: check it yourself'};

/**
 * Email forwarding into the radar: the project's private inbound address, and the client emails
 * forwarded to it with the radar's first read. Nothing here is sent to the client.
 */
export function InboundPanel({projectId, timeZone}: {projectId: string; timeZone: string | null}) {
  const [data, setData] = useState<{configured: boolean; address: string | null; messages: Message[]; quarantine?: Held[]} | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = useCallback(() => api(`/api/scopes/${projectId}/inbound`).then(setData, () => setData(null)), [projectId]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return null;
  async function address(mode: 'on' | 'off' | 'rotate') {
    setBusy(true); setError('');
    try { await api(`/api/scopes/${projectId}`, {...post({inbound: mode}), method: 'PATCH'}); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function held(id: string, action: 'release' | 'dismiss', allow = false) {
    try { await api(`/api/scopes/${projectId}/inbound`, {...post({quarantine_id: id, action, ...(action === 'release' ? {allow_sender: allow} : {})}), method: 'PATCH'}); await load(); } catch (e) { setError((e as Error).message); }
  }
  async function mark(id: string, status: 'dismissed' | 'done') {
    try { await api(`/api/scopes/${projectId}/inbound`, {...post({message_id: id, status}), method: 'PATCH'}); await load(); } catch (e) { setError((e as Error).message); }
  }
  return (
    <div className="section-gap" role="group" aria-labelledby="h-inbound">
      <h4 className="h-sub" id="h-inbound"><Inbox size={15} aria-hidden="true" /> Forwarded client emails</h4>
      {!data.configured
        ? <p className="fine">Email forwarding is not set up on this server yet. Paste client requests into the scope-creep radar instead.</p>
        : data.address
          ? <><p className="fine">Forward a client’s email to this private address and the radar checks it against the agreement. Mail from you, your client and the countersigners goes straight in; mail from anyone else, or mail that fails the sender checks, waits below for you to release it.</p>
              <p className="mono fine"><span>{data.address}</span> <button className="help-link" onClick={() => { void copyText(data.address!).then(ok => ok ? toast.success('Address copied.') : toast.error(COPY_FAILED)); }}><Copy size={13} aria-hidden="true" />Copy<span className="sr-only"> the forwarding address</span></button></p>
              <div className="actions"><button className="secondary" disabled={busy} onClick={() => void address('rotate')}>New address</button><button className="secondary" disabled={busy} onClick={() => void address('off')}>Turn off</button></div></>
          : <><p className="fine">Get a private address for this project. Forward client emails to it and each one is checked by the radar and listed here.</p><button className="secondary" disabled={busy} onClick={() => void address('on')}>Create forwarding address</button></>}
      {data.messages.length > 0 && <ul className="receipt-list inbound-list">{data.messages.map(m => (
        <li key={m.id}>
          <div><strong>{m.subject || '(no subject)'}</strong> <span className="quiet">· {m.sender ?? 'unknown sender'} · {formatInZone(m.received, timeZone ?? 'UTC')}</span></div>
          <p className="line-list">{m.body.slice(0, 600)}{m.body.length > 600 ? '…' : ''}</p>
          {m.radar && <p className="fine"><strong>{VERDICT[m.radar.verdict] ?? m.radar.verdict}</strong>{m.radar.citations.length ? ` · ${m.radar.citations.map(c => `${c.id}: ${c.text}`).join('; ')}` : ''}{m.radar.engine === 'embedding' ? ' · matched by meaning' : ''}</p>}
          <div className="actions">{m.radar?.reply && <button className="secondary" onClick={() => { void copyText(m.radar!.reply).then(ok => ok ? toast.success('Suggested reply copied.') : toast.error(COPY_FAILED)); }}><Copy size={14} aria-hidden="true" />Copy suggested reply</button>}<button className="secondary" onClick={() => { void copyText(m.body).then(ok => ok ? toast.success('Request copied: paste it into the radar for the AI check.') : toast.error(COPY_FAILED)); }}>Copy request</button>{m.status !== 'done' && <button className="secondary" onClick={() => void mark(m.id, 'done')}>Mark handled</button>}<button className="help-link" onClick={() => void mark(m.id, 'dismissed')}>Dismiss</button></div>
        </li>))}</ul>}
      {!!data.quarantine?.length && <div className="section-gap" role="group" aria-labelledby="h-quarantine">
        <h4 className="h-sub" id="h-quarantine">Held for review</h4>
        <p className="fine">These did not come from you, your client or a countersigner{data.quarantine.some(q => q.reason === 'auth_failed') ? ', or failed the sender checks (possible forgery)' : ''}. They are not checked by the radar until you release them.</p>
        <ul className="receipt-list inbound-list">{data.quarantine.map(q => <li key={q.id}>
          <div><strong>{q.subject || '(no subject)'}</strong> <span className="quiet">· {q.sender ?? 'unknown sender'} · {formatInZone(q.received, timeZone ?? 'UTC')}{q.reason === 'auth_failed' ? ' · failed sender checks' : ''}</span></div>
          <p className="line-list">{q.body.slice(0, 300)}{q.body.length > 300 ? '…' : ''}</p>
          <div className="actions"><button className="secondary" onClick={() => void held(q.id, 'release')}>Release</button>{q.reason === 'unknown_sender' && q.sender && <button className="secondary" onClick={() => void held(q.id, 'release', true)}>Release and always allow {q.sender}</button>}<button className="help-link" onClick={() => void held(q.id, 'dismiss')}>Dismiss</button></div>
        </li>)}</ul>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
