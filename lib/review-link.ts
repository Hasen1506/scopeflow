import {db, secret} from './server';
import {parseCosigners, type Cosigner} from './cosign';
import {diffBaseVersion, type VersionHistory} from './diff';
import {readonlyReason, type ReadonlyReason} from './identity';
import {notify} from './notify';

// Review-link state (owner: WS-02): which version a token opens, whether it is read-only (H4),
// per-version expiry (H5), when a version was first sent (H2, C5 contact lock), and the
// countersigning roles frozen into the version at first send (M17, H1). Server-only.

export type ReviewLink = {
  id: string; project_id: string; version: number; latest: number; owner: string; status: string; content: string;
  token: string; created: string; signer: string | null; comment: string | null; decided: string | null;
  signature: string | null; decision_context: string | null; revoked: number;
  timezone: string | null; require_otp: boolean; client_email: string | null; client_phone: string | null; otp_channel: string | null;
  project_cosigners: string | null; link_expiry_days: number | null; contact_since: string | null; owner_deleted: string | null; retain_until: string | null;
  link_issued: string | null; first_sent: string | null; version_cosigners: string | null;
  /** True when the presented token is an older, rotated-away token of a decided version. */
  alias: boolean;
  readonly: boolean; readonly_reason: ReadonlyReason | null;
};

const COLUMNS = `v.id,v.project_id,v.version,v.status,v.content,v.token,v.created,v.signer,v.comment,v.decided,v.signature,v.decision_context,v.revoked,
 p.latest,p.owner,p.timezone,p.require_otp,p.client_email,p.client_phone,p.otp_channel,p.cosigners AS project_cosigners,p.link_expiry_days,p.contact_since,p.owner_deleted,p.retain_until,
 l.link_issued,l.first_sent,l.cosigners AS version_cosigners`;
const JOINS = 'JOIN projects p ON p.id=v.project_id LEFT JOIN scopeflow.version_links l ON l.project_id=v.project_id AND l.version=v.version';

/**
 * The version a review token opens, or null (404). A revoked pending version is not served; a
 * revoked decided version, an older (rotated) token of a decided version and any version of a
 * closed account are served read-only (§6.3).
 */
export async function resolveReviewToken(token: string): Promise<ReviewLink | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  let row = await db().prepare(`SELECT ${COLUMNS} FROM versions v ${JOINS} WHERE v.token=?`).bind(token).first<Omit<ReviewLink, 'alias' | 'readonly' | 'readonly_reason'>>();
  let alias = false;
  if (!row) {
    row = await db().prepare(`SELECT ${COLUMNS} FROM scopeflow.version_link_aliases a JOIN versions v ON v.project_id=a.project_id AND v.version=a.version ${JOINS} WHERE a.token=?`).bind(token).first<Omit<ReviewLink, 'alias' | 'readonly' | 'readonly_reason'>>();
    alias = !!row;
  }
  if (!row) return null;
  if (row.status === 'pending' && (row.revoked || alias)) return null;
  if (row.status === 'pending' && row.owner_deleted) return null;
  const reason = readonlyReason({status: row.status, revoked: row.revoked, alias, owner_deleted: row.owner_deleted});
  return {...row, alias, readonly: reason !== null, readonly_reason: reason};
}

/** The version's own expiry state for lib/link.ts (H5: link_issued is per version). */
export const linkStateOf = (r: Pick<ReviewLink, 'status' | 'created' | 'link_issued' | 'link_expiry_days'>) => ({status: r.status, created: r.created, link_issued: r.link_issued, link_expiry_days: r.link_expiry_days});

/** H5: a replaced link starts a new expiry period for that version only. */
export async function setLinkIssued(projectId: string, version: number, at: string) {
  await db().prepare('INSERT INTO scopeflow.version_links (project_id,version,link_issued) VALUES (?,?,?) ON CONFLICT (project_id,version) DO UPDATE SET link_issued=excluded.link_issued').bind(projectId, version, at).run();
}

/** H2/C5: marks a version as handed to the client (email send, copied or shared link, decision), then freezes its roles (M17). */
export async function markSent(projectId: string, version: number, via: 'email' | 'copy' | 'whatsapp' | 'share' | 'decision', at = new Date().toISOString()) {
  await db().prepare('INSERT INTO scopeflow.version_links (project_id,version,first_sent,sent_via) VALUES (?,?,?,?) ON CONFLICT (project_id,version) DO UPDATE SET first_sent=coalesce(version_links.first_sent,excluded.first_sent),sent_via=coalesce(version_links.sent_via,excluded.sent_via)').bind(projectId, version, at, via).run();
  return freezeRoles(projectId, version);
}

/** C5: the client contact is locked once any version of the project has been sent. */
export async function contactLocked(projectId: string) {
  return !!await db().prepare('SELECT 1 AS x FROM scopeflow.version_links WHERE project_id=? AND first_sent IS NOT NULL LIMIT 1').bind(projectId).first();
}

/**
 * M17/H1: the countersigning roles of a sent version, frozen from the project's list at first send,
 * with one link token per role. Returns the frozen roles ([] when none), or null while the version
 * has not been sent (roles still editable on the project).
 */
