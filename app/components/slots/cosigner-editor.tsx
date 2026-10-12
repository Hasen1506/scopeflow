'use client';
// Slot: CosignerEditor. Owner: WS-02 (implements it). Mounted by: WS-09 (workspace project settings).
// H1/M17: countersigning roles, each with its own signer (name and email or phone). The roles are
// frozen into the version when it is first sent; each role then has its own link and code.
import {useState} from 'react';
import {api} from '@/app/ui';
import styles from '../evidence/identity-slots.module.css';

export type CosignerRole = {id: string; role: string; name?: string; email?: string; phone?: string};
export type CosignerEditorProps = {
  projectId: string;
  /** project.cosigners from GET /api/scopes/<id>. */
  cosigners: CosignerRole[];
  /** project.roles_frozen from GET /api/scopes/<id>. */
  frozen: boolean;
  /** cosign_links from GET /api/scopes/<id> (browser sessions only). */
  links?: {cosigner_id: string; role: string; to: string | null; cosign_path: string}[];
  onChanged?: () => void | Promise<void>;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'role';

export default function CosignerEditor({projectId, cosigners, frozen, links = [], onChanged}: CosignerEditorProps) {
  const [roles, setRoles] = useState<CosignerRole[]>(cosigners);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const update = (i: number, patch: Partial<CosignerRole>) => setRoles(rs => rs.map((r, j) => j === i ? {...r, ...patch} : r));
  async function save() {
    setError(''); setSaved(false); setBusy(true);
    const clean = roles.map(r => ({id: r.id || slug(r.role), role: r.role.trim(), ...(r.name?.trim() ? {name: r.name.trim()} : {}), ...(r.email?.trim() ? {email: r.email.trim()} : {}), ...(r.phone?.trim() ? {phone: r.phone.trim()} : {})}));
    try { await api(`/api/scopes/${projectId}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({cosigners: clean})}); setSaved(true); await onChanged?.(); }
    catch (e) { const err = e as Error & {code?: string}; setError(err.code === 'roles_frozen' ? 'These roles were fixed when the version was sent. Save a new version to change them.' : err.code === 'reauth_required' ? 'For your security, sign out and sign in again, then save within 10 minutes.' : err.message); }
    finally { setBusy(false); }
  }
  return (
    <section className={styles.panel} aria-labelledby="h-cosigners">
      <h3 id="h-cosigners">Countersigners</h3>
      <p className="fine">Each role signs on its own link, after a code sent to its own address. {frozen ? 'The roles of the sent version are fixed.' : 'Roles are fixed when the version is first sent.'}</p>
      <ul className={styles.roles}>
        {roles.map((r, i) => <li key={i} className={styles.role}>
          <label>Role<input value={r.role} disabled={frozen} maxLength={60} onChange={e => update(i, {role: e.target.value, ...(cosigners[i]?.id ? {} : {id: slug(e.target.value)})})} placeholder="Finance approver" /></label>
          <label>Signer’s name<input value={r.name ?? ''} disabled={frozen} maxLength={120} onChange={e => update(i, {name: e.target.value})} /></label>
          <label>Signer’s email<input value={r.email ?? ''} disabled={frozen} inputMode="email" onChange={e => update(i, {email: e.target.value})} /></label>
          <label>or phone<input value={r.phone ?? ''} disabled={frozen} inputMode="tel" placeholder="+919876543210" onChange={e => update(i, {phone: e.target.value})} /></label>
          {!frozen && <button className="secondary" onClick={() => setRoles(rs => rs.filter((_, j) => j !== i))}>Remove</button>}
          {links.filter(l => l.cosigner_id === r.id).map(l => <p key={l.cosign_path} className={styles.link}>Link for {l.role}{l.to ? ` (code to ${l.to})` : ''}: {l.cosign_path}</p>)}
        </li>)}
      </ul>
      {!frozen && <div className="actions">
        {roles.length < 3 && <button className="secondary" onClick={() => setRoles(rs => [...rs, {id: '', role: ''}])}>Add a role</button>}
        <button className="primary" disabled={busy || roles.some(r => r.role.trim().length < 2)} onClick={save}>{busy ? 'Saving…' : 'Save countersigners'}</button>
      </div>}
      {saved && <p className="chain ok" role="status">Saved.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
