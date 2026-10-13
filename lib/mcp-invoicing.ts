// WS-03 (support for SF-26, owned by WS-10): MCP tool definitions for the WS-03 invoicing features,
// ready for WS-10 to register in lib/mcp.ts next to lib/mcp-money.ts (one import: invoicingTools,
// invoicingValidators, invoicingWriteTools, runInvoicingTool). Every tool goes through the same route
// a signed-in owner uses, so the cap (C2), the project lock and every validation apply unchanged.
// Writes need the user's confirmation and a request_id (the routes replay a repeated request_id).
// Identity fields (client email, GSTIN, address, review tokens) are removed from every result.
import {z} from 'zod';
import {GET as listInvoicesRoute} from '@/app/api/scopes/[id]/invoices/route';
import {POST as creditNoteRoute} from '@/app/api/scopes/[id]/credit-notes/route';
import {POST as tdsCreditRoute} from '@/app/api/scopes/[id]/invoices/[seq]/tds-credit/route';
import {GET as acceptanceRoute} from '@/app/api/scopes/[id]/acceptance/route';
import {asInternal, type Auth} from './server';
import {TDS_SECTIONS} from './tds';

const projectId = {type: 'string', minLength: 1, maxLength: 100};
const requestId = {type: 'string', pattern: '^[A-Za-z0-9_-]{8,120}$', description: 'Unique per action; reuse it when retrying the same action.'};
const confirmed = {type: 'boolean', const: true, description: 'true only after the user reviewed the exact values.'};
const outputSchema = {type: 'object', additionalProperties: true};
const readSchemes = [{type: 'oauth2', scopes: ['scopes:read']}];
const writeSchemes = [{type: 'oauth2', scopes: ['scopes:write']}];
const readonly = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
const writes = {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false};

/**
 * Extra properties for WS-10's issue_invoice tool (change request): the amount is the taxable value
 * unless includes_tax is true; TDS is never defaulted; a change order can be billed as its own line.
 */
export const issueInvoiceExtraProperties = {
  includes_tax: {type: 'boolean', description: 'true when the amount already includes GST. Default: the amount is the taxable value and GST is added on top.'},
  change_order_seq: {type: 'integer', minimum: 1, description: 'Bill an approved change order as its own line (amount defaults to its tax-inclusive total).'},
  tds: {type: ['object', 'null'], description: 'TDS the client will deduct, only when the user gives both the section and the rate. Never guess it.', properties: {section_2025: {type: 'string', enum: [...TDS_SECTIONS]}, rate_pct: {type: 'number', exclusiveMinimum: 0, maximum: 30}}, required: ['section_2025', 'rate_pct'], additionalProperties: false},
};

export const invoicingTools = [
  {name: 'invoicing_status', title: 'Read a project\'s invoicing position', description: 'For an approved project: what is still left to invoice (the cap), the invoices with their statuses (paid, paid net of TDS, part, open, cancelled), receipt vouchers for advances, credit notes, TDS certificates pending and the MSMED position (acceptance, due date, interest estimate). Amounts are in the agreement currency. Estimates of TDS and MSMED interest must be confirmed with a CA.', inputSchema: {type: 'object', properties: {project_id: projectId}, required: ['project_id'], additionalProperties: false}, outputSchema, annotations: readonly, securitySchemes: readSchemes},
  {name: 'issue_credit_note', title: 'Issue a credit note the user confirmed', description: 'Issue a credit note against an invoice, in full (cancels it, and the amount can be invoiced again) or in part. Credit note numbers are permanent: show the user the invoice, amount and reason and issue only after they confirm. Nothing is sent to the client.', inputSchema: {type: 'object', properties: {project_id: projectId, invoice_seq: {type: 'integer', minimum: 1}, amount: {type: 'number', exclusiveMinimum: 0, description: 'Tax-inclusive amount to credit; omit for the whole invoice.'}, reason: {type: 'string', minLength: 3, maxLength: 300}, request_id: requestId, user_confirmed: confirmed}, required: ['project_id', 'invoice_seq', 'reason', 'request_id', 'user_confirmed'], additionalProperties: false}, outputSchema, annotations: writes, securitySchemes: writeSchemes},
  {name: 'record_tds_credit', title: 'Record a TDS certificate', description: 'Record the TDS certificate (Form 16A, or Form 131 under the Income-tax Act 2025) the client issued for the TDS deducted on an invoice, which closes it. Pass the certificate number and quarter exactly as the user gives them.', inputSchema: {type: 'object', properties: {project_id: projectId, invoice_seq: {type: 'integer', minimum: 1}, amount: {type: 'number', exclusiveMinimum: 0}, certificate_no: {type: 'string', minLength: 3, maxLength: 40}, form: {type: 'string', enum: ['16A', '131']}, quarter: {type: 'string', pattern: '^Q[1-4] FY \\d{4}-\\d{2}$'}, received: {type: 'string', description: 'YYYY-MM-DD'}, user_confirmed: confirmed}, required: ['project_id', 'invoice_seq', 'amount', 'certificate_no', 'quarter', 'received', 'user_confirmed'], additionalProperties: false}, outputSchema, annotations: writes, securitySchemes: writeSchemes},
];

