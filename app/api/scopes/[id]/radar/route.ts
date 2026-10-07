import {z} from 'zod';
import {db, json, owner, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {loadLedger} from '@/lib/ledger-server';
import {computeAgreement} from '@/lib/ledger';
import {llmConfig, llmStatus} from '@/lib/llm';
import {clausesOf, scopeRadar} from '@/lib/radar';
import type {Scope} from '@/lib/scope';
type Ctx = {params: Promise<{id: string}>};
const input = z.object({message: z.string().trim().min(5).max(4000)}).strict();
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
    const config = llmConfig();
    if (!await allowWrite((config ? 'radar-ai:' : 'radar:') + user, config ? 10 : 30)) return json({error: 'Too many checks. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return json({error: 'Paste the client’s request (5–4000 characters).'}, 400);
    const ledger = await loadLedger(id);
    let scope: Scope, agreement, basis: 'agreement' | 'latest_version';
    if (ledger.content && ledger.agreement && ledger.baseline) { scope = ledger.content; agreement = ledger.agreement; basis = 'agreement'; }
    else {
      const latest = await db().prepare('SELECT v.version,v.content FROM versions v JOIN projects p ON p.id=v.project_id AND p.latest=v.version WHERE p.id=?').bind(id).first<{version: number; content: string}>();
      if (!latest) return json({error: 'Project not found.'}, 404);
      scope = JSON.parse(latest.content) as Scope; agreement = computeAgreement(scope, latest.version, []); basis = 'latest_version';
    }
    const result = await scopeRadar(parsed.data.message, scope, agreement, {config});
    const status = llmStatus();
    return json({result, basis, clauses: clausesOf(scope, agreement), ai: {enabled: status.enabled, provider: status.provider}});
  } catch (e) { return failure(e); }
}
