import {db} from './server';
import {notify} from './notify';
import {chooseRoute, openSecret, partnerConfig, sealSecret, type AccountKind, type AccountPublic, type AccountSecret, type PaymentAccount, type PaymentRoute} from './payment-accounts';
import {razorpayConfig, refreshAccessToken, type RazorpayCredential} from './razorpay';
import {stripeConfig, type StripeConfig} from './stripe';

// Database side of the freelancer's payment accounts (C3, SF-20) and payment alerts (H6).

type Row = {id: string; owner: string; kind: AccountKind; status: 'active' | 'disconnected'; public: string; secret_enc: string | null; webhook_secret_box: string | null; created: string; updated: string};
const toAccount = (r: Row): PaymentAccount => ({id: r.id, owner: r.owner, kind: r.kind, status: r.status, public: JSON.parse(r.public || '{}') as AccountPublic, created: r.created, updated: r.updated});
const COLUMNS = 'id,owner,kind,status,public,secret_enc,webhook_secret_box,created,updated';
/**
 * The account's sealed secrets: API key / OAuth tokens in `secret_enc`, the webhook signing secret
 * in its own `webhook_secret_box` column (NULL = none, which readiness reports; WS-10).
 */
const secretsOf = (r: Pick<Row, 'secret_enc' | 'webhook_secret_box'>): AccountSecret => {
  const main = openSecret(r.secret_enc);
  const hook = r.webhook_secret_box ? openSecret(r.webhook_secret_box).webhook_secret : undefined;
  return {...main, ...(hook ? {webhook_secret: hook} : {})};
};

export async function ownerAccounts(owner: string, {all = false} = {}): Promise<PaymentAccount[]> {
  const rows = await db().prepare(`SELECT ${COLUMNS} FROM scopeflow.payment_accounts WHERE owner=?${all ? '' : " AND status='active'"} ORDER BY created`).bind(owner).all<Row>();
  return rows.results.map(toAccount);
}
async function accountRow(id: string) {
  return db().prepare(`SELECT ${COLUMNS} FROM scopeflow.payment_accounts WHERE id=?`).bind(id).first<Row>();
}
export async function accountById(id: string): Promise<PaymentAccount | null> {
  const r = await accountRow(id);
  return r ? toAccount(r) : null;
}
/** The decrypted secrets of an account (server only; never sent to a browser). */
export async function accountSecret(id: string): Promise<AccountSecret> {
  const r = await accountRow(id);
  return r ? secretsOf(r) : {};
}
export async function projectOwner(projectId: string) {
  return (await db().prepare('SELECT owner FROM projects WHERE id=?').bind(projectId).first<{owner: string}>())?.owner ?? null;
}
/** Where a payment in `currency` on `owner`'s project goes (lib/payment-accounts.ts chooseRoute). */
export async function routeForOwner(owner: string, currency: string): Promise<PaymentRoute> {
  return chooseRoute(await ownerAccounts(owner), currency);
}

/** Stores a new active account of `kind`, replacing (disconnecting) the previous active one. */
export async function saveAccount(owner: string, kind: AccountKind, pub: AccountPublic, secret: AccountSecret | null): Promise<PaymentAccount> {
  const now = new Date().toISOString(), id = 'pa_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  const {webhook_secret, ...rest} = secret ?? {};
  const sealed = secret && Object.values(rest).some(Boolean) ? sealSecret(rest) : null;
  const hookBox = webhook_secret ? sealSecret({webhook_secret}) : null;
  const database = db();
  await database.batch([
    database.prepare("UPDATE scopeflow.payment_accounts SET status='disconnected',disconnected_at=?,updated=? WHERE owner=? AND kind=? AND status='active'").bind(now, now, owner, kind),
    database.prepare('INSERT INTO scopeflow.payment_accounts (id,owner,kind,status,public,secret_enc,webhook_secret_box,created,updated) VALUES (?,?,?,?,?,?,?,?,?)').bind(id, owner, kind, 'active', JSON.stringify(pub), sealed, hookBox, now, now),
  ], {lock: 'scopeflow:owner:' + owner});
  return {id, owner, kind, status: 'active', public: pub, created: now, updated: now};
}
/**
 * Stops using an account for new charges. Its sealed secrets are kept (still needed to refund or
 * look up payments it already took); account deletion removes the row.
 */
export async function disconnectAccount(owner: string, id: string) {
  const now = new Date().toISOString();
  return !!await db().prepare("UPDATE scopeflow.payment_accounts SET status='disconnected',disconnected_at=?,updated=? WHERE id=? AND owner=? AND status='active' RETURNING id").bind(now, now, id, owner).first();
}

