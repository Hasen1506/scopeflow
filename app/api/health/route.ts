import { getDatabase } from '@/db/client';
import { authConfigured, getAuth } from '@/lib/auth/server';
import { signingSource } from '@/lib/signing';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() {
  try {
    if (!authConfigured()) throw new Error('Auth configuration is missing');
    getAuth();
    await getDatabase().prepare('SELECT id FROM projects LIMIT 1').all();
    return Response.json({ status: 'ok', signing: signingSource() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
