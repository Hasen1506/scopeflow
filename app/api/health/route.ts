import { authConfigured, getAuth } from '@/lib/auth/server';
import { health } from '@/lib/readiness';
import firebaseConfig from '@/firebase-applet-config.json';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Health check: 200 when auth (Firebase or Neon) and the PostgreSQL database answer.
// Optional integrations (mail, payments, AI, dedicated signing secret) are reported in the body
// and via /api/readiness rather than failing Cloud Run startup probes.
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const hasNeonAuth = authConfigured();
    const hasFirebaseAuth = Boolean(firebaseConfig?.projectId && firebaseConfig?.apiKey);
    if (!hasNeonAuth && !hasFirebaseAuth) {
      return Response.json({ status: 'unavailable', reason: 'auth_not_configured' }, { status: 503, headers });
    }
    if (hasNeonAuth) getAuth();
    const h = await health();
    if (!h.database) {
      return Response.json({ status: 'unavailable', reason: h.reason ?? 'database_unreachable', signing: h.signing }, { status: 503, headers });
    }
    return Response.json(
      {
        status: 'ok',
        auth: hasNeonAuth ? 'neon' : 'firebase',
        signing: h.signing,
        ...(h.ok ? {} : { warning: h.reason }),
      },
      { headers },
    );
  } catch {
    return Response.json({ status: 'unavailable', reason: 'configuration' }, { status: 503, headers });
  }
}
