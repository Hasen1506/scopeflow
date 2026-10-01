import {getChatGPTUser} from '@/app/chatgpt-auth';
import {json} from '@/lib/server';
export async function GET(){const user=await getChatGPTUser();return json({signedIn:!!user});}
