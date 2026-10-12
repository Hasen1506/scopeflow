// SF-26: MCP tools for the money and retainer features (rate card, retainer usage, invoices,
// payments received). Each tool goes through the same route a signed-in owner uses, so every rule
// of that route applies unchanged (the invoice cap C2, archived projects, plan limits, the ledger's
// baseline check). Writes need the user's confirmation and a request_id, which is also the
// Idempotency-Key: a retried call returns the first reply instead of recording twice (M28).
// Identity fields (client email, phone, address, IP, user agent, review tokens) never leave here.
import {z} from 'zod';
import {GET as listInvoicesRoute, POST as issueInvoiceRoute} from '@/app/api/scopes/[id]/invoices/route';
import {POST as postLedger} from '@/app/api/scopes/[id]/ledger/route';
import {asInternal, db, type Auth} from '@/lib/server';
import {withIdempotency} from '@/lib/idempotency';

const projectId = {type: 'string', minLength: 1, maxLength: 100};
const requestId = {type: 'string', pattern: '^[A-Za-z0-9_-]{8,120}$', description: 'Unique per action; reuse it when retrying the same action.'};
const confirmed = {type: 'boolean', const: true, description: 'true only after the user reviewed the exact values.'};
const outputSchema = {type: 'object', additionalProperties: true};
const readSchemes = [{type: 'oauth2', scopes: ['scopes:read']}];
const writeSchemes = [{type: 'oauth2', scopes: ['scopes:write']}];
const readonly = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
const writes = {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false};
const PAYMENT_METHODS = ['bank_transfer', 'upi', 'card', 'cash', 'cheque', 'other'] as const;

