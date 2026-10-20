// Plan tiers: the caps, prices and feature gates each account works under.
// Pure and isomorphic. The Plans page, checkout and the route checks all read this table.
//
// Entitlements are per account. An account's plan comes from its accounts_plans row
// (lib/billing.ts) through resolvePlan(). Accounts without a row get the server default
// (SCOPEFLOW_PLAN, default "beta"), whose limits can be overridden with SCOPEFLOW_LIMIT_<NAME>.

export type FeatureGate = 'ai' | 'api' | 'reminders' | 'retainers' | 'team';
export const FEATURE_GATES: readonly FeatureGate[] = ['ai', 'api', 'reminders', 'retainers', 'team'];

export type Limits = {
  /** Active projects per account (archived and closed-account projects don't count). */ projects: number;
  /** Distinct client names across active projects. */ clients: number;
  /** People on the account, including the owner. */ seats: number;
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
  /** List price for the founding cohort. Null when this plan has no founding price. */
  founding: Price | null;
  /** Shown on the Plans page as a proposal (not purchasable). */ proposed: boolean;
  /** Can be bought from /plans (has a subscription checkout). */ purchasable: boolean;
  seats: number; blurb: string;
  /** Enforced for this plan and listed on its card. Shared features live in ALL_PLANS_INCLUDE. */
  features: readonly string[];
  /** Gates this plan may use. allows() is the check the routes call. */
  gates: readonly FeatureGate[];
  /** Announced but not built. Empty once a feature ships. */
  soon?: readonly string[];
};

/** What every plan includes, including Free. These are not repeated on the cards. */
export const ALL_PLANS_INCLUDE: readonly string[] = [
  'Free client reviewing',
  'Clear scope, revisions and decision history',
  'Change orders and a personal rate card',
  'Invoices, GST tax invoices and statements',
  'Print or export your project',
  'Approval certificate (name, time, IP, browser, content hash and seal)',
  'Optional one-time code before a client decides (off unless you turn it on)',
];

const freelancerFeatures = [
  'AI drafting from a brief',
  'API token and AI assistants',
  'Automatic invoice reminders',
  'Retainer engagements',
] as const;
const studioFeatures = [
  ...freelancerFeatures,
  'Studio roles for manager, member and finance',
  'Shared rate card',
  'Team activity',
] as const;
const paidGates: readonly FeatureGate[] = ['ai', 'api', 'reminders', 'retainers'];
const allGates: readonly FeatureGate[] = [...paidGates, 'team'];

const rates = (writes: number, reads: number, ai: number, careful: number) => ({
  writes_per_minute: writes, reads_per_minute: reads, ai_per_minute: ai, ai_careful_per_minute: careful,
});

export const PLANS: Record<PlanId, Plan> = {
  beta: {
    id: 'beta', name: 'Early beta', proposed: false, purchasable: false, seats: 5, founding: null, features: [], gates: allGates,
    price: {USD: 0, INR: 0, USD_year: 0, INR_year: 0},
    blurb: 'Everything, free while Scopeflow is in early beta.',
    limits: {projects: 100, clients: 200, seats: 5, versions: 100, ledger_entries: 200, ...rates(30, 240, 10, 4)},
  },
  free: {
    id: 'free', name: 'Free', proposed: false, purchasable: false, seats: 1, founding: null, features: [], gates: [],
    price: {USD: 0, INR: 0, USD_year: 0, INR_year: 0},
    blurb: 'A working freelance practice: a few live jobs, client review, invoices and a certificate.',
    limits: {projects: 3, clients: 8, seats: 1, versions: 20, ledger_entries: 40, ...rates(20, 120, 3, 1)},
  },
  // Kept as a lower-priced test arm only; not offered on /plans.
  solo: {
    id: 'solo', name: 'Solo', proposed: true, purchasable: false, seats: 1, features: [...freelancerFeatures], gates: paidGates,
    price: {USD: 4, INR: 299, USD_year: 40, INR_year: 2990}, founding: null,
    blurb: 'A lower-priced test arm, not on the Plans page.',
    limits: {projects: 8, clients: 20, seats: 1, versions: 40, ledger_entries: 80, ...rates(30, 240, 10, 4)},
  },
  pro: {
    id: 'pro', name: 'Freelancer', proposed: false, purchasable: true, seats: 1, features: [...freelancerFeatures], gates: paidGates,
    price: {USD: 9, INR: 799, USD_year: 90, INR_year: 7990},
    founding: {USD: 5, INR: 399, USD_year: 50, INR_year: 3990},
    blurb: 'For one freelancer who drafts with an assistant, reminds clients and runs retainers.',
    limits: {projects: 15, clients: 40, seats: 1, versions: 50, ledger_entries: 200, ...rates(60, 480, 15, 6)},
  },
  agency: {
    id: 'agency', name: 'Studio', proposed: false, purchasable: true, seats: 5, features: [...studioFeatures], gates: allGates,
    price: {USD: 29, INR: 2499, USD_year: 290, INR_year: 24990},
    founding: {USD: 15, INR: 1299, USD_year: 150, INR_year: 12990},
    blurb: 'For a small studio: five people, a shared rate card and a record of who did what.',
    limits: {projects: 40, clients: 120, seats: 5, versions: 80, ledger_entries: 400, ...rates(120, 960, 30, 12)},
  },
};

