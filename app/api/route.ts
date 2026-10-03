import {json} from '@/lib/server';
export async function GET(){return json({service:'Scopeflow',version:'0.3.0',specification:'/api/openapi',documentation:'/connect',testing:'/reviewer-guide',billing:'not enabled',authentication:'Account-scoped bearer token for /api/scopes; sign in to create a token.'});}
