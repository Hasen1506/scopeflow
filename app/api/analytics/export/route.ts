import { db, json, failure } from '@/lib/server';
import { adminAuthorized } from '@/lib/readiness';
import { posthogConfig, posthogBatch, type EventRow } from '@/lib/analytics';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// SF-14: the daily cron (scripts/cron.mjs analytics) sends new events to PostHog (EU) when
// POSTHOG_KEY is set, in batches of 500, and purges events older than 400 days either way.
export async function POST(request: Request) {
  try {
    if (!adminAuthorized(request)) return json({ error: 'Operator token required.' }, 401);
    const purged = await db().prepare("DELETE FROM scopeflow.analytics_events WHERE created < now() - interval '400 days'").run();
    const config = posthogConfig();
    if (!config) return json({ exported: 0, purged: purged.meta.changes, export: 'off' });
    let exported = 0;
    for (let round = 0; round < 20; round++) {
      const rows = (await db().prepare('SELECT id, event, owner, project_id, props, created::text AS created FROM scopeflow.analytics_events WHERE exported IS NULL ORDER BY id LIMIT 500').all<EventRow>()).results;
      if (!rows.length) break;
      const r = await fetch(config.host + '/batch/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(posthogBatch(rows, config.key)), signal: AbortSignal.timeout(15000) });
      if (!r.ok) return json({ exported, purged: purged.meta.changes, error: `PostHog refused the batch (HTTP ${r.status}).` }, 502);
      await db().prepare(`UPDATE scopeflow.analytics_events SET exported=now() WHERE id IN (${rows.map(() => '?').join(',')})`).bind(...rows.map(x => x.id)).run();
      exported += rows.length;
    }
    return json({ exported, purged: purged.meta.changes, export: 'posthog' });
  } catch (e) { return failure(e); }
}
