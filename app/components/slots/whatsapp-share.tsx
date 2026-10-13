'use client';
// Slot: WhatsAppShare. Owner: WS-06 (implements it). Mounted by: WS-09 (workspace: Approval step
// next to "Copy link", the change-order list and the invoice list). LT-03, SF-01.
// Opens the owner's own WhatsApp (wa.me) with a polite prefilled message in the client's language;
// the owner can edit the text before sharing. Scopeflow sends nothing on WhatsApp to clients.
import {useId, useMemo, useState} from 'react';
import {MessageCircle} from 'lucide-react';
import {shareMessage, waLink, type ShareKind, type ShareValues} from '@/lib/whatsapp-share';
import styles from './whatsapp-share.module.css';

export type WhatsAppShareProps = {
  kind: ShareKind;
  values: ShareValues;
  /** The client's phone in E.164 (opens that chat); without it WhatsApp asks the owner to pick a chat. */
  phone?: string | null;
  lang?: string | null;
  label?: string;
  /** Show "Edit message" (default true). */
  editable?: boolean;
  /** For the project: records the share (counts as sending the link, WS-02 contact lock). */
  projectId?: string;
  className?: string;
};

export default function WhatsAppShare({kind, values, phone, lang, label = 'Share on WhatsApp', editable = true, projectId, className}: WhatsAppShareProps) {
  const initial = useMemo(() => shareMessage(kind, values, lang), [kind, values, lang]);
  const [text, setText] = useState<string | null>(null), [editing, setEditing] = useState(false);
  const id = useId();
  const message = text ?? initial;
  const href = waLink(phone, message);
  const shared = () => {
    if (!projectId) return;
    void fetch(`/api/scopes/${encodeURIComponent(projectId)}/notifications`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({shared: 'whatsapp'})}).catch(() => undefined);
  };
  return <span className={`${styles.wrap} ${className ?? ''}`}>
    <span className={styles.row}>
      <a className={`secondary ${styles.link}`} href={href} target="_blank" rel="noopener noreferrer" onClick={shared} data-testid="whatsapp-share"><MessageCircle size={14} aria-hidden="true" />{label}</a>
      {editable && <button type="button" className={styles.edit} aria-expanded={editing} aria-controls={id} onClick={() => setEditing(v => !v)}>{editing ? 'Done' : 'Edit message'}</button>}
    </span>
    {editing && <span id={id} className={styles.wrap}>
      <label className={styles.fine} htmlFor={id + '-text'}>Message to send from your WhatsApp</label>
      <textarea id={id + '-text'} className={styles.text} value={message} onChange={e => setText(e.target.value)} maxLength={3000} />
      {text !== null && <button type="button" className={styles.edit} onClick={() => setText(null)}>Reset to the suggested message</button>}
    </span>}
  </span>;
}

/** "Client emailed · Share on WhatsApp" next to a change order or invoice (H18). */
export function ClientNotice({email, ...share}: WhatsAppShareProps & {email: {status: string; at?: string | null} | null}) {
  const sent = email && (email.status === 'sent' || email.status === 'dev_log');
  const note = !email ? null : sent ? 'Client emailed' : email.status === 'queued' ? 'Email queued' : email.status === 'skipped' ? 'Client emails off' : email.status === 'no_provider' ? 'Email not set up' : 'Email not sent';
  return <span className={styles.status} data-testid="client-notice">
    {note && <span className={sent ? styles.ok : undefined}>{note}</span>}{note && <span aria-hidden="true">·</span>}
    <WhatsAppShare {...share} editable={share.editable ?? false} />
  </span>;
}