export async function freezeRoles(projectId: string, version: number): Promise<Cosigner[] | null> {
  const l = await db().prepare('SELECT first_sent,cosigners FROM scopeflow.version_links WHERE project_id=? AND version=?').bind(projectId, version).first<{first_sent: string | null; cosigners: string | null}>();
  if (!l?.first_sent) return null;
  if (l.cosigners === null) {
    const p = await db().prepare('SELECT cosigners FROM projects WHERE id=?').bind(projectId).first<{cosigners: string | null}>();
    await db().prepare('UPDATE scopeflow.version_links SET cosigners=? WHERE project_id=? AND version=? AND cosigners IS NULL').bind(p?.cosigners ?? '[]', projectId, version).run();
  }
  const frozen = await db().prepare('SELECT cosigners FROM scopeflow.version_links WHERE project_id=? AND version=?').bind(projectId, version).first<{cosigners: string | null}>();
  const roles = parseCosigners(frozen?.cosigners);
  const now = new Date().toISOString();
  for (const r of roles) {
    await db().prepare('INSERT INTO scopeflow.cosign_invites (id,project_id,version,cosigner_id,role,name,email,phone,token,created) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (project_id,version,cosigner_id) DO NOTHING')
      .bind(crypto.randomUUID(), projectId, version, r.id, r.role, r.name ?? null, r.email ?? null, r.phone ?? null, secret(), now).run();
  }
  return roles;
}

/** The roles that apply to a version: frozen when sent, else the project's current list. */
export async function rolesFor(projectId: string, version: number, projectCosigners: string | null): Promise<Cosigner[]> {
  return (await freezeRoles(projectId, version)) ?? parseCosigners(projectCosigners);
}

export type CosignInvite = {id: string; project_id: string; version: number; cosigner_id: string; role: string; name: string | null; email: string | null; phone: string | null; token: string; created: string};
export async function invitesFor(projectId: string, version: number) {
  return (await db().prepare('SELECT id,project_id,version,cosigner_id,role,name,email,phone,token,created FROM scopeflow.cosign_invites WHERE project_id=? AND version=? ORDER BY created,cosigner_id').bind(projectId, version).all<CosignInvite>()).results;
}

/** H1: once approved, each role with an address gets its own link (WS-06 delivers through notify()). */
export async function inviteCosigners(request: Request, projectId: string, version: number, owner: string, title: string) {
  const invites = await invitesFor(projectId, version);
  const origin = (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  for (const i of invites) {
    const to = i.email ?? i.phone;
    if (!to) continue;
    await notify('cosign_invite', {project_id: projectId, owner, to, data: {role: i.role, name: i.name, title, version, url: `${origin}/cosign/${i.token}`, channel: i.email ? 'email' : 'sms'}}).catch(() => null);
  }
}

/** H2/M29: the versions a token holder may compare with: sent, opened by the client, or decided; never revoked; never drafts. */
export async function historyOf(projectId: string, before: number): Promise<VersionHistory[]> {
  const rows = await db().prepare(`SELECT v.version,v.status,v.revoked,l.first_sent,
    (SELECT COUNT(*) FROM review_views r WHERE r.project_id=v.project_id AND r.version=v.version) AS opened
    FROM versions v LEFT JOIN scopeflow.version_links l ON l.project_id=v.project_id AND l.version=v.version
    WHERE v.project_id=? AND v.version<? ORDER BY v.version`).bind(projectId, before).all<{version: number; status: string; revoked: number; first_sent: string | null; opened: number}>();
  return rows.results.map(r => ({version: r.version, status: r.status, revoked: !!r.revoked, sent: !!r.first_sent || Number(r.opened) > 0}));
}

/** The diff base (content and version) for a token holder, or a chosen comparable version. */
export async function diffBaseFor(projectId: string, version: number, compare?: number | null) {
  const history = await historyOf(projectId, version);
  const base = diffBaseVersion(history, version, compare ?? null);
  const options = history.filter(h => !h.revoked && (h.sent || h.status !== 'pending')).map(h => ({version: h.version, status: h.status}));
  if (base === null) return {previous: null, previous_version: null, compare_versions: options};
  const row = await db().prepare('SELECT content FROM versions WHERE project_id=? AND version=?').bind(projectId, base).first<{content: string}>();
  return {previous: row ? JSON.parse(row.content) : null, previous_version: row ? base : null, compare_versions: options};
}

/** L12: the newer version a stale link should point to, and its link when that version was handed out. */
export async function newerPointer(projectId: string, latest: number) {
  const r = await db().prepare(`SELECT v.token,v.status,v.revoked,l.first_sent,(SELECT COUNT(*) FROM review_views r WHERE r.project_id=v.project_id AND r.version=v.version) AS opened
    FROM versions v LEFT JOIN scopeflow.version_links l ON l.project_id=v.project_id AND l.version=v.version WHERE v.project_id=? AND v.version=?`).bind(projectId, latest).first<{token: string; status: string; revoked: number; first_sent: string | null; opened: number}>();
  if (!r) return {newer_version: latest, newer_url: null};
  const shared = !r.revoked && (!!r.first_sent || Number(r.opened) > 0 || r.status !== 'pending');
  return {newer_version: latest, newer_url: shared ? `/review/${r.token}` : null};
}

/** Who sent the link, for "ask for a new link" on a dead link (WS-07, 410). */
export async function senderOf(projectId: string): Promise<{name: string | null; email: string | null}> {
  try {
    const r = await db().prepare('SELECT p.owner,b.business_name,b.reply_to FROM projects p LEFT JOIN business_profiles b ON b.owner=p.owner WHERE p.id=?').bind(projectId).first<{owner: string; business_name: string | null; reply_to: string | null}>();
    return {name: r?.business_name ?? null, email: r?.reply_to ?? null};
  } catch { return {name: null, email: null}; }
}
