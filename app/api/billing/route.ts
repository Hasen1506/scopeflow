import {db, json, ownerAuth, allowRead, failure} from '@/lib/server';
import {billingStatus, planRowFor, planStateFor} from '@/lib/billing';
import {PLANS, PURCHASABLE, projectCapLine} from '@/lib/plans';
// M13/SF-12: this account's plan, what it allows, whether paid plans can be bought here, and
// ScopeFlow's invoices to this account.
export async function GET(request: Request) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const [state, row, invoices] = await Promise.all([planStateFor(auth.user), planRowFor(auth.user), db().prepare('SELECT id,number,amount_minor,currency,issued,provider FROM billing_invoices WHERE owner=? ORDER BY seq DESC LIMIT 50').bind(auth.user).all()]);
    return json({
      plan: {id: state.plan.id, name: state.plan.name, limits: state.plan.limits, cap: projectCapLine(state.plan.limits), source: state.source, status: state.status, until: state.until},
      subscription: row && row.status !== 'pending' ? {plan: row.plan, status: row.status, period_end: row.period_end, grace_until: row.grace_until, provider: row.provider, interval: row.interval} : null,
      checkout_pending: row?.status === 'pending',
      billing: billingStatus(),
      plans: PURCHASABLE.map(id => ({id, name: PLANS[id].name, price: PLANS[id].price, limits: PLANS[id].limits, seats: PLANS[id].seats})),
      invoices: invoices.results,
    });
  } catch (e) { return failure(e); }
}