export const moneyTools = [
  {name: 'list_rate_card', title: 'Read my rate card', description: 'List the priced items in the connected account\'s rate card (title, unit, unit price, currency, tax rate, tags). Use the item ids when drafting a change order or logging retainer usage. Returns an empty list when no rate card is set up.', inputSchema: {type: 'object', properties: {}, additionalProperties: false}, outputSchema, annotations: readonly, securitySchemes: readSchemes},
  {name: 'propose_retainer_usage', title: 'Log retainer usage', description: 'Record usage against a retainer project\'s current period (for example 1 extra post). Read get_agreement first and pass its baseline_version. When usage goes past the quota, Scopeflow proposes an overage change order at the rate-card price for the client to approve; nothing is charged. Show the user the item and quantity and get their confirmation first.', inputSchema: {type: 'object', properties: {project_id: projectId, baseline_version: {type: 'integer', minimum: 1}, item_id: {type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$'}, qty: {type: 'integer', minimum: 1, maximum: 1000}, note: {type: 'string', maxLength: 500}, request_id: requestId, user_confirmed: confirmed}, required: ['project_id', 'baseline_version', 'item_id', 'qty', 'request_id', 'user_confirmed'], additionalProperties: false}, outputSchema, annotations: writes, securitySchemes: writeSchemes},
  {name: 'list_invoices', title: 'List a project\'s invoices', description: 'List the invoices issued for a project (number, amount, currency, issue and due date, status) and its payment schedule with what is already invoiced per milestone. Client contact details are not included.', inputSchema: {type: 'object', properties: {project_id: projectId}, required: ['project_id'], additionalProperties: false}, outputSchema, annotations: readonly, securitySchemes: readSchemes},
  {name: 'issue_invoice', title: 'Issue an invoice the user confirmed', description: 'Issue the next numbered invoice for an approved project: an amount, or a payment milestone of the approved scope. Invoice numbers are permanent, so show the user the amount (with tax), description and due days and issue only after they confirm. The server refuses amounts beyond what is still to be invoiced. Nothing is sent to the client.', inputSchema: {type: 'object', properties: {project_id: projectId, amount: {type: 'number', exclusiveMinimum: 0}, milestone_id: {type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$'}, description: {type: 'string', maxLength: 200}, due_days: {type: 'integer', minimum: 0, maximum: 120}, request_id: requestId, user_confirmed: confirmed}, required: ['project_id', 'request_id', 'user_confirmed'], additionalProperties: false}, outputSchema, annotations: writes, securitySchemes: writeSchemes},
  {name: 'record_payment_received', title: 'Record a payment the user received', description: 'Record on the project ledger a payment the user says arrived outside Scopeflow (bank transfer, UPI, cash...). It does not move money. Pass the approved baseline_version from get_agreement, the amount, method and the date it arrived; confirm the values with the user first.', inputSchema: {type: 'object', properties: {project_id: projectId, baseline_version: {type: 'integer', minimum: 1}, amount: {type: 'number', exclusiveMinimum: 0}, method: {type: 'string', enum: [...PAYMENT_METHODS]}, received: {type: 'string', description: 'YYYY-MM-DD'}, reference: {type: 'string', maxLength: 80}, note: {type: 'string', maxLength: 500}, request_id: requestId, user_confirmed: confirmed}, required: ['project_id', 'baseline_version', 'amount', 'method', 'received', 'request_id', 'user_confirmed'], additionalProperties: false}, outputSchema, annotations: writes, securitySchemes: writeSchemes},
];

const id = z.string().min(1).max(100);
const rid = z.string().regex(/^[A-Za-z0-9_-]{8,120}$/);
export const moneyValidators = {
  list_rate_card: z.object({}).strict(),
  propose_retainer_usage: z.object({project_id: id, baseline_version: z.number().int().min(1), item_id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), qty: z.number().int().min(1).max(1000), note: z.string().max(500).optional(), request_id: rid, user_confirmed: z.literal(true)}).strict(),
  list_invoices: z.object({project_id: id}).strict(),
  issue_invoice: z.object({project_id: id, amount: z.number().positive().optional(), milestone_id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(), description: z.string().max(200).optional(), due_days: z.number().int().min(0).max(120).optional(), request_id: rid, user_confirmed: z.literal(true)}).strict(),
  record_payment_received: z.object({project_id: id, baseline_version: z.number().int().min(1), amount: z.number().positive(), method: z.enum(PAYMENT_METHODS), received: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().max(80).optional(), note: z.string().max(500).optional(), request_id: rid, user_confirmed: z.literal(true)}).strict(),
};
export const moneyWriteTools = ['propose_retainer_usage', 'issue_invoice', 'record_payment_received'];

/** Keys that identify the client (or carry secrets) and are removed from every tool result. */
const IDENTITY = /^(?:client_email|client_phone|client_address|email|phone|to|ip|user_agent|token|review_token|decision_context|context|otp_session|session_hash|code_hash)$/i;
export function withoutIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIdentity);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !IDENTITY.test(k)).map(([k, v]) => [k, withoutIdentity(v)]));
  return value;
}

const ok = (data: unknown) => { const safe = withoutIdentity(data) as Record<string, unknown>; return {content: [{type: 'text', text: JSON.stringify(safe)}], structuredContent: safe}; };
const fail = (status: number, error: string, code?: string) => ({isError: true, content: [{type: 'text', text: error}], structuredContent: {status, error, ...(code ? {code} : {})}});

async function rateCard(owner: string) {
  // WS-05 owns rate_cards (migration 0018). Until that table exists the card is empty.
  const present = await db().prepare("SELECT to_regclass('scopeflow.rate_cards') IS NOT NULL AS present").first<{present: boolean}>();
  if (!present?.present) return {items: [], available: false};
  const rows = (await db().prepare('SELECT * FROM scopeflow.rate_cards WHERE owner=?').bind(owner).all<Record<string, unknown>>()).results;
  const items = rows.flatMap(r => (r.items !== undefined ? (typeof r.items === 'string' ? JSON.parse(r.items) : r.items) as Record<string, unknown>[] : [r]));
  const pick = (i: Record<string, unknown>) => Object.fromEntries(['id', 'title', 'unit', 'unit_price_minor', 'unit_price', 'currency', 'tax_pct', 'tags', 'multipliers'].filter(k => i[k] !== undefined).map(k => [k, i[k]]));
  return {items: items.map(pick), available: true};
}

type Args = Record<string, unknown> & {project_id?: string; request_id?: string};
export async function runMoneyTool(name: string, args: Args, _request: Request, auth: Auth) {
  if (name === 'list_rate_card') return ok(await rateCard(auth.user));
  const pid = args.project_id!;
  const context = {params: Promise.resolve({id: pid})};
  const base = (path: string) => new URL(`/api/scopes/${encodeURIComponent(pid)}/${path}`, 'http://scopeflow.internal');
  const headers = {'Content-Type': 'application/json'};
  if (name === 'list_invoices') {
    const r = await listInvoicesRoute(asInternal(new Request(base('invoices'), {headers}), auth), context);
    const v = await r.json() as {error?: string; code?: string};
    return r.ok ? ok(v) : fail(r.status, v.error || 'Unable to list invoices.', v.code);
  }
  // Writes: request_id doubles as the Idempotency-Key for the MCP call itself.
  const call = new Request('http://scopeflow.internal/mcp', {method: 'POST', headers: {'Idempotency-Key': args.request_id!}});
  const reply = await withIdempotency(call, `mcp:${name}:${auth.user}:${pid}`, args, async () => {
    let r: Response;
    if (name === 'issue_invoice') {
      const payload = {...(args.amount !== undefined ? {amount: args.amount} : {}), ...(args.milestone_id ? {milestone_id: args.milestone_id} : {}), ...(args.description !== undefined ? {description: args.description} : {}), ...(args.due_days !== undefined ? {due_days: args.due_days} : {}), request_id: args.request_id};
      r = await issueInvoiceRoute(asInternal(new Request(base('invoices'), {method: 'POST', headers, body: JSON.stringify(payload)}), auth), context);
    } else {
      const entry = name === 'record_payment_received'
        ? {kind: 'payment_received', payload: {amount: args.amount, method: args.method, received: args.received, reference: args.reference ?? '', note: args.note ?? ''}}
        : {kind: 'usage', payload: {item_id: args.item_id, qty: args.qty, note: args.note ?? ''}};
      r = await postLedger(asInternal(new Request(base('ledger'), {method: 'POST', headers, body: JSON.stringify({...entry, baseline_version: args.baseline_version, request_id: args.request_id})}), auth), context);
    }
    const text = await r.text();
    return new Response(text, {status: r.status, headers: {'Content-Type': 'application/json'}});
  });
  const value = await reply.json() as Record<string, unknown> & {error?: string; code?: string; seq?: number; invoice?: unknown; replayed?: boolean};
  const replayed = reply.headers.get('Idempotency-Replayed') === 'true' || !!value.replayed;
  if (!reply.ok) {
    if (name === 'propose_retainer_usage' && reply.status === 400) return fail(400, value.error || 'Retainer usage is not enabled on this server yet.', 'retainer_unavailable');
    return fail(reply.status, value.error || 'Unable to complete the action.', value.code);
  }
  if (name === 'issue_invoice') return ok({invoice: value.invoice, replayed, note: 'Issued. The invoice is in the Scopeflow workspace; nothing was sent to the client.'});
  return ok({seq: value.seq, replayed, recorded: name === 'record_payment_received' ? 'payment_received' : 'usage', note: name === 'record_payment_received' ? 'Recorded on the ledger. No money moved.' : 'Usage recorded for the current period.'});
}
