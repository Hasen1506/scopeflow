import { authConfigured, getAuth } from '@/lib/auth/server';
import { health } from '@/lib/readiness';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// M30: Render's health check. 200 only when the database answers and, in production, records are
// signed with the dedicated key (C1). Optional integrations (mail, payments, AI, ...) never fail it:
// /api/readiness reports them.
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    if (!authConfigured()) return Response.json({ status: 'unavailable', reason: 'auth_not_configured' }, { status: 503, headers });
    getAuth();
    const h = await health();
    if (!h.ok) return Response.json({ status: 'unavailable', reason: h.reason, signing: h.signing }, { status: 503, headers });
    return Response.json({ status: 'ok', signing: h.signing }, { headers });
  } catch {
    return Response.json({ status: 'unavailable', reason: 'configuration' }, { status: 503, headers });
  }
}