export const PURCHASABLE: readonly PlanId[] = (Object.keys(PLANS) as PlanId[]).filter(id => PLANS[id].purchasable);
export const isPlanId = (v: unknown): v is PlanId => typeof v === 'string' && Object.hasOwn(PLANS, v);
/** Days a halted (failed-payment) subscription keeps its plan before the account drops to Free. */
export const GRACE_DAYS = 7;

/** First paid Freelancer or Studio subscriptions started on or before this instant. */
export const FOUNDING_SEATS = 100;
export const FOUNDING_DEADLINE = '2027-06-30T23:59:59.999Z';
export const FOUNDING_DEADLINE_MS = Date.parse(FOUNDING_DEADLINE);
/** How long the founding price stays while the subscription remains active (or halted inside grace). */
export const FOUNDING_LOCK_MONTHS = 24;

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
  return {...base, limits, seats: limits.seats};
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

/** True when this plan may use the gate. Beta (the server default) allows every gate. */
export function allows(plan: Plan | PlanId, gate: FeatureGate): boolean {
  const p = typeof plan === 'string' ? PLANS[plan] : plan;
  return p.gates.includes(gate);
}

const FEATURE_COPY: Record<FeatureGate, string> = {
  ai: 'AI drafting is included on Freelancer and Studio.',
  api: 'API tokens and AI assistants are included on Freelancer and Studio.',
  reminders: 'Automatic reminders are included on Freelancer and Studio.',
  retainers: 'Retainer engagements are included on Freelancer and Studio.',
  team: 'Team seats, a shared rate card and team activity are included on Studio.',
};
/** The refusal a route returns when the account's plan does not include a gate. */
export function featureDenied(gate: FeatureGate) {
  return {error: FEATURE_COPY[gate] + ' See the Plans page to upgrade.', code: 'plan_feature' as const, feature: gate};
}

/** A new founding subscription can still start: fewer than 100 taken, and now is on or before the deadline. */
export function foundingOpen(taken: number, now: number): boolean {
  return Number.isInteger(taken) && taken >= 0 && taken < FOUNDING_SEATS && now <= FOUNDING_DEADLINE_MS;
}
/** UTC calendar months after `ms`, clamped to the last day of the destination month. */
export function addMonthsUtc(ms: number, months: number): string {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}
/** When a founding price that starts at `startMs` stops being the locked rate. */
export function foundingUntil(startMs: number): string {
  return addMonthsUtc(startMs, FOUNDING_LOCK_MONTHS);
}

export type Interval = 'month' | 'year';
export type CurrencyCode = 'INR' | 'USD';
/** Major units (rupees or dollars) for a plan. Yearly is ten times monthly (two months free). */
export function listPrice(plan: PlanId, interval: Interval, currency: CurrencyCode, founding = false): number {
  const p = PLANS[plan];
  const src = founding && p.founding ? p.founding : p.price;
  return currency === 'INR' ? (interval === 'year' ? src.INR_year : src.INR) : (interval === 'year' ? src.USD_year : src.USD);
}
/** Minor units (paise or cents) charged for one period. */
export function chargeMinor(plan: PlanId, interval: Interval, currency: CurrencyCode, founding = false): number {
  return listPrice(plan, interval, currency, founding) * 100;
}

