import {tokens} from './check';
import type {ChangeOrder} from './ledger';
import {db} from './server';
import {loadLedger} from './ledger-server';
import {computeAgreement, type Agreement} from './ledger';
import type {Scope} from './scope';

/** What the radar checks a request against: the current agreement after approval, else the latest version. */
export async function radarBasis(projectId: string): Promise<{scope: Scope; agreement: Agreement; basis: 'agreement' | 'latest_version'} | null> {
  const ledger = await loadLedger(projectId);
  if (ledger.content && ledger.agreement && ledger.baseline) return {scope: ledger.content, agreement: ledger.agreement, basis: 'agreement'};
  const latest = await db().prepare('SELECT v.version,v.content FROM versions v JOIN projects p ON p.id=v.project_id AND p.latest=v.version WHERE p.id=?').bind(projectId).first<{version: number; content: string}>();
  if (!latest) return null;
  const scope = JSON.parse(latest.content) as Scope;
  return {scope, agreement: computeAgreement(scope, latest.version, []), basis: 'latest_version'};
}

// ---- WS-06: prices for drafted change orders (SF-03, SF-04) ------------------------------------
// A drafted change order is prefilled with a price from the owner's rate card (WS-05's
// scopeflow.rate_cards, once it exists in the database) or, failing that, from the owner's own
// price history: the latest priced deliverable with the same words in another of their scopes.
// The owner always reviews the price before proposing; nothing is recorded here.

export type PriceSuggestion = {unit_price: number; currency: string; source: 'rate_card' | 'price_history'; matched: string; tax_pct?: number};
type RateRow = {title: string; unit?: string; unit_price_minor?: number; unit_price?: number; currency?: string; tax_pct?: number; tags?: string[]};
const minorDigits = (currency: string) => { try { return new Intl.NumberFormat('en', {style: 'currency', currency}).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; } };
const score = (want: Set<string>, text: string) => { const t = tokens(text); let n = 0; for (const w of want) if (t.has(w)) n++; return n; };

let rateTable: boolean | null = null;
async function rateCardItems(owner: string): Promise<RateRow[]> {
  try {
    if (rateTable === null) rateTable = !!(await db().prepare("SELECT to_regclass('scopeflow.rate_cards') IS NOT NULL AS ok").first<{ok: boolean}>())?.ok;
    if (!rateTable) return [];
    const row = await db().prepare('SELECT items FROM scopeflow.rate_cards WHERE owner=?').bind(owner).first<{items: string}>();
    const items = row ? JSON.parse(row.items) : [];
    return Array.isArray(items) ? items.filter((i): i is RateRow => !!i && typeof i.title === 'string') : [];
  } catch { return []; }
}

/** The best price for an item title in `currency`, or null. */
export async function suggestPrice(owner: string, title: string, currency: string, excludeProject?: string): Promise<PriceSuggestion | null> {
  const want = tokens(title);
  if (!want.size) return null;
  const card = (await rateCardItems(owner)).filter(i => !i.currency || i.currency === currency)
    .map(i => ({i, n: score(want, [i.title, i.unit ?? '', ...(i.tags ?? [])].join(' '))})).filter(x => x.n > 0).sort((a, b) => b.n - a.n)[0];
  if (card) {
    const price = typeof card.i.unit_price_minor === 'number' ? card.i.unit_price_minor / 10 ** minorDigits(currency) : Number(card.i.unit_price ?? NaN);
    if (Number.isFinite(price) && price >= 0) return {unit_price: price, currency, source: 'rate_card', matched: card.i.title, ...(typeof card.i.tax_pct === 'number' ? {tax_pct: card.i.tax_pct} : {})};
  }
  const rows = await db().prepare(`SELECT v.content FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.owner=? AND p.id<>? ORDER BY v.created DESC LIMIT 200`).bind(owner, excludeProject ?? '').all<{content: string}>();
  for (const r of rows.results) {
    let s: Scope; try { s = JSON.parse(r.content) as Scope; } catch { continue; }
    if (s.currency !== currency) continue;
    const hit = (s.items ?? []).filter(i => typeof i.price === 'number' && i.price > 0).map(i => ({i, n: score(want, i.title + ' ' + i.unit)})).filter(x => x.n > 0).sort((a, b) => b.n - a.n)[0];
    if (hit) return {unit_price: hit.i.price!, currency, source: 'price_history', matched: hit.i.title};
  }
  return null;
}

/** The change order with each unpriced new item priced, and fee_delta set when it was zero. */
export async function priceChangeOrder(owner: string, co: Partial<ChangeOrder>, currency: string, projectId?: string): Promise<{change_order: Partial<ChangeOrder>; prices: (PriceSuggestion & {item_id: string})[]}> {
  const prices: (PriceSuggestion & {item_id: string})[] = [];
  const add = await Promise.all((co.add_items ?? []).map(async item => {
    if (typeof item.price === 'number') return item;
    const p = await suggestPrice(owner, item.title, currency, projectId);
    if (!p) return item;
    prices.push({...p, item_id: item.id});
    return {...item, price: p.unit_price};
  }));
  const fee = add.reduce((a, i) => a + (typeof i.price === 'number' ? i.price * i.qty : 0), 0);
  return {change_order: {...co, add_items: add, ...(!co.fee_delta && fee ? {fee_delta: Math.round(fee * 100) / 100} : {})}, prices};
}
