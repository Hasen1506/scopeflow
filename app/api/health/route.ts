import { getDatabase } from '@/db/client';
import { authConfigured, getAuth } from '@/lib/auth/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() {
  try {
    if (!authConfigured()) throw new Error('Auth configuration is missing');
    getAuth();
    if (process.env.RENDER && !process.env.APP_URL) throw new Error('APP_URL is required on Render');
    await getDatabase().prepare('SELECT id FROM projects LIMIT 1').all();
    return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