/** The plan-limit message, matching the Plans page copy. */
export function projectCapMessage(l: Pick<Limits, 'projects'>) {
  return l.projects === 1
    ? 'Your plan includes 1 active project (archived ones don’t count). Archive or delete a project, or upgrade on the Plans page, to start another.'
    : `Your plan includes ${l.projects} active projects (archived ones don’t count). Archive or delete one, or upgrade on the Plans page, to start another.`;
}
/** Distinct client names on active projects. `already` is true when this name is already one of them. */
export function clientCapError(distinct: number, already: boolean, l: Pick<Limits, 'clients'>): string | null {
  if (already || distinct < l.clients) return null;
  return l.clients === 1
    ? 'Your plan includes 1 client. Archive that project, or upgrade on the Plans page, to add another.'
    : `Your plan includes ${l.clients} clients. Archive a project, or upgrade on the Plans page, to add another.`;
}
/** `used` counts the owner plus invited and active members. Inviting needs a free seat. */
export function seatCapError(used: number, l: Pick<Limits, 'seats'>): string | null {
  if (used < l.seats) return null;
  return l.seats === 1
    ? 'Your plan includes 1 seat (just you). Studio is the plan that adds people.'
    : `Your plan includes ${l.seats} seats, including you. Revoke someone, or upgrade on the Plans page, to invite another.`;
}
/**
 * The per-project version cap, checked against the OWNER's limits (limitsFor(owner)).
 * `latest` is the newest version number. Returns the refusal message, or null. Pure.
 */
export function versionCapError(latest: number, l: Pick<Limits, 'versions'>): string | null {
  return latest >= l.versions ? `Your plan supports up to ${l.versions} versions per project.` : null;
}
/** The per-project record-entry cap for owner-authored entries, from the owner's limits. Pure. */
export function ledgerCapError(count: number, l: Pick<Limits, 'ledger_entries'>): string | null {
  return count >= l.ledger_entries ? `Your plan supports ${l.ledger_entries} ledger entries per project.` : null;
}
/** "1 active project (archived ones don't count)" — the Plans page line for a cap. */
export function projectCapLine(l: Pick<Limits, 'projects'>) {
  return l.projects === 1 ? '1 active project (archived ones don’t count)' : `${l.projects.toLocaleString('en-IN')} active projects (archived ones don’t count)`;
}
export function clientLine(n: number) {
  return n === 1 ? '1 client' : `${n.toLocaleString('en-IN')} clients`;
}
export function seatLine(n: number) {
  return n === 1 ? '1 seat (just you)' : `${n.toLocaleString('en-IN')} seats (owner, manager, member, finance)`;
}

export type PlanCard = {
  id: PlanId; name: string; blurb: string; price: string; per: string | null; yearly: string | null;
  founding: string | null; foundingYearly: string | null;
  lines: string[]; soon: string[]; purchasable: boolean; seats: number;
};
/**
 * What the Plans page shows for each plan, derived only from PLANS, so the copy cannot
 * disagree with what is enforced. `money` formats an amount in `currency`. Pure.
 * `showFounding` adds the founding price while seats remain and the deadline has not passed.
 */
export function planCards(currency: 'INR' | 'USD', money: (n: number) => string, ids: readonly PlanId[] = ['free', 'pro', 'agency'], showFounding = false): PlanCard[] {
  return ids.map(id => {
    const p = PLANS[id], monthly = currency === 'INR' ? p.price.INR : p.price.USD, year = currency === 'INR' ? p.price.INR_year : p.price.USD_year;
    const fMonthly = p.founding ? (currency === 'INR' ? p.founding.INR : p.founding.USD) : 0;
    const fYear = p.founding ? (currency === 'INR' ? p.founding.INR_year : p.founding.USD_year) : 0;
    const offer = showFounding && p.founding;
    return {id, name: p.name, blurb: p.blurb, purchasable: p.purchasable, seats: p.seats,
      price: money(monthly), per: monthly ? 'month' : null, yearly: year ? `or ${money(year)} a year` : null,
      founding: offer ? money(fMonthly) : null,
      foundingYearly: offer ? `or ${money(fYear)} a year, locked for 24 months` : null,
      lines: [projectCapLine(p.limits), clientLine(p.limits.clients), seatLine(p.seats), `${p.limits.versions} versions per project`, `${p.limits.ledger_entries.toLocaleString('en-IN')} record entries per project`, ...p.features],
      soon: [...(p.soon ?? [])]};
  });
}

/**
 * The one story /plans tells about accounts without a subscription, in visitor words.
 * While the default is a free beta tier, it says so and explains that the Free card is
 * what applies after the beta. Pure.
 */
export function defaultPlanNote(fallback: Plan, shown: readonly PlanId[] = ['free', 'pro', 'agency']): {title: string; body: string} | null {
  if (shown.includes(fallback.id)) return null;
  const l = fallback.limits, caps = `${projectCapLine(l)}, ${l.versions} versions and ${l.ledger_entries} record entries per project`;
  if (fallback.id === 'beta') return {title: 'Free during the early beta',
    body: `While Scopeflow is in early beta, every account gets ${caps}, free, with no subscription. The Free plan below is what an account without a paid plan gets once the beta ends; we’ll tell you before that happens.`};
  return {title: `Included without a subscription: ${fallback.name}`, body: `Every account without a paid plan gets ${caps}.`};
}
