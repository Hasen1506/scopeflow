import {json} from '@/lib/server';
export async function GET(){return json({service:'Scopeflow',version:'0.1.0',specification:'/api/openapi',documentation:'/connect',testing:'/reviewer-guide',billing:'not enabled',authentication:'Account-scoped bearer token for /api/scopes; sign in with ChatGPT to create a token.'});}
