// WS-08 end to end against the local production build, the local auth fixture and the disposable
// scopeflow_test database: workspace modes, onboarding defaults, per-account plans and ScopeFlow's
// own billing (local Razorpay double), account deletion that keeps the client's record, the 180-day
// retention default, GSTIN/UPI validation and the signed audit export. Fictional data only.
import assert from 'node:assert/strict';
import {createHash, createHmac, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {signIn, ack, requireLocalDatabase} from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
requireLocalDatabase();
let passed = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); passed++; };
const ok = (v, message) => { assert.ok(v, message); passed++; };
async function call(path, {method = 'GET', cookie, body, headers = {}} = {}) {
  const h = {Origin: base, ...headers};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)});
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data, headers: r.headers};
}
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const ownerOf = async projectId => (await one('SELECT owner FROM scopeflow.projects WHERE id=$1', [projectId])).owner;
const fresh = name => signIn(base, `ws08-${name}-${randomUUID()}@example.test`);
const scope = (title, extra = {}) => ({title: 'TEST ' + title + ' ' + randomUUID().slice(0, 6), client: 'Kaveri Foods', deliverables: 'Packaging design', exclusions: '', fee: 10000, currency: 'INR', revisions: 1, due: '', notes: '', ...extra});
const approve = async token => eq((await call('/api/review/' + token, {method: 'POST', body: await ack(base, token, {decision: 'approved', signer: 'Fictional Client', comment: '', version: 1})})).status, 200);
const job = () => { const r = spawnSync(process.execPath, ['scripts/redact-expired.mjs'], {encoding: 'utf8', env: process.env}); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout.trim().split('\n').pop()); };

