import {z} from 'zod';
import {db, json, owner, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {payloadSchemas, checkEntry, verifyChain, paymentsOf, type Refund} from '@/lib/ledger';
import {loadLedger, appendEntry, LedgerConflict} from '@/lib/ledger-server';
type Ctx = {params: Promise<{id: string}>};

const ownerKinds = ['change_order', 'goodwill', 'revision_round', 'client_input', 'payment_received', 'refund', 'settle'] as const;
const requestSchema = z.object({
  kind: z.enum(ownerKinds),
  baseline_version: z.number().int().min(1),
  payload: z.unknown(),
  request_id: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/).optional(),
}).strict();

function unsalted(payload: string) { const {salt: _salt, ...rest} = JSON.parse(payload); return rest; }
async function ownedProject(request: Request, id: string) {
  const user = await owner(request);
  if (!user) return {error: json({error: 'Sign in or provide a valid API token.'}, 401)};
  const project = await db().prepare('SELECT id,archived FROM projects WHERE id=? AND owner=?').bind(id, user).first<{id: string; archived: string | null}>();
  if (!project) return {error: json({error: 'Project not found.'}, 404)};
  return {user, archived: !!project.archived};
}
async function view(id: string) {
  const ledger = await loadLedger(id);
  const seal = ledger.seal;
  const chain = await verifyChain(ledger.entries, ledger.anchors);
  const latest = ledger.baseline ? null : await db().prepare('SELECT version,status FROM versions v JOIN projects p ON p.id=v.project_id AND p.latest=v.version WHERE p.id=?').bind(id).first<{version: number; status: string}>();
  return {
    baseline: ledger.baseline && {version: ledger.baseline.version, signer: ledger.baseline.signer, decided: ledger.baseline.decided, content: ledger.content},
    open: !!ledger.baseline,
    reason: ledger.baseline ? null : latest?.status === 'pending' ? `Version ${latest.version} is awaiting the client. The ledger opens once it is approved.` : 'The ledger opens once the client approves the latest version.',
    agreement: ledger.agreement, entries: ledger.entries, chain, seal,
  };
}

export async function GET(request: Request, ctx: Ctx) {
  try {
    const {id} = await ctx.params;
    const access = await ownedProject(request, id);
    if (access.error) return access.error;
    if (!await allowRead('owner:' + access.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    return json(await view(id));
  } catch (e) { return failure(e); }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {id} = await ctx.params;
    const access = await ownedProject(request, id);
    if (access.error) return access.error;
    if (access.archived) return json({error: 'This project is archived. Restore it before adding to its ledger.', code: 'archived'}, 409);
    if (!await allowWrite('owner:' + access.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = requestSchema.safeParse(raw);
    if (!input.success) return json({error: 'Provide kind, baseline_version and payload.'}, 400);
    const {kind, baseline_version, request_id} = input.data;
    const parsed = payloadSchemas[kind].safeParse(input.data.payload);
    if (!parsed.success) return json({error: parsed.error.issues.map(i => `${i.path.join('.') || kind}: ${i.message}`).join('; ')}, 400);

    const ledger = await loadLedger(id);
    if (!ledger.baseline || !ledger.content || !ledger.agreement) return json({error: (await view(id)).reason}, 409);
    if (ledger.baseline.version !== baseline_version) return json({error: `The approved baseline is version ${ledger.baseline.version}. Read the agreement again before adding to it.`}, 409);

    const ref = kind === 'settle' ? 'settle:' + (parsed.data as {ref_seq: number}).ref_seq : request_id ? 'req:' + request_id : null;
    if (request_id && kind === 'settle') {
      // SF-14: a settle is keyed by the change order, not the request_id. Report an
      // already-settled change order as such instead of "request_id already used".
      const prior = await db().prepare('SELECT seq,actor,payload FROM ledger_entries WHERE project_id=? AND ref=?').bind(id, ref).first<{seq: number; actor: string; payload: string}>();
      if (prior) {
        if (prior.actor === 'owner' && prior.payload === JSON.stringify(parsed.data)) return json({replayed: true, seq: prior.seq, ...(await view(id))}, 200);
        return json({error: 'This change order has already been settled.'}, 409);
      }
    } else if (request_id) {
      const prior = await db().prepare('SELECT seq,kind,payload,baseline_version FROM ledger_entries WHERE project_id=? AND ref=?').bind(id, ref).first<{seq: number; kind: string; payload: string; baseline_version:number}>();
      if (prior) {
        if (prior.kind !== kind || prior.baseline_version !== baseline_version || JSON.stringify(unsalted(prior.payload)) !== JSON.stringify(parsed.data)) return json({error: 'That request_id was already used with different content or a different approved baseline.'}, 409);
        return json({replayed: true, seq: prior.seq, ...(await view(id))}, 200);
      }
    }
    const problem = checkEntry(kind, parsed.data, ledger.content, ledger.agreement, 'owner');
    // SF-11: hidden goodwill exposes only its payload hash to the client; a random salt
    // stops anyone confirming a guessed value or title against that hash.
    const stored = kind === 'goodwill' && (parsed.data as {visible: boolean}).visible === false ? {...(parsed.data as object), salt: crypto.randomUUID()} : parsed.data;
    if (problem) return json({error: problem}, kind === 'settle' && /already/.test(problem) ? 409 : 400);
    if (kind === 'refund') {
      const r = parsed.data as Refund;
      if (r.method === 'razorpay' || r.method === 'stripe' || r.provider_refund_id) return json({error: 'Refund an online payment with Refund on that payment, so the provider returns the money.'}, 400);
      const {paid} = paymentsOf(ledger.entries.filter(e => e.baseline_version === baseline_version));
      if (r.amount > paid + 0.005) return json({error: `A refund cannot be more than the ${paid.toFixed(2)} paid so far.`, code: 'refund_exceeds_paid'}, 400);
    }
    try {
      const entry = await appendEntry({baseline: ledger.baseline, expectedHead: ledger.head, kind, payload: stored, actor: 'owner', ref});
      return json({seq: entry.seq, ...(await view(id))}, 201);
    } catch (e) {
      if (e instanceof LedgerConflict) return json({error: e.message}, e.message.includes('supports') ? 429 : 409);
      throw e;
    }
  } catch (e) { return failure(e); }
}
