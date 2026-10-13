// Plan tiers: the caps and rate limits each account works under, in one place instead of
// constants spread through the routes. Pure and isomorphic.
//
// M13/SF-12 (WS-08): entitlements are per account. An account's plan comes from its
// accounts_plans row (ScopeFlow's own subscription billing, lib/billing.ts) through
// resolvePlan(); accounts without a row get the server default (SCOPEFLOW_PLAN, default "beta"),
// whose limits can be overridden with SCOPEFLOW_LIMIT_<NAME>. limits() with no owner is that
// server default, kept for callers that have no owner at hand (e.g. per-IP limits).
// The Plans page renders from the same PLANS table (L13).

export type Limits = {
  /** Active projects per account (archived and closed-account projects don't count, M12). */ projects: number;
  /** Versions per project. */ versions: number;
  /** Ledger entries per project. */ ledger_entries: number;
  /** Owner writes per minute (saves, ledger entries, settings). */ writes_per_minute: number;
  /** Owner reads per minute. */ reads_per_minute: number;
  /** AI drafts or radar checks per minute (fast tier). */ ai_per_minute: number;
  /** AI requests per minute on the careful tier. */ ai_careful_per_minute: number;
};
export type PlanId = 'beta' | 'free' | 'solo' | 'pro' | 'agency';
export type Price = {USD: number; INR: number; USD_year: number; INR_year: number};
export type Plan = {
  id: PlanId; name: string; limits: Limits; price: Price;
  /** Shown on the Plans page as a proposal (not purchasable). */ proposed: boolean;
  /** Can be bought from /plans (has a subscription checkout). */ purchasable: boolean;
  seats: number; features: readonly string[]; blurb: string;
};

export const PLANS: Record<PlanId, Plan> = {
  beta: {id: 'beta', name: 'Early beta', proposed: false, purchasable: false, seats: 1, price: {USD: 0, INR: 0, USD_year: 0, INR_year: 0}, blurb: 'Everything, free while ScopeFlow is in beta.', features: ['Every feature', 'Free client reviewing'],
    limits: {projects: 100, versions: 100, ledger_entries: 200, writes_per_minute: 30, reads_per_minute: 240, ai_per_minute: 10, ai_careful_per_minute: 4}},
  free: {id: 'free', name: 'Free', proposed: false, purchasable: false, seats: 1, price: {USD: 0, INR: 0, USD_year: 0, INR_year: 0}, blurb: 'For your first client scope.', features: ['Free client reviewing', 'Clear scope, revisions and decision history', 'Print or export your project'],
    limits: {projects: 1, versions: 25, ledger_entries: 100, writes_per_minute: 20, reads_per_minute: 120, ai_per_minute: 3, ai_careful_per_minute: 1}},
  // Kept as a ₹299 test arm only (plan §16.3); not offered on /plans.
  solo: {id: 'solo', name: 'Solo', proposed: true, purchasable: false, seats: 1, price: {USD: 4, INR: 299, USD_year: 36, INR_year: 2999}, blurb: 'A lower-priced test arm.', features: ['Invoices, statements and reminders'],
    limits: {projects: 10, versions: 100, ledger_entries: 200, writes_per_minute: 30, reads_per_minute: 240, ai_per_minute: 10, ai_careful_per_minute: 4}},
  pro: {id: 'pro', name: 'Pro', proposed: false, purchasable: true, seats: 1, price: {USD: 6, INR: 499, USD_year: 54, INR_year: 4499}, blurb: 'For a working freelancer or studio.', features: ['Invoices, GST tax invoices, statements and reminders', 'Change orders, rate card and retainers', 'API and ChatGPT connector access'],
    limits: {projects: 1000, versions: 200, ledger_entries: 1000, writes_per_minute: 60, reads_per_minute: 480, ai_per_minute: 15, ai_careful_per_minute: 6}},
  agency: {id: 'agency', name: 'Agency', proposed: false, purchasable: true, seats: 3, price: {USD: 18, INR: 1499, USD_year: 162, INR_year: 13499}, blurb: 'For a team of three with roles.', features: ['Everything in Pro', '3 seats with roles (owner, manager, member, finance)', 'Shared rate card and team activity'],
    limits: {projects: 5000, versions: 200, ledger_entries: 2000, writes_per_minute: 120, reads_per_minute: 960, ai_per_minute: 30, ai_careful_per_minute: 12}},
};
export const PURCHASABLE: readonly PlanId[] = (Object.keys(PLANS) as PlanId[]).filter(id => PLANS[id].purchasable);
export const isPlanId = (v: unknown): v is PlanId => typeof v === 'string' && Object.hasOwn(PLANS, v);
/** Days a halted (failed-payment) subscription keeps its plan before the account drops to Free. */
export const GRACE_DAYS = 7;

