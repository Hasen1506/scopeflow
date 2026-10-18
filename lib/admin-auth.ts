// Constant-time check of the operator token. SCOPEFLOW_ADMIN_TOKEN wins; otherwise SCOPEFLOW_CRON_SECRET.
// Shared by readiness, analytics and the heads route. Pure, so tests can import it without the database.

type Env = {SCOPEFLOW_ADMIN_TOKEN?: string; SCOPEFLOW_CRON_SECRET?: string};

export function adminAuthorized(request: Request, env?: Env) {
  const source = env ?? process.env;
  const expected = (source.SCOPEFLOW_ADMIN_TOKEN?.trim() || source.SCOPEFLOW_CRON_SECRET?.trim()) ?? '';
  const got = /^bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]?.trim() ?? '';
  if (expected.length < 16 || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
