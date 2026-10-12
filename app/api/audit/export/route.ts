import {createHash} from 'node:crypto';
import {db, json, ownerAuth, allowRead, failure, hash} from '@/lib/server';
import {anchorOf} from '@/lib/ledger-server';
import {publicSigningKey, signRecord} from '@/lib/signing';
import {buildAuditExport, toCsv, toJsonl, type AuditRows, type ContactRow} from '@/lib/audit-export';
import {currentMode} from '@/lib/mode';
import {effectiveRetentionDays, fromRow, type SettingsRow} from '@/lib/settings';
import {auditEvent} from '@/lib/billing';
// SF-25: GET /api/audit/export?from=YYYY-MM-DD&to=YYYY-MM-DD&format=jsonl|csv. Admin-only: the
// account owner in a browser session (an API token or connector cannot pull the audit trail).
// Available in every mode; Enterprise lists it first. The export itself is an admin event.
const day = /^\d{4}-\d{2}-\d{2}$/;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export async function GET(request: Request) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in to export the audit trail.'}, 401);
    if (auth.via !== 'session') return json({error: 'The audit export is for the account admin, from the ScopeFlow website.', code: 'admin_only'}, 403);
    if (!await allowRead('owner:' + auth.user, 20)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const q = new URL(request.url).searchParams, format = q.get('format') === 'csv' ? 'csv' : 'jsonl';
    const from = q.get('from') ?? '2000-01-01', toDay = q.get('to') ?? new Date().toISOString().slice(0, 10);
    if (!day.test(from) || !day.test(toDay) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(toDay)) || from > toDay) return json({error: 'Use from and to as YYYY-MM-DD, from on or before to.'}, 400);
    const to = new Date(Date.parse(toDay + 'T00:00:00Z') + 86400_000).toISOString().slice(0, 10); // inclusive end day
    const owner = auth.user, d = db();
    const mine = 'SELECT id FROM projects WHERE owner=?';
    const [projects, versions, entries, cosigns, access, admin, settings, contactTable] = await Promise.all([
      d.prepare("SELECT p.id,p.created,p.archived,p.legal_hold,p.legal_hold_reason,p.legal_hold_set,p.retention_days,p.owner_deleted,p.retain_until,(SELECT content::jsonb->>'title' FROM versions v WHERE v.project_id=p.id ORDER BY version DESC LIMIT 1) AS title FROM projects p WHERE p.owner=? ORDER BY p.created").bind(owner).all(),
      d.prepare(`SELECT project_id,version,status,content,signer,decided,signature FROM versions WHERE status<>'pending' AND decided IS NOT NULL AND project_id IN (${mine}) ORDER BY project_id,version`).bind(owner).all<{project_id: string; version: number; status: string; content: string; signer: string | null; decided: string; signature: string | null}>(),
      d.prepare(`SELECT project_id,seq,kind,baseline_version,actor,created,prev_hash,hash,signature,payload FROM ledger_entries WHERE project_id IN (${mine}) ORDER BY project_id,seq`).bind(owner).all(),
      d.prepare(`SELECT project_id,version,cosigner_id,role,signer,signed,signature FROM version_cosigns WHERE project_id IN (${mine}) ORDER BY signed`).bind(owner).all(),
      d.prepare(`SELECT project_id,version,first_viewed,last_viewed,views FROM review_views WHERE project_id IN (${mine}) ORDER BY last_viewed`).bind(owner).all(),
      d.prepare('SELECT id,kind,detail,actor,created FROM scopeflow.audit_events WHERE owner=? ORDER BY created').bind(owner).all(),
      d.prepare('SELECT * FROM account_settings WHERE owner=?').bind(owner).first<SettingsRow>(),
      d.prepare("SELECT to_regclass('scopeflow.contact_history') IS NOT NULL AS present").first<{present: boolean}>(),
    ]);
    // WS-02's contact_history (when present): every column, as recorded.
    let contacts: ContactRow[] = [];
    if (contactTable?.present) {
      const rows = await d.prepare(`SELECT project_id, row_to_json(c)::text AS detail FROM scopeflow.contact_history c WHERE project_id IN (${mine})`).bind(owner).all<{project_id: string; detail: string}>();
      contacts = rows.results.map(r => { const detail = JSON.parse(r.detail) as Record<string, unknown>; return {project_id: r.project_id, at: String(detail.at ?? detail.created ?? ''), detail}; });
    }
    const decisions = await Promise.all(versions.results.map(async v => ({project_id: v.project_id, version: v.version, status: v.status, signer: v.signer, decided: v.decided, signature: v.signature, anchor: await anchorOf(v)})));
    const rows = {projects: projects.results, decisions, entries: entries.results, cosigns: cosigns.results, access: access.results, admin: admin.results, contacts} as unknown as AuditRows;
    const key = publicSigningKey();
    const records = buildAuditExport(rows, {owner_ref: (await hash('audit:' + owner)).slice(0, 24), from, to, generated: new Date().toISOString(), account_retention_days: effectiveRetentionDays(fromRow(settings)), mode: await currentMode(owner), key_id: key?.kid ?? null}, sha, signRecord);
    await auditEvent(owner, 'audit.exported', {from, to: toDay, format, records: records.length});
    const text = format === 'csv' ? toCsv(records) : toJsonl(records), digest = sha(text);
    return new Response(text, {status: 200, headers: {'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8', 'Content-Disposition': `attachment; filename="scopeflow-audit-${from}-to-${toDay}.${format}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Scopeflow-Sha256': digest, 'X-Scopeflow-Signature': signRecord('scopeflow-audit-file-v1:' + digest) ?? ''}});
  } catch (e) { return failure(e); }
}
