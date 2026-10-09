import {randomUUID} from 'node:crypto';
import {db, json, ownerAuth, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {loadLedger} from '@/lib/ledger-server';
import {paymentsOf} from '@/lib/ledger';
import {totals} from '@/lib/money';
import {profileFromRow, type ProfileRow} from '@/lib/profile';
import {invoiceContent, invoiceNumber, invoiceProblem, invoiceRequestSchema, type InvoiceContent} from '@/lib/invoice';
import {zoneOrUtc} from '@/lib/time';
type Ctx = {params: Promise<{id: string}>};
type InvoiceRow = {id: string; seq: number; number: string; version: number; amount: number; currency: string; issued: string; content: string};
const view = (r: InvoiceRow) => { const c = JSON.parse(r.content) as InvoiceContent; return {seq: r.seq, number: r.number, version: r.version, amount: r.amount, currency: r.currency, issued: c.issued, due: c.due, description: c.line.description}; };

async function project(request: Request, id: string) {
  const auth = await ownerAuth(request);
  if (!auth) return {error: json({error: 'Sign in or provide a valid API token.'}, 401)};
  const row = await db().prepare('SELECT id,archived,client_email,timezone FROM projects WHERE id=? AND owner=?').bind(id, auth.user).first<{id: string; archived: string | null; client_email: string | null; timezone: string | null}>();
  if (!row) return {error: json({error: 'Project not found.'}, 404)};
  return {auth, row};
}

// Invoices for a project's approved agreement: list them, or issue the next one.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {id} = await ctx.params;
    const p = await project(request, id);
    if (p.error) return p.error;
    if (!await allowRead('owner:' + p.auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const rows = await db().prepare('SELECT id,seq,number,version,amount,currency,issued,content FROM invoices WHERE project_id=? AND owner=? ORDER BY seq').bind(id, p.auth.user).all<InvoiceRow>();
    return json({invoices: rows.results.map(view)});
  } catch (e) { return failure(e); }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {id} = await ctx.params;
    const p = await project(request, id);
    if (p.error) return p.error;
    const {auth, row} = p;
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot issue invoices.'}, 403);
    if (row.archived) return json({error: 'This project is archived. Restore it before issuing an invoice.', code: 'archived'}, 409);
    if (!await allowWrite('owner:' + auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = invoiceRequestSchema.safeParse(raw);
    if (!input.success) return json({error: input.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}, 400);
    const req = input.data;
    if (req.request_id) {
      const existing = await db().prepare('SELECT id,seq,number,version,amount,currency,issued,content FROM invoices WHERE owner=? AND request_id=?').bind(auth.user, req.request_id).first<InvoiceRow>();
      if (existing) return json({invoice: view(existing), replayed: true});
    }
    const profile = profileFromRow(await db().prepare('SELECT * FROM business_profiles WHERE owner=?').bind(auth.user).first<ProfileRow>());
    if (!profile.business_name) return json({error: 'Add your business name in Data controls (Business details) first: it is printed on the invoice.', code: 'profile_required'}, 409);
    const l = await loadLedger(id);
    if (!l.baseline || !l.content || !l.agreement) return json({error: 'Invoices are issued once the client approves the scope.', code: 'not_approved'}, 409);
    const t = totals(l.content, l.agreement.fee);
    const {paid} = paymentsOf(l.entries.filter(e => e.baseline_version === l.baseline!.version));
    const balance = Math.round(Math.max(0, t.total - paid) * 100) / 100;
    const problem = invoiceProblem(req.amount, balance, l.agreement.currency);
    if (problem) return json({error: problem, code: 'invalid_amount', balance}, 400);
    const issued = new Intl.DateTimeFormat('en-CA', {timeZone: zoneOrUtc(row.timezone), year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
    // Take the next number and insert the invoice in one statement: numbers never skip or repeat.
    const draft = (seq: number) => invoiceContent({
      number: invoiceNumber(profile.invoice_prefix, seq), issued, due_days: req.due_days, description: req.description, amount: req.amount,
      seller: {name: profile.business_name, address: profile.business_address, tax_id: profile.tax_id, payment_details: profile.payment_details},
      client: {name: l.content!.client, email: row.client_email ?? ''}, project: {id, title: l.content!.title, version: l.baseline!.version},
      currency: l.agreement!.currency, tax_label: t.tax_label, tax_pct: t.tax_pct, agreed_total: t.total, paid, payment_terms: l.content!.payment_terms ?? profile.default_payment_terms,
    });
    // The content embeds the number, so it is built for the sequence the counter is about to hand out and checked after.
    const next = await db().prepare('SELECT next_invoice FROM business_profiles WHERE owner=?').bind(auth.user).first<{next_invoice: number}>();
    const seq = next?.next_invoice ?? 1, content = draft(seq);
    const inserted = await db().prepare(`WITH n AS (UPDATE business_profiles SET next_invoice=next_invoice+1 WHERE owner=? AND next_invoice=? RETURNING next_invoice-1 AS seq)
      INSERT INTO invoices (id,owner,project_id,seq,number,version,amount,currency,issued,request_id,content) SELECT ?,?,?,n.seq,?,?,?,?,?,?,? FROM n RETURNING id,seq,number,version,amount,currency,issued,content`)
      .bind(auth.user, seq, randomUUID(), auth.user, id, content.number, l.baseline.version, content.total, content.currency, new Date().toISOString(), req.request_id ?? null, JSON.stringify(content)).first<InvoiceRow>();
    if (!inserted) return json({error: 'Another invoice was issued at the same moment. Try again.', code: 'conflict'}, 409);
    return json({invoice: view(inserted)}, 201);
  } catch (e) { return failure(e); }
}