type Env = Record<string, string | undefined>;
/** The server default tier (accounts without a subscription), with per-limit overrides from the environment. */
export function activePlan(env: Env = process.env): Plan {
  const id = (env.SCOPEFLOW_PLAN?.trim().toLowerCase() || 'beta') as PlanId;
  const base = PLANS[id] ?? PLANS.beta;
  const limits = {...base.limits};
  for (const key of Object.keys(limits) as (keyof Limits)[]) {
    const n = Number(env['SCOPEFLOW_LIMIT_' + key.toUpperCase()]);
    if (Number.isInteger(n) && n >= 1 && n <= 100000) limits[key] = n;
  }
  return {...base, limits};
}
/** The server default limits. Per-account limits: limitsFor(owner) in lib/billing.ts. */
export function limits(env: Env = process.env): Limits { return activePlan(env).limits; }

export type PlanRow = {plan: string; status: string; period_end: string | null; grace_until: string | null};
export type PlanState = {plan: Plan; source: 'server_default' | 'subscription' | 'lapsed'; status: string | null; until: string | null};
/**
 * The plan an account is entitled to now. No row (or a checkout not completed yet): the server
 * default. Active: the plan, until 7 days past the paid period (a missed renewal webhook). Halted
 * (payment failed): the plan until grace_until (7 days), then Free. Cancelled: the plan until the
 * end of the paid period, then Free. Expired: Free. Pure.
 */
export function resolvePlan(row: PlanRow | null, now: number, env: Env = process.env): PlanState {
  const fallback = activePlan(env);
  if (!row || row.status === 'pending' || !isPlanId(row.plan)) return {plan: fallback, source: 'server_default', status: row?.status ?? null, until: null};
  const t = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
  const paid = PLANS[row.plan], lapsed: PlanState = {plan: PLANS.free, source: 'lapsed', status: row.status, until: null};
  switch (row.status) {
    case 'active': {
      const end = t(row.period_end);
      if (Number.isNaN(end) || now <= end + GRACE_DAYS * 86400_000) return {plan: paid, source: 'subscription', status: 'active', until: row.period_end};
      return lapsed;
    }
    case 'halted': return now < t(row.grace_until) ? {plan: paid, source: 'subscription', status: 'halted', until: row.grace_until} : lapsed;
    case 'cancelled': return now < t(row.period_end) ? {plan: paid, source: 'subscription', status: 'cancelled', until: row.period_end} : lapsed;
    default: return lapsed;
  }
}

/** The plan-limit message, matching the Plans page copy. */
export function projectCapMessage(l: Pick<Limits, 'projects'>) {
  return l.projects === 1
    ? 'Your plan includes 1 active project (archived ones don’t count). Archive or delete a project, or upgrade on the Plans page, to start another.'
    : `Your plan includes ${l.projects} active projects (archived ones don’t count). Archive or delete one, or upgrade on the Plans page, to start another.`;
}
/** "1 active project (archived ones don't count)" — the Plans page line for a cap (L13). */
export function projectCapLine(l: Pick<Limits, 'projects'>) {
  return l.projects === 1 ? '1 active project (archived ones don’t count)' : `${l.projects.toLocaleString('en-IN')} active projects (archived ones don’t count)`;
}

export type PlanCard = {id: PlanId; name: string; blurb: string; price: string; per: string | null; yearly: string | null; lines: string[]; purchasable: boolean; seats: number};
/**
 * L13: what the Plans page shows for each plan, derived only from PLANS (caps, prices, seats), so
 * the copy can never disagree with what is enforced. `money` formats an amount in `currency`. Pure.
 */
export function planCards(currency: 'INR' | 'USD', money: (n: number) => string, ids: readonly PlanId[] = ['free', 'pro', 'agency']): PlanCard[] {
  return ids.map(id => {
    const p = PLANS[id], monthly = currency === 'INR' ? p.price.INR : p.price.USD, year = currency === 'INR' ? p.price.INR_year : p.price.USD_year;
    return {id, name: p.name, blurb: p.blurb, purchasable: p.purchasable, seats: p.seats,
      price: money(monthly), per: monthly ? 'month' : null, yearly: year ? `or ${money(year)} a year` : null,
      lines: [projectCapLine(p.limits), `${p.limits.versions} versions per project`, p.seats > 1 ? `${p.seats} seats` : '1 seat', ...p.features]};
  });
}
