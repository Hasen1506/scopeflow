import {getUser} from '@/lib/auth/server';
import {json, body, safeOrigin, failure} from '@/lib/server';
import {acceptInvite} from '@/lib/team';
import {z} from 'zod';

export async function POST(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const user = await getUser();
    if (!user) return json({error: 'Sign in to accept an invite.'}, 401);
    let raw; try { raw = await body(request); } catch { return json({error: 'Provide valid JSON.'}, 400); }
    const parsed = z.object({id: z.string().min(1).max(80)}).strict().safeParse(raw);
    if (!parsed.success) return json({error: 'Name the invite.'}, 400);
    const result = await acceptInvite(parsed.data.id, user.userId, user.email);
    if (!result.ok) return json(result.body, result.status);
    return json({account: result.account, role: result.role});
  } catch (e) { return failure(e); }
}
