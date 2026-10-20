// Prepares a client share link without ever returning it. A live link is left alone
// (replacing it would break a link the owner already sent). A revoked link is replaced
// in the database; the new token stays on the server.
import {db, secret} from './server';
import {setLinkIssued} from './review-link';
import {recordActivity} from './team';

export async function ensureShareLink(owner: string, projectId: string): Promise<{ok: true; rotated: boolean} | {ok: false; status: number; error: string}> {
  const row = await db().prepare('SELECT v.version, v.token, v.revoked, v.status FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.id=? AND p.owner=? AND p.owner_deleted IS NULL AND v.version=p.latest').bind(projectId, owner).first<{version: number; token: string; revoked: number; status: string}>();
  if (!row) return {ok: false, status: 404, error: 'Project not found.'};
  if (!row.revoked) {
    await recordActivity(owner, owner, 'share_link', {project_id: projectId, rotated: false});
    return {ok: true, rotated: false};
  }
  const token = secret();
  const now = new Date().toISOString();
  if (row.status !== 'pending') {
    await db().prepare('INSERT INTO scopeflow.version_link_aliases (token,project_id,version,reason,created) VALUES (?,?,?,?,?) ON CONFLICT (token) DO NOTHING').bind(row.token, projectId, row.version, 'rotated', now).run();
  }
  const result = await db().prepare('UPDATE versions SET token=?,revoked=0 WHERE project_id=? AND version=? AND revoked=1').bind(token, projectId, row.version).run();
  if (!result.meta.changes) return {ok: true, rotated: false};
  await setLinkIssued(projectId, row.version, now);
  await recordActivity(owner, owner, 'share_link', {project_id: projectId, rotated: true});
  return {ok: true, rotated: true};
}
