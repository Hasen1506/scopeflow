import {getUser} from '@/lib/auth/server';
import {json} from '@/lib/server';
export async function GET(){const user=await getUser();return json({signedIn:!!user});}