// ---- LT-04 / SF-11 / LT-17: onboarding defaults (India → INR, Asia/Kolkata, UPI, GSTIN, Udyam) ----------
// @covers LT-04 SF-11 LT-17
{
  const cookie = await fresh('onboarding');
  const before = await call('/api/me', {cookie});
  eq([before.data.defaults.onboarded, before.data.defaults.currency_set, before.data.defaults.mode], [false, false, 'freelancer']);
  const setup = {mode: 'freelancer', country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata', business_name: 'TEST Ada Studio', upi_vpa: 'ada.studio@okaxis', gstin: '33ABCDE1234F1Z7', udyam_number: 'udyam-tn-02-0012345', udyam_date: '2024-05-01', udyam_category: 'micro', tax_label: 'GST', tax_pct: 18, payment_terms: 'Payment within 45 days of acceptance.'};
  // LT-17: a GSTIN with a wrong check character or state is refused (400 invalid_gstin); so is a malformed VPA.
  const badGstin = await call('/api/profile/onboarding', {method: 'POST', cookie, body: {...setup, gstin: 'TEST25AABCP1234Z1'}});
  eq([badGstin.status, badGstin.data.code], [400, 'invalid_gstin']);
  eq((await call('/api/profile/onboarding', {method: 'POST', cookie, body: {...setup, gstin: '33ABCDE1234F1Z5'}})).data.code, 'invalid_gstin');
  eq((await call('/api/profile/onboarding', {method: 'POST', cookie, body: {...setup, upi_vpa: 'not a vpa'}})).status, 400);
  eq((await call('/api/profile/onboarding', {method: 'POST', body: setup})).status, 401);
  const done = await call('/api/profile/onboarding', {method: 'POST', cookie, body: setup});
  eq(done.status, 200, JSON.stringify(done.data));
  eq([done.data.profile.default_currency, done.data.profile.upi_vpa, done.data.profile.tax_id, done.data.profile.gst_state, done.data.profile.udyam_number, done.data.profile.udyam_category], ['INR', 'ada.studio@okaxis', '33ABCDE1234F1Z7', '33', 'UDYAM-TN-02-0012345', 'micro']);
  ok(done.data.upi_link.startsWith('upi://pay?pa=ada.studio%40okaxis'), done.data.upi_link);
  // R: GET /api/me defaults to INR (and the account's zone) after onboarding.
  const me = await call('/api/me', {cookie});
  eq([me.data.defaults.currency, me.data.defaults.timezone, me.data.defaults.country, me.data.defaults.onboarded], ['INR', 'Asia/Kolkata', 'IN', true]);
  // A scope sent without a currency starts in the owner's currency; the project starts in the account's zone (LT-16).
  const {currency: _drop, ...noCurrency} = scope('Onboarded');
  const created = await call('/api/scopes', {method: 'POST', cookie, body: noCurrency});
  eq(created.status, 201, JSON.stringify(created.data));
  eq(created.data.scope.content.currency, 'INR');
  eq((await one('SELECT timezone FROM scopeflow.projects WHERE id=$1', [created.data.scope.project_id])).timezone, 'Asia/Kolkata');
  // LT-17 in Account: the same GSTIN rule on the business profile.
  const profile = (await call('/api/profile', {cookie})).data.profile;
  const refused = await call('/api/profile', {method: 'PUT', cookie, body: {...profile, tax_id: 'TEST25AABCP1234Z1', gst_state: '33'}});
  eq([refused.status, refused.data.code], [400, 'invalid_gstin']);
  eq((await call('/api/profile', {method: 'PUT', cookie, body: {...profile, tax_id: '27AAPFU0939F1ZV', gst_state: '33'}})).data.code, 'invalid_gstin'); // state mismatch
  eq((await call('/api/profile', {method: 'PUT', cookie, body: {...profile, upi_vpa: 'ada@'}})).status, 400);
  eq((await call('/api/profile', {method: 'PUT', cookie, body: {...profile, invoice_prefix: 'ABCDEFGHIJKLM'}})).data.error, 'invoice_prefix: Invoice numbers must be 16 characters or fewer');
  eq((await call('/api/profile', {method: 'PUT', cookie, body: profile})).status, 200);
  // LT-16: the account zone can be changed; an unknown zone is refused.
  eq((await call('/api/workspace/account', {method: 'PUT', cookie, body: {timezone: 'Mars/Base'}})).status, 400);
  eq((await call('/api/workspace/account', {method: 'PUT', cookie, body: {timezone: 'Asia/Calcutta'}})).data.timezone, 'Asia/Calcutta');
}

// ---- SF-17: modes change defaults and ordering, never reachability ---------------------------------
// @covers SF-17
{
  const cookie = await fresh('modes');
  const free = await call('/api/workspace/mode', {cookie});
  eq(free.data.mode, 'freelancer');
  const all = free.data.features.map(f => f.id).sort();
  ok(all.length >= 30, 'every feature is listed');
  for (const mode of ['agency', 'consumer', 'enterprise', 'freelancer']) {
    const r = await call('/api/workspace/mode', {method: 'PUT', cookie, body: {mode}});
    eq(r.status, 200);
    eq(r.data.features.map(f => f.id).sort(), all, mode + ' keeps every feature reachable');
  }
  eq((await call('/api/workspace/mode', {method: 'PUT', cookie, body: {mode: 'boss'}})).status, 400);
  // R: mode=enterprise → retention required (180 days set), audit export on, countersign roles on, OTP required.
  const ent = await call('/api/workspace/mode', {method: 'PUT', cookie, body: {mode: 'enterprise'}});
  eq([ent.data.defaults.retention_required, ent.data.defaults.audit_export, ent.data.defaults.countersign_roles, ent.data.defaults.otp, ent.data.defaults.contact_lock], [true, true, true, 'required', 'strict']);
  eq(ent.data.features[2].id, 'audit_export');
  const st = await call('/api/settings', {cookie});
  eq([st.data.mode, st.data.retention_required, st.data.settings.context_retention_days, st.data.retention_range], ['enterprise', true, 180, [30, 3650]]);
  const refused = await call('/api/settings', {method: 'PUT', cookie, body: {...st.data.settings, context_retention_days: null}});
  eq([refused.status, refused.data.code], [400, 'retention_required']);
  eq((await call('/api/settings', {method: 'PUT', cookie, body: {...st.data.settings, context_retention_days: 10}})).status, 400);
  eq((await call('/api/settings', {method: 'PUT', cookie, body: {...st.data.settings, context_retention_days: 365}})).status, 200);
  // New projects follow the mode's identity default (required in Enterprise, when codes can be delivered).
  const otpOn = (await call('/api/me', {cookie})).data.otp;
  const p = await call('/api/scopes', {method: 'POST', cookie, body: scope('Enterprise')});
  eq((await one('SELECT require_otp FROM scopeflow.projects WHERE id=$1', [p.data.scope.project_id])).require_otp, !!otpOn);
  // A project can keep its own mode; clearing it falls back to the account.
  const pid = p.data.scope.project_id;
  eq((await call('/api/workspace/mode', {method: 'PUT', cookie, body: {mode: 'consumer', project_id: pid}})).data.mode, 'consumer');
  eq((await call('/api/workspace/mode?project=' + pid, {cookie})).data.defaults.copy.party, 'vendor');
  eq((await call('/api/workspace/mode', {method: 'PUT', cookie, body: {mode: null, project_id: pid}})).data.mode, 'enterprise');
  eq((await call('/api/workspace/mode', {method: 'PUT', cookie: await fresh('modes-other'), body: {mode: 'agency', project_id: pid}})).status, 404);
  // The All features page lists everything in every mode.
  const page = await (await fetch(base + '/account/features', {headers: {Cookie: cookie}})).text();
  for (const f of free.data.features) ok(page.includes(f.title.replace(/&/g, '&amp;')) || page.includes(f.title), 'All features lists ' + f.title);
  // Leaving Enterprise keeps the owner's chosen period.
  await call('/api/workspace/mode', {method: 'PUT', cookie, body: {mode: 'freelancer'}});
  eq((await call('/api/settings', {cookie})).data.settings.context_retention_days, 365);
}

// ---- M13 / SF-12 / M12: per-account plans, ScopeFlow's own billing (Razorpay double) ---------------
// @covers M13 SF-12 M12
{
  const a = await fresh('plan-free'), b = await fresh('plan-pro');
  // Account A is on Free: 1 active project. Archived projects don't count (M12).
  const firstA = await call('/api/scopes', {method: 'POST', cookie: a, body: scope('Free one')});
  eq(firstA.status, 201);
  const ownerA = await ownerOf(firstA.data.scope.project_id);
  await db.query("INSERT INTO scopeflow.accounts_plans (owner,plan,status,updated) VALUES ($1,'free','active',$2)", [ownerA, new Date().toISOString()]);
  const capped = await call('/api/scopes', {method: 'POST', cookie: a, body: scope('Free two')});
  eq([capped.status, capped.data.code, capped.data.limit], [429, 'plan_limit', 1]);
  ok(/1 active project \(archived ones don’t count\)/.test(capped.data.error), capped.data.error);
  eq((await call('/api/scopes/' + firstA.data.scope.project_id, {method: 'PATCH', cookie: a, body: {archived: true}})).status, 200);
  eq((await call('/api/scopes', {method: 'POST', cookie: a, body: scope('Free after archive')})).status, 201);
  // Account B upgrades to Pro through checkout and the signed subscription webhook.
  const billing = (await call('/api/billing', {cookie: b})).data;
  eq([billing.billing.enabled, billing.plan.source], [true, 'server_default']);
  eq((await call('/api/billing/checkout', {method: 'POST', cookie: b, body: {plan: 'solo'}})).status, 400);
  const checkout = await call('/api/billing/checkout', {method: 'POST', cookie: b, body: {plan: 'pro', interval: 'month', currency: 'INR'}});
  eq(checkout.status, 201, JSON.stringify(checkout.data));
  eq((await call('/api/billing', {cookie: b})).data.checkout_pending, true);
  const sub = checkout.data.subscription;
  const secret = createHmac('sha256', process.env.SCOPEFLOW_SIGNING_SECRET).update('scopeflow-billing-local-double-v1').digest('hex');
  const now = Math.floor(Date.now() / 1000);
  const entity = {id: sub, entity: 'subscription', status: 'active', current_start: now, current_end: now + 30 * 86400, notes: {plan: 'pro', interval: 'month'}};
  const hook = async (event, extra = {}, id = randomUUID()) => {
    const raw = JSON.stringify({entity: 'event', event, payload: {subscription: {entity}, ...extra}, created_at: now});
    return call('/api/billing/razorpay/webhook', {method: 'POST', body: raw, headers: {'X-Razorpay-Signature': createHmac('sha256', secret).update(raw).digest('hex'), 'X-Razorpay-Event-Id': id}});
  };
  eq((await call('/api/billing/razorpay/webhook', {method: 'POST', body: '{"event":"subscription.activated"}', headers: {'X-Razorpay-Signature': 'bad'}})).status, 400);
  const activatedId = randomUUID();
  eq((await hook('subscription.activated', {}, activatedId)).data.plan, 'pro');
  eq((await hook('subscription.activated', {}, activatedId)).data.reason, 'duplicate');
  const charged = await hook('subscription.charged', {payment: {entity: {id: 'pay_test_' + randomUUID().slice(0, 8), entity: 'payment', amount: 49900, currency: 'INR', status: 'captured'}}});
  ok(/^SF-\d{4}-\d{5}$/.test(charged.data.invoice), 'ScopeFlow issues its own invoice for the payment');
  // R: A on Free and B on Pro on the same server have different caps.
  const [la, lb] = [(await call('/api/billing', {cookie: a})).data.plan, (await call('/api/billing', {cookie: b})).data.plan];
  eq([la.id, la.limits.projects, lb.id, lb.limits.projects], ['free', 1, 'pro', 1000]);
  eq((await call('/api/me', {cookie: b})).data.defaults.plan.name, 'Pro');
  const inv = (await call('/api/billing', {cookie: b})).data.invoices[0];
  const invoice = await call('/api/billing/invoices/' + inv.id, {cookie: b});
  eq([invoice.status, invoice.data.invoice?.number ?? invoice.data.number], [200, charged.data.invoice]);
  eq((await call('/api/billing/invoices/' + inv.id, {cookie: a})).status, 404);
  // I: halted → the plan stays for a 7-day grace, then the account drops to Free.
  const halted = await hook('subscription.halted');
  eq([halted.data.status, halted.data.plan], ['halted', 'pro']);
  const graceDays = (Date.parse(halted.data.grace_until) - Date.now()) / 86400_000;
  ok(graceDays > 6.9 && graceDays <= 7, 'grace is 7 days');
  eq((await call('/api/billing', {cookie: b})).data.plan.id, 'pro');
  await db.query("UPDATE scopeflow.accounts_plans SET grace_until=$1 WHERE provider_subscription=$2", [new Date(Date.now() - 1000).toISOString(), sub]);
  const lapsed = (await call('/api/billing', {cookie: b})).data.plan;
  eq([lapsed.id, lapsed.source], ['free', 'lapsed']);
  // The Plans page renders the same table the caps come from (L13 copy).
  const plans = await (await fetch(base + '/plans')).text();
  for (const s of ['₹499', '₹1,499', '1 active project (archived ones don’t count)']) ok(plans.includes(s), 'Plans page shows ' + s);
}

// ---- M32: 180-day default retention, redaction only in the daily job -------------------------------
// @covers M32
{
  const cookie = await fresh('retention');
  const st = await call('/api/settings', {cookie});
  eq([st.data.settings.context_retention_days, st.data.server_default_retention_days, st.data.effective_retention_days], [null, 180, 180]);
  const created = await call('/api/scopes', {method: 'POST', cookie, body: scope('Retention')});
  const owner = await ownerOf(created.data.scope.project_id);
  const ctx = JSON.stringify({channel: 'review_link', ip: '203.0.113.9', user_agent: 'Old Browser/1.0', owner_session: false, via_api: false, acknowledged: true});
  const aged = async days => {
    const id = 'ws08-' + randomUUID(), at = new Date(Date.now() - days * 86400_000).toISOString();
    await db.query('INSERT INTO scopeflow.projects (id,owner,latest,created) VALUES ($1,$2,1,$3)', [id, owner, at]);
    await db.query("INSERT INTO scopeflow.versions (id,project_id,version,token,content,status,signer,comment,created,decided,signature,decision_context) VALUES ($1||'-v1',$1,1,md5($1)||md5($1||'x'),'{\"title\":\"Aged\"}','approved','Old Signer','',$2,$2,'kid.sig',$3)", [id, at, ctx]);
    return id;
  };
  const old = await aged(181), recent = await aged(179);
  const ip = async id => JSON.parse((await one('SELECT decision_context FROM scopeflow.versions WHERE project_id=$1', [id])).decision_context).ip;
  await call('/api/scopes', {cookie}); // M26b: reading the list never redacts
  eq(await ip(old), '203.0.113.9');
  const out = job();
  ok(out.redacted_versions >= 1 && out.server_default_retention_days === 180, JSON.stringify(out));
  eq([await ip(old), await ip(recent)], ['redacted', '203.0.113.9']);
  // The client notice states the period (WS-07 renders it on the client page).
  const token = created.data.scope.token;
  const notice = await call('/api/account/notice/' + token);
  eq([notice.status, notice.data.retention_days, notice.data.closed], [200, 180, null]);
  ok(notice.data.data_notice.includes('kept for 180 days'), notice.data.data_notice);
  eq((await call('/api/account/notice/' + 'f'.repeat(64))).status, 404);
}

// ---- H10 / LT-22: deleting an account keeps the client's record ------------------------------------
// @covers H10 LT-22
{
  const cookie = await fresh('closure');
  await call('/api/profile/onboarding', {method: 'POST', cookie, body: {mode: 'freelancer', country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata', business_name: 'TEST Closing Studio'}});
  const created = await call('/api/scopes', {method: 'POST', cookie, body: scope('Closure')});
  const {project_id, token} = created.data.scope;
  await approve(token);
  const issued = await call(`/api/scopes/${project_id}/invoices`, {method: 'POST', cookie, body: {amount: 1000, description: 'TEST deposit'}});
  eq(issued.status, 201, JSON.stringify(issued.data));
  const draft = await call('/api/scopes', {method: 'POST', cookie, body: scope('Unsent draft')});
  const owner = await ownerOf(project_id);
  // R: a project on legal hold blocks deletion entirely (409).
  eq((await call(`/api/scopes/${project_id}`, {method: 'PATCH', cookie, body: {legal_hold: true, legal_hold_reason: 'TEST dispute'}})).status, 200);
  const held = await call('/api/account', {method: 'DELETE', cookie, body: {confirmation: 'DELETE'}});
  eq([held.status, held.data.code], [409, 'legal_hold']);
  eq((await call(`/api/scopes/${project_id}`, {method: 'PATCH', cookie, body: {legal_hold: false}})).status, 200);
  // R: delete → client link 200 read-only, invoice PDF 200, receipt 200; the login is deleted or the reply says it remains.
  const closed = await call('/api/account', {method: 'DELETE', cookie, body: {confirmation: 'DELETE'}});
  eq([closed.status, closed.data.projects_kept], [200, 1]);
  ok(closed.data.login_deleted ? /login was deleted/.test(closed.data.message) : /login stays active/.test(closed.data.message), closed.data.message);
  eq((await call('/api/review/' + token)).status, 200);
  eq((await call('/api/review/' + draft.data.scope.token)).status, 404); // the unsent draft is gone
  const pdf = await fetch(`${base}/api/review/${token}/invoices/${issued.data.invoice.seq}`);
  eq([pdf.status, pdf.headers.get('content-type')], [200, 'application/pdf']);
  eq((await fetch(`${base}/api/review/${token}/receipt`)).status, 200);
  const notice = await call('/api/account/notice/' + token);
  ok(/^The creator closed their ScopeFlow account; this record is kept for you until /.test(notice.data.closed.message), notice.data.closed.message);
  eq((await one('SELECT count(*)::int AS n FROM scopeflow.invoices WHERE project_id=$1', [project_id])).n, 1);
  eq((await one('SELECT count(*)::int AS n FROM scopeflow.business_profiles WHERE owner=$1', [owner])).n, 0);
  eq((await one('SELECT login_deleted FROM scopeflow.owner_tombstones WHERE owner=$1', [owner])).login_deleted, !!closed.data.login_deleted);
  // Read-only: the database refuses new records on the kept project.
  await assert.rejects(db.query("INSERT INTO scopeflow.ledger_entries (id,project_id,seq,kind,baseline_version,actor,payload,ref,prev_hash,hash,created) VALUES ($1,$2,99,'goodwill',1,'owner','{}',NULL,'0','0',$3)", [randomUUID(), project_id, new Date().toISOString()]), /closed this account/); passed++;
  if (closed.data.login_deleted) {
    eq((await call('/api/scopes', {cookie})).status, 401); // the login is gone with the session
  } else {
    eq((await call('/api/scopes', {cookie})).data.scopes, []); // the login remains; the closed projects are not in the new workspace
  }
  // The retention job purges the tombstone only after retain_until (and never under legal hold).
  eq(job().purged_closed_projects >= 0, true);
  eq((await one('SELECT count(*)::int AS n FROM scopeflow.projects WHERE id=$1', [project_id])).n, 1);
  await db.query("BEGIN; SELECT set_config('scopeflow.tombstone','on',true); UPDATE scopeflow.projects SET retain_until=$1 WHERE id=$2; COMMIT;".replace('$1', `'${new Date(Date.now() - 1000).toISOString()}'`).replace('$2', `'${project_id}'`));
  ok(job().purged_closed_projects >= 1, 'expired tombstone purged');
  eq((await one('SELECT count(*)::int AS n FROM scopeflow.projects WHERE id=$1', [project_id])).n, 0);
  eq((await call('/api/review/' + token)).status, 404);
}

// ---- SF-25: signed audit export; every decision verifies --------------------------------------------
// @covers SF-25
{
  const cookie = await fresh('audit');
  const created = await call('/api/scopes', {method: 'POST', cookie, body: scope('Audit')});
  await approve(created.data.scope.token);
  // Enterprise requires a code on decisions, so switch after the plain-ack approval.
  await call('/api/workspace/mode', {method: 'PUT', cookie, body: {mode: 'enterprise'}});
  eq((await call(`/api/scopes/${created.data.scope.project_id}/ledger`, {method: 'POST', cookie, body: {kind: 'goodwill', baseline_version: 1, payload: {title: 'TEST goodwill', value: 5}}})).status, 201);
  const r = await fetch(base + '/api/audit/export?format=jsonl', {headers: {Cookie: cookie}});
  eq([r.status, r.headers.get('content-type')], [200, 'application/x-ndjson; charset=utf-8']);
  const text = await r.text(), lines = text.trim().split('\n').map(l => JSON.parse(l));
  eq(r.headers.get('x-scopeflow-sha256'), createHash('sha256').update(text).digest('hex'));
  eq([lines[0].type, lines[0].mode, lines.at(-1).type], ['export', 'enterprise', 'seal']);
  const decisions = lines.filter(l => l.type === 'decision');
  ok(decisions.length >= 1, 'decisions exported');
  for (const d of decisions) eq((await call(d.verify)).data.record, 'match', 'export record verifies: ' + d.verify);
  ok(lines.some(l => l.type === 'ledger_entry') && lines.some(l => l.type === 'admin' && l.kind === 'mode.changed') && lines.some(l => l.type === 'project' && l.legal_hold === false), 'ledger, admin events and project states');
  const body = text.trim().split('\n'), seal = lines.at(-1);
  eq(seal.sha256, createHash('sha256').update(body.slice(0, -1).join('\n') + '\n').digest('hex'));
  const csv = await fetch(base + '/api/audit/export?format=csv', {headers: {Cookie: cookie}});
  eq([csv.status, csv.headers.get('content-type')], [200, 'text/csv; charset=utf-8']);
  eq((await call('/api/audit/export?from=2026-13-01', {cookie})).status, 400);
  eq((await call('/api/audit/export')).status, 401);
  const key = await call('/api/key', {method: 'POST', cookie});
  eq((await call('/api/audit/export', {headers: {Authorization: 'Bearer ' + key.data.token}})).data.code, 'admin_only');
}

await db.end();
console.log(`ws-08-modes-onboarding: ${passed} checks passed`);
