import { json, failure, readLimiter } from '@/lib/server';
import { readiness, adminAuthorized } from '@/lib/readiness';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// M30: everything /api/health deliberately ignores, for the operator (Authorization: Bearer
// SCOPEFLOW_ADMIN_TOKEN, or SCOPEFLOW_CRON_SECRET when no admin token is set). Never returns secrets.
export async function GET(request: Request) {
  try {
    if (!adminAuthorized(request)) return json({ error: 'Send the operator token as a bearer credential.' }, 401, { 'WWW-Authenticate': 'Bearer realm="scopeflow-readiness"' });
    const report = await readiness();
    // Compact form for dashboards: {mail: "off", signing: "ok", ...} next to the details.
    return json({ ...report, summary: Object.fromEntries(Object.entries(report.checks).map(([k, v]) => [k, v.status])) });
  } catch (e) { return failure(e); }
}

// Test servers only (APP_URL on localhost): the operator clears this instance's in-memory read
// windows, as tests/run-local.mjs clears the rate_limits table between suites, so one suite's reads
// never throttle the next (M26 moved read limits out of the database). 404 everywhere else.
export async function DELETE(request: Request) {
  try {
    let local = false;
    try { local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.APP_URL ?? '').hostname); } catch { local = false; }
    if (!local || new URL(request.url).searchParams.get('scope') !== 'read-limits') return json({ error: 'Not found.' }, 404);
    if (!adminAuthorized(request)) return json({ error: 'Send the operator token as a bearer credential.' }, 401);
    const cleared = readLimiter().size();
    readLimiter().clear();
    return json({ ok: true, cleared });
  } catch (e) { return failure(e); }
}
