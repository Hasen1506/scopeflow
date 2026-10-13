import {z} from 'zod';
import {json, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {loadLedger} from '@/lib/ledger-server';
import {projectFor} from '@/lib/invoice-api';
import {loadMsmeProfile, loadProfile, loadTerms, readSql, withProjectLock} from '@/lib/invoice-server';
import {normalizeTds, tdsInputSchema, TDS_BANNER, TDS_TABLE} from '@/lib/tds';
import {msmedClause, msmedWarnings, msmeProfileSchema, MSMED_DISCLAIMER, RATE_BASES, RBI_BANK_RATE} from '@/lib/msmed';
type Ctx = {params: Promise<{id: string}>};

// WS-03 invoicing terms of a project: the TDS the client deducts (H19, never defaulted), the MSMED
// written payment term and interest-rate basis (SF-07), and the owner's Udyam registration.
const termsSchema = z.object({
  tds: tdsInputSchema.nullable().optional(),
  msmed: z.object({agreed_days: z.number().int().min(1).max(45).nullable().optional(), rate_basis: z.enum(RATE_BASES).optional()}).strict().optional(),
  msme_profile: msmeProfileSchema.nullable().optional(),
}).strict();

async function state(id: string, owner: string) {
  const sql = readSql(), l = await loadLedger(id);
  const {raw} = await loadProfile(sql, owner);
  const terms = await loadTerms(sql, id, l.content), msme = await loadMsmeProfile(sql, owner, raw);
  return {
    tds: terms.tds, tds_banner: TDS_BANNER, tds_table: TDS_TABLE,
    msmed: {agreed_days: terms.msmed_agreed_days, rate_basis: terms.msmed_rate_basis, clause: msme && msme.category !== 'medium' ? msmedClause(msme, terms.msmed_agreed_days) : null, warnings: msmedWarnings({profile: msme, contract_date: l.baseline?.decided ?? null, agreed_days: terms.msmed_agreed_days}), bank_rates: RBI_BANK_RATE, disclaimer: MSMED_DISCLAIMER},
    msme_profile: msme,
  };
}

export async function GET(request: Request, ctx: Ctx) {
  try {
    const {id} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    if (!await allowRead('owner:' + p.auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    return json(await state(id, p.auth.user));
  } catch (e) { return failure(e); }
}

export async function PUT(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {id} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    if (!p.auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot change invoicing terms.'}, 403);
    if (!await allowWrite('owner:' + p.auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = termsSchema.safeParse(raw);
    if (!input.success) return json({error: input.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}, 400);
    const t = input.data, now = new Date().toISOString(), owner = p.auth.user;
    await withProjectLock(id, async tx => {
      if (t.tds !== undefined || t.msmed !== undefined) {
        const [cur] = await tx.unsafe('SELECT tds,msmed_agreed_days,msmed_rate_basis FROM scopeflow.invoice_terms WHERE project_id=$1', [id]);
        const tds = t.tds === undefined ? (cur?.tds ?? null) : t.tds === null ? null : JSON.stringify(normalizeTds(t.tds));
        const days = t.msmed?.agreed_days === undefined ? (cur?.msmed_agreed_days ?? null) : t.msmed.agreed_days;
        const basis = t.msmed?.rate_basis ?? cur?.msmed_rate_basis ?? 'on_due_date';
        await tx.unsafe('INSERT INTO scopeflow.invoice_terms (project_id,owner,tds,msmed_agreed_days,msmed_rate_basis,updated) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (project_id) DO UPDATE SET tds=EXCLUDED.tds,msmed_agreed_days=EXCLUDED.msmed_agreed_days,msmed_rate_basis=EXCLUDED.msmed_rate_basis,updated=EXCLUDED.updated', [id, owner, tds, days, basis, now]);
      }
      if (t.msme_profile === null) await tx.unsafe('DELETE FROM scopeflow.msme_profiles WHERE owner=$1', [owner]);
      else if (t.msme_profile) await tx.unsafe('INSERT INTO scopeflow.msme_profiles (owner,udyam_number,registered_on,category,updated) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (owner) DO UPDATE SET udyam_number=EXCLUDED.udyam_number,registered_on=EXCLUDED.registered_on,category=EXCLUDED.category,updated=EXCLUDED.updated', [owner, t.msme_profile.udyam_number, t.msme_profile.registered_on, t.msme_profile.category, now]);
    });
    return json(await state(id, owner));
  } catch (e) { return failure(e); }
}
