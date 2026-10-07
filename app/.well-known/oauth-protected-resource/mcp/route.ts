import {protectedResourceMetadata, oauthJson, corsHeaders} from '@/lib/oauth';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return oauthJson(protectedResourceMetadata(request), 200, {'Cache-Control': 'public, max-age=300'}); }
export function OPTIONS() { return new Response(null, {status: 204, headers: corsHeaders}); }
