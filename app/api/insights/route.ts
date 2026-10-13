import {db, json, owner, failure} from '@/lib/server';
import {computeAgreement, paymentsOf, type LedgerEntry} from '@/lib/ledger';
import {computeInsights, filterOptions, filterProjects, insightsCsv, mergeBaselines, RBI_BANK_RATE_PCT, type InsightsFilter, type InvoiceFact, type ProjectAgreement} from '@/lib/insights';
import {totals} from '@/lib/money';
import type {Scope} from '@/lib/scope';

// Patterns across the account's approved agreements. Read-only; private to the owner.
// SF-16 (WS-09): every approved baseline of a project is folded (a supersede no longer drops earlier change
// orders, goodwill or payments), plus payments, invoices and radar catches for the money/flow figures.
// Query: period=all|month|12m|fy, client=<name>, currency=<code>, format=csv.
export async function GET(request: Request) {
  try {
    const user = await owner(request);
    if (!user) return json({error: 'Sign in or provide a valid API token.'}, 401);
    const database = db();
    const [baselines, rows, invoices, inbound] = await Promise.all([
      database.prepare("SELECT v.project_id,v.version,v.content,v.decided FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.owner=? AND v.status='approved' ORDER BY v.project_id,v.version").bind(user).all<{project_id: string; version: number; content: string; decided: string | null}>(),
      database.prepare('SELECT e.project_id,e.seq,e.kind,e.baseline_version,e.actor,e.payload,e.created FROM ledger_entries e JOIN projects p ON p.id=e.project_id WHERE p.owner=? ORDER BY e.project_id,e.seq').bind(user).all<{project_id: string; seq: number; kind: LedgerEntry['kind']; baseline_version: number; actor: LedgerEntry['actor']; payload: string; created: string}>(),
      database.prepare('SELECT project_id,seq,amount,issued,content FROM invoices WHERE owner=?').bind(user).all<{project_id: string; seq: number; amount: number; issued: string; content: string}>(),
      database.prepare('SELECT m.project_id,m.status,m.radar FROM inbound_messages m JOIN projects p ON p.id=m.project_id WHERE p.owner=?').bind(user).all<{project_id: string; status: string; radar: string | null}>(),
    ]);
    const byProject = new Map<string, LedgerEntry[]>();
    for (const r of rows.results) {
      const list = byProject.get(r.project_id) ?? [];
      // Hashes are irrelevant to aggregation; computeAgreement only folds payloads.
      list.push({seq: r.seq, kind: r.kind, baseline_version: r.baseline_version, actor: r.actor, created: r.created, payload: JSON.parse(r.payload), payload_hash: '', prev_hash: '', hash: ''});
      byProject.set(r.project_id, list);
    }
    const invoicesBy = new Map<string, InvoiceFact[]>();
    for (const i of invoices.results) {
      let c: {due?: string; agreement?: {paid_before?: number}} = {};
      try { c = JSON.parse(i.content); } catch { /* an unreadable snapshot counts as due on issue */ }
      const list = invoicesBy.get(i.project_id) ?? [];
      list.push({seq: i.seq, total: i.amount, issued: i.issued, due: c.due || i.issued.slice(0, 10), paid_before: c.agreement?.paid_before ?? 0});
      invoicesBy.set(i.project_id, list);
    }
    const radarBy = new Map<string, {catches: number; acted: number}>();
    for (const m of inbound.results) {
      let verdict = '';
      try { verdict = m.radar ? String(JSON.parse(m.radar).verdict ?? '') : ''; } catch { /* unreadable radar result */ }
      if (verdict !== 'out_of_scope') continue;
      const r = radarBy.get(m.project_id) ?? {catches: 0, acted: 0};
      r.catches++; if (m.status === 'done') r.acted++;
      radarBy.set(m.project_id, r);
    }
    const versionsBy = new Map<string, typeof baselines.results>();
    for (const b of baselines.results) versionsBy.set(b.project_id, [...(versionsBy.get(b.project_id) ?? []), b]);
    const all: ProjectAgreement[] = [...versionsBy.entries()].map(([projectId, versions]) => {
      const entries = byProject.get(projectId) ?? [];
      const folded = versions.map(v => ({content: JSON.parse(v.content) as Scope, agreement: computeAgreement(JSON.parse(v.content) as Scope, v.version, entries.filter(e => e.baseline_version === v.version))}));
      const content = folded[folded.length - 1].content, agreement = mergeBaselines(folded.map(f => f.agreement));
      return {
        project_id: projectId, title: content.title, client: content.client, agreement,
        approved_at: versions[0].decided ?? undefined, tax_pct: content.tax_pct ?? 0, total: totals(content, agreement.fee).total,
        payments: paymentsOf(entries).lines.map(l => ({date: l.received, amount: l.amount})),
        invoices: invoicesBy.get(projectId) ?? [],
        msmed_days: content.msmed ? content.msmed.agreed_days ?? 15 : null,
        tds: !!content.tds, fx_inr: content.fx?.currency === 'INR' ? content.fx.rate : null,
        radar: radarBy.get(projectId) ?? {catches: 0, acted: 0},
      };
    });
    const url = new URL(request.url), today = new Date().toISOString().slice(0, 10);
    const period = url.searchParams.get('period');
    const filter: InsightsFilter = {period: period === 'month' || period === '12m' || period === 'fy' ? period : 'all', client: url.searchParams.get('client') ?? undefined, currency: url.searchParams.get('currency') ?? undefined};
    const rate = Number(process.env.SCOPEFLOW_RBI_BANK_RATE_PCT);
    const insights = computeInsights(filterProjects(all, filter, today), {today, bankRatePct: rate > 0 && rate < 50 ? rate : RBI_BANK_RATE_PCT});
    if (url.searchParams.get('format') === 'csv') return new Response(insightsCsv(insights), {headers: {'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="scopeflow-insights-${today}.csv"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
    return json({...insights, filter, options: filterOptions(all)});
  } catch (e) { return failure(e); }
}