const id = z.string().min(1).max(100);
export const invoicingValidators = {
  invoicing_status: z.object({project_id: id}).strict(),
  issue_credit_note: z.object({project_id: id, invoice_seq: z.number().int().min(1), amount: z.number().positive().optional(), reason: z.string().trim().min(3).max(300), request_id: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/), user_confirmed: z.literal(true)}).strict(),
  record_tds_credit: z.object({project_id: id, invoice_seq: z.number().int().min(1), amount: z.number().positive(), certificate_no: z.string().trim().min(3).max(40), form: z.enum(['16A', '131']).optional(), quarter: z.string().regex(/^Q[1-4] FY \d{4}-\d{2}$/), received: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), user_confirmed: z.literal(true)}).strict(),
};
export const invoicingWriteTools = ['issue_credit_note', 'record_tds_credit'];

const IDENTITY = /^(?:client_email|client_gstin|client_address|email|gstin|address|phone|token|review_token)$/i;
export function withoutClientIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutClientIdentity);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !IDENTITY.test(k)).map(([k, v]) => [k, withoutClientIdentity(v)]));
  return value;
}
const ok = (data: unknown) => { const safe = withoutClientIdentity(data) as Record<string, unknown>; return {content: [{type: 'text', text: JSON.stringify(safe)}], structuredContent: safe}; };
const fail = (status: number, error: string, code?: string) => ({isError: true, content: [{type: 'text', text: error}], structuredContent: {status, error, ...(code ? {code} : {})}});

type Args = Record<string, unknown> & {project_id: string};
export async function runInvoicingTool(name: string, args: Args, _request: Request, auth: Auth) {
  const pid = args.project_id;
  const url = (path: string) => new URL(`/api/scopes/${encodeURIComponent(pid)}/${path}`, 'http://scopeflow.internal');
  const headers = {'Content-Type': 'application/json'};
  const ctx = {params: Promise.resolve({id: pid})};
  let r: Response;
  if (name === 'invoicing_status') {
    r = await listInvoicesRoute(asInternal(new Request(url('invoices'), {headers}), auth), ctx);
    const v = await r.json() as Record<string, unknown> & {error?: string; code?: string};
    if (!r.ok) return fail(r.status, v.error || 'Unable to read invoicing.', v.code);
    const acc = await acceptanceRoute(asInternal(new Request(url('acceptance'), {headers}), auth), ctx);
    return ok({...v, acceptance: acc.ok ? await acc.json() : null});
  }
  if (name === 'issue_credit_note') {
    const body = {invoice_seq: args.invoice_seq, reason: args.reason, request_id: args.request_id, ...(args.amount !== undefined ? {amount: args.amount} : {})};
    r = await creditNoteRoute(asInternal(new Request(url('credit-notes'), {method: 'POST', headers, body: JSON.stringify(body)}), auth), ctx);
  } else if (name === 'record_tds_credit') {
    const body = {amount: args.amount, certificate_no: args.certificate_no, form: args.form ?? '16A', quarter: args.quarter, received: args.received};
    r = await tdsCreditRoute(asInternal(new Request(url(`invoices/${args.invoice_seq}/tds-credit`), {method: 'POST', headers, body: JSON.stringify(body)}), auth), {params: Promise.resolve({id: pid, seq: String(args.invoice_seq)})});
  } else return fail(400, `Unknown tool ${name}.`);
  const v = await r.json() as Record<string, unknown> & {error?: string; code?: string};
  if (!r.ok) return fail(r.status, v.error || 'Unable to complete the action.', v.code);
  return ok({...v, note: 'Recorded. Nothing was sent to the client.'});
}
