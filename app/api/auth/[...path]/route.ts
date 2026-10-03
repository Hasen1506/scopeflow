import type { NextRequest } from 'next/server';
import { getAuth } from '@/lib/auth/server';
import { safeOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: NextRequest, context: Context) {
  if (!safeOrigin(request) || (request.method === 'POST' && !request.headers.get('origin'))) {
    return Response.json({ message: 'Origin not allowed.' }, { status: 403 });
  }
  try {
    const handler = getAuth().handler();
    return request.method === 'GET' ? handler.GET(request, context) : handler.POST(request, context);
  } catch {
    return Response.json({ message: 'Sign-in is temporarily unavailable. Please try again.' }, { status: 503 });
  }
}
export const GET = handle;
export const POST = handle;
