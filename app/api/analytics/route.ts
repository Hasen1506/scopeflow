import { db, json, body, safeOrigin, ownerAuth, failure } from '@/lib/server';
import { adminAuthorized } from '@/lib/readiness';
import { analyticsEnabled, FUNNEL } from '@/lib/analytics';
export const dynamic = 'force-dynamic';

async function counts(owner: string | null, days: number) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = await db().prepare(`SELECT event, COUNT(*) AS n, COUNT(DISTINCT owner) AS owners, COUNT(DISTINCT project_id) AS projects FROM scopeflow.analytics_events WHERE created >= ?::timestamptz${owner ? ' AND owner=?' : ''} GROUP BY event`).bind(...(owner ? [since, owner] : [since])).all<{ event: string; n: number; owners: number; projects: number }>();
  return FUNNEL.map(event => { const r = rows.results.find(x => x.event === event); return { event, count: Number(r?.n ?? 0), owners: Number(r?.owners ?? 0), projects: Number(r?.projects ?? 0) }; });
}

// SF-14. Operator (admin token): funnel counts across all accounts. Signed-in owner: their own counts
// and whether they opted out. ?days=1..365 (default 30).
export async function GET(request: Request) {
  try {
    const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 30));
    if (adminAuthorized(request)) return json({ enabled: analyticsEnabled(), days, funnel: analyticsEnabled() ? await counts(null, days) : [] });
    const auth = await ownerAuth(request); if (!auth || auth.via !== 'session') return json({ error: 'Sign in to see your analytics settings.' }, 401);
    const opted = await db().prepare('SELECT 1 AS x FROM scopeflow.analytics_opt_out WHERE owner=?').bind(auth.user).first();
    return json({ enabled: analyticsEnabled(), opted_out: !!opted, days, funnel: await counts(auth.user, days) });
  } catch (e) { return failure(e); }
}

// Owner opt-out: {opt_out: true} stops recording and deletes the account's events; false resumes.
export async function PATCH(request: Request) {
  try {
    if (!safeOrigin(request)) return json({ error: 'Origin not allowed.' }, 403);
    const auth = await ownerAuth(request); if (!auth || auth.via !== 'session') return json({ error: 'Sign in on the Scopeflow website.' }, 401);
    let raw: unknown; try { raw = await body(request); } catch { return json({ error: 'Provide valid JSON.' }, 400); }
    const optOut = (raw as { opt_out?: unknown })?.opt_out;
    if (typeof optOut !== 'boolean') return json({ error: 'Send {"opt_out": true} or {"opt_out": false}.', code: 'invalid_input', fields: { opt_out: 'Choose on or off.' } }, 400);
    if (optOut) await db().batch([
      db().prepare('INSERT INTO scopeflow.analytics_opt_out (owner, created) VALUES (?, ?) ON CONFLICT (owner) DO NOTHING').bind(auth.user, new Date().toISOString()),
      db().prepare('DELETE FROM scopeflow.analytics_events WHERE owner=?').bind(auth.user),
    ]);
    else await db().prepare('DELETE FROM scopeflow.analytics_opt_out WHERE owner=?').bind(auth.user).run();
    return json({ opted_out: optOut });
  } catch (e) { return failure(e); }
}
