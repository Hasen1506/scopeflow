import {z} from 'zod';
import {limits} from '@/lib/plans';
import {db, json, owner, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {radarBasis} from '@/lib/radar-server';
import {embeddingConfig} from '@/lib/embeddings';
import {llmConfig, llmStatus} from '@/lib/llm';
import {clausesOf, scopeRadar} from '@/lib/radar';
type Ctx = {params: Promise<{id: string}>};
const input = z.object({message: z.string().trim().min(5).max(4000), quality: z.enum(['fast', 'careful']).default('fast')}).strict();
// PR E: scope-creep radar. Checks a pasted client request against the current agreement (or the
// latest version before approval) and cites the clause it rests on. Records nothing.
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const user = await owner(request);
    if (!user) return json({error: 'Sign in or provide a valid API token.'}, 401);
    const {id} = await ctx.params;
    const project = await db().prepare('SELECT id FROM projects WHERE id=? AND owner=?').bind(id, user).first();
    if (!project) return json({error: 'Project not found.'}, 404);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return json({error: 'Paste the client’s request (5–4000 characters).'}, 400);
    const config = llmConfig(process.env, parsed.data.quality), careful = !!config && parsed.data.quality === 'careful';
    if (!await allowWrite((careful ? 'radar-careful:' : config ? 'radar-ai:' : 'radar:') + user, careful ? limits().ai_careful_per_minute : config ? limits().ai_per_minute : 30)) return json({error: 'Too many checks. Try again in a minute.'}, 429);
    const found = await radarBasis(id);
    if (!found) return json({error: 'Project not found.'}, 404);
    const {scope, agreement, basis} = found;
    const result = await scopeRadar(parsed.data.message, scope, agreement, {config, embeddings: embeddingConfig()});
    const status = llmStatus();
    return json({result, basis, clauses: clausesOf(scope, agreement), ai: {enabled: status.enabled, provider: status.provider, model: config?.model ?? null, quality: config ? parsed.data.quality : null}, semantic: !!embeddingConfig()});
  } catch (e) { return failure(e); }
}
