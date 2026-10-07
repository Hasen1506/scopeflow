import {json} from '@/lib/server';
import {VERSION} from '@/lib/version';
export async function GET(){return json({service:'Scopeflow',version:VERSION,specification:'/api/openapi',documentation:'/connect',testing:'/reviewer-guide',billing:'not enabled',authentication:'Account-scoped bearer token for /api/scopes; sign in to create a token. MCP clients can use OAuth 2.1 (see /.well-known/oauth-protected-resource).'});}
