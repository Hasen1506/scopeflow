// Plan tiers: the caps and rate limits each account works under, in one place instead of
// constants spread through the routes. The server runs one tier for every account
// (SCOPEFLOW_PLAN, default "beta"); each limit can be overridden with SCOPEFLOW_LIMIT_<NAME>.
// The Plans page shows the proposed paid tiers from the same table. Pure and isomorphic.

export type Limits = {
  /** Projects per account. */ projects: number;
  /** Versions per project. */ versions: number;
  /** Ledger entries per project. */ ledger_entries: number;
  /** Owner writes per minute (saves, ledger entries, settings). */ writes_per_minute: number;
  /** Owner reads per minute. */ reads_per_minute: number;
  /** AI drafts or radar checks per minute (fast tier). */ ai_per_minute: number;
  /** AI requests per minute on the careful tier. */ ai_careful_per_minute: number;
};
export type PlanId = 'beta' | 'free' | 'solo';
export type Plan = {id: PlanId; name: string; limits: Limits; price: {USD: number; INR: number; USD_year: number; INR_year: number}; proposed: boolean};

export const PLANS: Record<PlanId, Plan> = {
  beta: {id: 'beta', name: 'Early beta', proposed: false, price: {USD: 0, INR: 0, USD_year: 0, INR_year: 0},
    limits: {projects: 100, versions: 100, ledger_entries: 200, writes_per_minute: 30, reads_per_minute: 240, ai_per_minute: 10, ai_careful_per_minute: 4}},
  free: {id: 'free', name: 'Free', proposed: true, price: {USD: 0, INR: 0, USD_year: 0, INR_year: 0},
    limits: {projects: 1, versions: 25, ledger_entries: 100, writes_per_minute: 20, reads_per_minute: 120, ai_per_minute: 3, ai_careful_per_minute: 1}},
  solo: {id: 'solo', name: 'Solo', proposed: true, price: {USD: 4, INR: 299, USD_year: 36, INR_year: 2999},
    limits: {projects: 10, versions: 100, ledger_entries: 200, writes_per_minute: 30, reads_per_minute: 240, ai_per_minute: 10, ai_careful_per_minute: 4}},
};

type Env = Record<string, string | undefined>;
/** The tier this server enforces, with any per-limit overrides from the environment. */
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
export function limits(env: Env = process.env): Limits { return activePlan(env).limits; }
