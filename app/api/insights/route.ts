import {db, json, owner, failure} from '@/lib/server';
import {computeAgreement, type LedgerEntry} from '@/lib/ledger';
import {computeInsights} from '@/lib/insights';
import type {Scope} from '@/lib/scope';

// Patterns across the account's approved agreements. Read-only; private to the owner.
export async function GET(request: Request) {
  try {
    const user = await owner(request);
    if (!user) return json({error: 'Sign in or provide a valid API token.'}, 401);
    const database = db();
    const [baselines, rows] = await Promise.all([
      database.prepare("SELECT v.project_id,v.version,v.content FROM versions v JOIN projects p ON p.id=v.project_id AND p.latest=v.version WHERE p.owner=? AND v.status='approved'").bind(user).all<{project_id: string; version: number; content: string}>(),
      database.prepare('SELECT e.project_id,e.seq,e.kind,e.baseline_version,e.actor,e.payload,e.created FROM ledger_entries e JOIN projects p ON p.id=e.project_id WHERE p.owner=? ORDER BY e.project_id,e.seq').bind(user).all<{project_id: string; seq: number; kind: LedgerEntry['kind']; baseline_version: number; actor: LedgerEntry['actor']; payload: string; created: string}>(),
    ]);
    const byProject = new Map<string, LedgerEntry[]>();
    for (const r of rows.results) {
      const list = byProject.get(r.project_id) ?? [];
      // Hashes are irrelevant to aggregation; computeAgreement only folds payloads.
      list.push({seq: r.seq, kind: r.kind, baseline_version: r.baseline_version, actor: r.actor, created: r.created, payload: JSON.parse(r.payload), payload_hash: '', prev_hash: '', hash: ''});
      byProject.set(r.project_id, list);
    }
    const agreements = baselines.results.map(b => {
      const content = JSON.parse(b.content) as Scope;
      const entries = (byProject.get(b.project_id) ?? []).filter(e => e.baseline_version === b.version);
      return {project_id: b.project_id, title: content.title, client: content.client, agreement: computeAgreement(content, b.version, entries)};
    });
    return json(computeInsights(agreements));
  } catch (e) { return failure(e); }
}