export type RazorpayDestination = {credential: RazorpayCredential; webhookSecret: string | null; signatureSecret: string | null; account: PaymentAccount | null; transferTo?: string};
/**
 * Credentials for a Razorpay call on behalf of `accountId` (null = the operator's own keys, for
 * orders created before accounts existed and for Route). OAuth access tokens are refreshed when
 * they expire within a minute.
 */
export async function razorpayFor(accountId: string | null): Promise<RazorpayDestination | null> {
  if (!accountId) {
    const op = razorpayConfig();
    return op ? {credential: op, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || null, signatureSecret: op.keySecret, account: null} : null;
  }
  const row = await accountRow(accountId);
  if (!row) return null;
  const account = toAccount(row), secret = secretsOf(row);
  if (account.kind === 'razorpay_keys' && account.public.key_id && secret.key_secret)
    return {credential: {keyId: account.public.key_id, keySecret: secret.key_secret}, webhookSecret: secret.webhook_secret ?? null, signatureSecret: secret.key_secret, account};
  if (account.kind === 'razorpay_oauth' && secret.access_token && account.public.public_token) {
    const partner = partnerConfig();
    let token = secret.access_token;
    if (partner && secret.refresh_token && account.public.token_expires && Date.parse(account.public.token_expires) - Date.now() < 60_000) {
      const fresh = await refreshAccessToken(partner, secret.refresh_token);
      token = fresh.access_token;
      const pub = {...account.public, public_token: fresh.public_token, token_expires: fresh.expires_at};
      await db().prepare('UPDATE scopeflow.payment_accounts SET public=?,secret_enc=?,updated=? WHERE id=?').bind(JSON.stringify(pub), sealSecret({access_token: fresh.access_token, refresh_token: fresh.refresh_token ?? secret.refresh_token}), new Date().toISOString(), accountId).run();
      account.public = pub;
    }
    return {credential: {accessToken: token, keyId: account.public.public_token!}, webhookSecret: secret.webhook_secret ?? partner?.webhookSecret ?? null, signatureSecret: partner?.clientSecret ?? null, account};
  }
  if (account.kind === 'razorpay_route' && account.public.linked_account_id) {
    const op = razorpayConfig();
    return op ? {credential: op, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || null, signatureSecret: op.keySecret, account, transferTo: account.public.linked_account_id} : null;
  }
  return null;
}
export type StripeDestination = {config: StripeConfig; webhookSecret: string | null; account: PaymentAccount | null};
/** Credentials for a Stripe call on behalf of `accountId` (null = the operator's key, legacy sessions only). */
export async function stripeFor(accountId: string | null): Promise<StripeDestination | null> {
  if (!accountId) {
    const op = stripeConfig();
    return op ? {config: op, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || null, account: null} : null;
  }
  const row = await accountRow(accountId);
  if (!row || row.kind !== 'stripe_keys') return null;
  const secret = secretsOf(row);
  return secret.secret_key ? {config: {secretKey: secret.secret_key}, webhookSecret: secret.webhook_secret ?? null, account: toAccount(row)} : null;
}

/**
 * Records something the owner must look at (H6, M20, H8, H14, L4) and tells them (WS-06 notify()).
 * `dedupe` makes repeated attempts for the same problem one alert. Never throws: an alert must not
 * hide the original failure.
 */
export async function raiseAlert(a: {project_id: string | null; kind: string; detail: Record<string, unknown>; dedupe?: string}) {
  try {
    const owner = a.project_id ? await projectOwner(a.project_id) : null;
    const row = await db().prepare('INSERT INTO scopeflow.payment_alerts (id,project_id,owner,kind,dedupe,detail,created) VALUES (?,?,?,?,?,?,?) ON CONFLICT (dedupe) WHERE dedupe IS NOT NULL DO NOTHING RETURNING id')
      .bind(crypto.randomUUID(), a.project_id, owner, a.kind, a.dedupe ?? null, JSON.stringify(a.detail), new Date().toISOString()).first<{id: string}>();
    if (row) await notify('payment_alert', {project_id: a.project_id ?? undefined, owner: owner ?? undefined, data: {kind: a.kind, ...a.detail}});
    console.warn('Scopeflow payment alert', JSON.stringify({kind: a.kind, project: a.project_id, ...a.detail}));
    return row?.id ?? null;
  } catch (e) {
    console.error('Scopeflow payment alert could not be stored', JSON.stringify({kind: a.kind, project: a.project_id, error: String(e)}));
    return null;
  }
}
