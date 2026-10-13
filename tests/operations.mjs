// Product and operations end to end against the local preview, the disposable local database and the
// local doubles (tests/support/tsa-service.mjs): the dedicated signing key, per-project retention and
// legal hold, automatic expiry of archived drafts, owner branding (logo, colour) on the review page
// and PDFs, email forwarding into the radar, the meaning-match radar, template tags, revisions and
// sharing, Stripe Checkout for deposits and invoices with its signed webhook, refunds and
// reconciliation, and the model-lifecycle script.
import assert from 'node:assert/strict';
import {createHmac, randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {signIn, ack, localSql} from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
for (const k of ['STRIPE_WEBHOOK_SECRET', 'STRIPE_API_URL', 'SCOPEFLOW_INBOUND_SECRET', 'SCOPEFLOW_INBOUND_DOMAIN', 'SCOPEFLOW_CRON_SECRET']) assert.ok(process.env[k], `Run with ${k} set (server and tests; see .github/workflows/ci.yml).`);
let passed = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); passed++; };
const ok = (v, message) => { assert.ok(v, message); passed++; };
async function call(path, {method = 'GET', cookie, body, headers = {}, raw} = {}) {
  const h = {Origin: base, ...headers};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined || raw !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body))});
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data, headers: r.headers};
}
const rows = sql => localSql(sql)[0].results;
const q = v => "'" + String(v).replaceAll("'", "''") + "'";
const dir = mkdtempSync(join(tmpdir(), 'sf-ops-live-'));
const approve = async (token, signer = 'Ada Client') => call('/api/review/' + token, {method: 'POST', body: await ack(base, token, {decision: 'approved', signer, comment: '', version: 1})});
const scopeBody = extra => ({title: 'Ops fixture ' + randomUUID().slice(0, 8), client: 'Acme', deliverables: '', items: [{id: 'logo', title: 'Logo design', qty: 1}], exclusions: 'Website hosting on our server\nSEO', fee: 1000, currency: 'EUR', revisions: 2, due: '', notes: '', ...extra});
const newScope = async (cookie, extra = {}) => { const r = await call('/api/scopes', {method: 'POST', cookie, body: scopeBody(extra)}); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.scope; };

// Each section signs in as its own owner, so no section runs into the per-owner write limit.
const fresh = tag => signIn(base, `ops-${tag}-${randomUUID()}@example.test`);
const ownerOf = async cookie => rows(`SELECT owner FROM scopeflow.projects WHERE id=${q((await newScope(cookie)).project_id)}`)[0].owner;

// ---- Signing key: a dedicated secret signs in production -----------------------------------------
eq((await call('/api/health')).data, {status: 'ok', signing: 'dedicated'});

// ---- Per-project retention and legal hold --------------------------------------------------------
{
  const cookie = await fresh('retention'), owner = await ownerOf(cookie);
  // Two projects decided a year ago (fixtures: decided records are immutable, so they are inserted aged).
  const context = JSON.stringify({channel: 'review_link', ip: '203.0.113.9', user_agent: 'Old Browser/1.0', owner_session: false, via_api: false, acknowledged: true});
  const fixture = () => {
    const id = 'ops-' + randomUUID();
    localSql(`INSERT INTO scopeflow.projects (id,owner,latest,created) VALUES (${q(id)},${q(owner)},1,'2025-01-01T00:00:00.000Z');
      INSERT INTO scopeflow.versions (id,project_id,version,token,content,status,signer,comment,created,decided,signature,decision_context) VALUES (${q(id + '-v1')},${q(id)},1,md5(${q(id)})||md5(${q(id + 'x')}),'{"title":"Old"}','approved','Old Signer','','2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z','kid.sig',${q(context)})`);
    return {project_id: id};
  };
  const held = fixture(), plain = fixture();
  const P = id => `/api/scopes/${id}`;
  eq((await call(P(held.project_id), {method: 'PATCH', cookie, body: {retention_days: 0}})).status, 400);
  const hold = await call(P(held.project_id), {method: 'PATCH', cookie, body: {legal_hold: true, legal_hold_reason: 'Payment dispute', retention_days: 30}});
  eq(hold.status, 200);
  eq([hold.data.project.legal_hold, hold.data.project.legal_hold_reason, hold.data.project.retention_days], [true, 'Payment dispute', 30]);
  ok(hold.data.project.legal_hold_set, 'hold time recorded');
  eq((await call(P(plain.project_id), {method: 'PATCH', cookie, body: {retention_days: 30}})).data.project.retention_days, 30);
  // The account keeps network details (no account setting); the project settings decide.
  await call('/api/scopes', {cookie}); // opportunistic retention on the project list
  const ip = id => JSON.parse(rows(`SELECT decision_context FROM scopeflow.versions WHERE project_id=${q(id)}`)[0].decision_context).ip;
  eq(ip(plain.project_id), 'redacted');
  ok(ip(held.project_id) !== 'redacted', 'a project on legal hold is never redacted');
  // Deleting is refused while the hold is on: the project and the whole account.
  eq((await call(P(held.project_id), {method: 'DELETE', cookie, body: {confirmation: 'DELETE'}})).data.code, 'legal_hold');
  eq((await call('/api/account', {method: 'DELETE', cookie, body: {confirmation: 'DELETE'}})).data.code, 'legal_hold');
  // Lifting the hold clears the note and lets retention run.
  const lifted = await call(P(held.project_id), {method: 'PATCH', cookie, body: {legal_hold: false}});
  eq([lifted.data.project.legal_hold, lifted.data.project.legal_hold_reason, lifted.data.project.legal_hold_set], [false, '', null]);
  await call('/api/scopes', {cookie});
  eq(ip(held.project_id), 'redacted');
}

// ---- Automatic expiry of archived drafts ---------------------------------------------------------
{
  const cookie = await fresh('drafts');
  const newDraft = () => newScope(cookie);
  const draft = await newScope(cookie), heldDraft = await newScope(cookie), signed = await newScope(cookie), recent = await newDraft();
  eq((await approve(signed.token)).status, 200);
  for (const s of [draft, heldDraft, signed, recent]) eq((await call(`/api/scopes/${s.project_id}`, {method: 'PATCH', cookie, body: {archived: true}})).status, 200);
  await call(`/api/scopes/${heldDraft.project_id}`, {method: 'PATCH', cookie, body: {legal_hold: true}});
  localSql(`UPDATE scopeflow.projects SET archived='2026-01-01T00:00:00.000Z' WHERE id IN (${[draft, heldDraft, signed].map(s => q(s.project_id)).join(',')})`);
  const settings = (await call('/api/settings', {cookie})).data.settings;
  eq(settings.draft_expiry_days, null);
  eq((await call('/api/settings', {method: 'PUT', cookie, body: {...settings, draft_expiry_days: 3}})).status, 400);
  const saved = await call('/api/settings', {method: 'PUT', cookie, body: {...settings, draft_expiry_days: 30}});
  eq([saved.status, saved.data.settings.draft_expiry_days, saved.data.expired_drafts], [200, 30, 1]);
  const left = new Set(rows(`SELECT id FROM scopeflow.projects WHERE id IN (${[draft, heldDraft, signed, recent].map(s => q(s.project_id)).join(',')})`).map(r => r.id));
  eq([left.has(draft.project_id), left.has(heldDraft.project_id), left.has(signed.project_id), left.has(recent.project_id)], [false, true, true, true], 'only the old, unheld, never-decided draft goes');
  // The daily job applies the same rules to every owner.
  const job = spawnSync(process.execPath, ['scripts/redact-expired.mjs'], {encoding: 'utf8', env: process.env});
  eq(job.status, 0, job.stderr);
  const out = JSON.parse(job.stdout.trim().split('\n').pop());
  ok(['redacted_versions', 'redacted_entries', 'expired_drafts'].every(k => Number.isInteger(out[k])), job.stdout);
  await call(`/api/scopes/${heldDraft.project_id}`, {method: 'PATCH', cookie, body: {legal_hold: false}});
  await call('/api/settings', {method: 'PUT', cookie, body: {...settings, draft_expiry_days: null}});
}

// ---- Branding ------------------------------------------------------------------------------------
function png(width, height, pixels) {
  const crc = buf => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.concat(Array.from({length: height}, (_, y) => Buffer.from([0, ...pixels.slice(y * width * 4, (y + 1) * width * 4)])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const logo = png(4, 2, Array.from({length: 8}, (_, i) => [31, 111, 235, i % 2 ? 255 : 90]).flat());
let brandHash;
const cookie = await fresh('brand');
{
  const profile = (await call('/api/profile', {cookie})).data;
  eq(profile.brand, {brand_color: '', reply_to: '', logo: '', logo_url: null});
  eq((await call('/api/profile', {method: 'PUT', cookie, body: {...profile.profile, business_name: 'Asha Design'}})).status, 200);
  eq((await call('/api/profile/brand', {method: 'PUT', cookie, body: {brand_color: 'blue', reply_to: ''}})).status, 400);
  const gif = await call('/api/profile/brand', {method: 'PUT', cookie, body: {brand_color: '#1F6FEB', reply_to: '', logo: 'data:image/gif;base64,R0lGODlh'}});
  eq([gif.status, gif.data.code], [400, 'invalid_logo']);
  eq((await call('/api/profile/brand', {method: 'PUT', body: {brand_color: '', reply_to: ''}})).status, 401);
  const saved = await call('/api/profile/brand', {method: 'PUT', cookie, body: {brand_color: '#1F6FEB', reply_to: 'Asha@Studio.in', logo: 'data:image/png;base64,' + logo.toString('base64')}});
  eq(saved.status, 200);
  eq([saved.data.brand.brand_color, saved.data.brand.reply_to], ['#1f6feb', 'asha@studio.in']);
  brandHash = saved.data.brand.logo_url.split('/').pop();
  ok(/^[0-9a-f]{32}$/.test(brandHash), 'content-addressed logo URL');
  // Leaving the logo out keeps it; the business profile save keeps the brand too.
  eq((await call('/api/profile/brand', {method: 'PUT', cookie, body: {brand_color: '#1f6feb', reply_to: 'asha@studio.in'}})).data.brand.logo_url, saved.data.brand.logo_url);
  eq((await call('/api/profile', {method: 'PUT', cookie, body: {...profile.profile, business_name: 'Asha Design'}})).status, 200);
  eq((await call('/api/profile', {cookie})).data.brand.logo_url, saved.data.brand.logo_url);
  const served = await fetch(base + saved.data.brand.logo_url);
  eq([served.status, served.headers.get('content-type'), served.headers.get('cache-control')], [200, 'image/png', 'public, max-age=31536000, immutable']);
  ok(Buffer.from(await served.arrayBuffer()).equals(logo), 'the stored logo is served unchanged');
  eq((await fetch(base + '/api/brand/' + '0'.repeat(32))).status, 404);
  eq((await fetch(base + '/api/brand/not-a-hash')).status, 404);
}
{
  const s = await newScope(cookie);
  const review = await call('/api/review/' + s.token);
  eq(review.data.brand, {name: 'Asha Design', color: '#1f6feb', text_color: '#1f6feb', logo_url: '/api/brand/' + brandHash});
  eq((await approve(s.token)).status, 200);
  const r = await fetch(`${base}/api/review/${s.token}/receipt`);
  eq(r.status, 200);
  writeFileSync(join(dir, 'receipt.pdf'), Buffer.from(await r.arrayBuffer()));
  const images = execFileSync('pdfimages', ['-list', join(dir, 'receipt.pdf')]).toString();
  ok(/\bimage\s+4\s+2\s+rgb\b/.test(images) && /\bsmask\s+4\s+2\s+gray\b/.test(images), images);
  ok(/ASHA DESIGN · DECISION RECEIPT/.test(execFileSync('pdftotext', [join(dir, 'receipt.pdf'), '-']).toString()), 'branded heading');
}

// ---- Email forwarding into the radar -------------------------------------------------------------
{
  // changed by WS-06 (L7): forwards come from the owner's own sign-in address (on the project's
  // allow-list) and name the project in the envelope recipient (OriginalRecipient), not To/Cc.
  const ownerEmail = `ops-inbound-${randomUUID()}@example.test`;
  const cookie = await signIn(base, ownerEmail);
  const s = await newScope(cookie);
  const P = `/api/scopes/${s.project_id}`;
  const empty = await call(P + '/inbound', {cookie});
  eq([empty.data.configured, empty.data.address, empty.data.messages], [true, null, []]);
  const on = await call(P, {method: 'PATCH', cookie, body: {inbound: 'on'}});
  const address = on.data.project.inbound_address;
  ok(/^scope-[0-9a-f]{24}@in\.scopeflow\.test$/.test(address), address);
  eq((await call(P, {method: 'PATCH', cookie, body: {inbound: 'on'}})).data.project.inbound_address, address, '"on" keeps an existing address');
  const post = (body, auth = 'Bearer ' + process.env.SCOPEFLOW_INBOUND_SECRET) => call('/api/inbound/email', {method: 'POST', body, headers: auth ? {Authorization: auth} : {}});
  const mail = {FromFull: {Email: ownerEmail}, ToFull: [{Email: address}], OriginalRecipient: address, Subject: 'Fwd: hosting', TextBody: 'See below\n\n---------- Forwarded message ---------\nFrom: Ada <ada@acme.co>\nSubject: hosting\n\nCould you also set up website hosting on your server for us?', MessageID: 'msg-' + randomUUID()};
  eq((await post(mail, null)).status, 401);
  eq((await post(mail, 'Bearer wrong')).status, 401);
  eq((await post(mail, 'Basic ' + Buffer.from('postmark:' + process.env.SCOPEFLOW_INBOUND_SECRET).toString('base64'))).status, 201);
  eq((await post(mail)).data.duplicate, true, 'the same MessageID is stored once');
  eq((await post({...mail, ToFull: [{Email: 'scope-' + '0'.repeat(24) + '@in.scopeflow.test'}], OriginalRecipient: 'scope-' + '0'.repeat(24) + '@in.scopeflow.test', MessageID: 'x-' + randomUUID()})).data, {accepted: false, reason: 'unknown_address'});
  eq((await post({to: address})).status, 400);
  const list = await call(P + '/inbound', {cookie});
  eq(list.data.messages.length, 1);
  const m = list.data.messages[0];
  eq([m.sender, m.subject, m.body], [ownerEmail, 'Fwd: hosting', 'Could you also set up website hosting on your server for us?']);
  eq(m.radar.verdict, 'out_of_scope');
  eq(m.radar.citations[0].kind, 'exclusion');
  eq((await call(P + '/inbound', {method: 'PATCH', cookie, body: {message_id: m.id, status: 'dismissed'}})).status, 200);
  eq((await call(P + '/inbound', {cookie})).data.messages, []);
  // Another owner cannot see or change this project's forwarded mail.
  const other = await signIn(base, `ops-other-${randomUUID()}@example.test`);
  eq((await call(P + '/inbound', {cookie: other})).status, 404);
  eq((await call(P + '/inbound', {method: 'PATCH', cookie: other, body: {message_id: m.id, status: 'new'}})).status, 404);
  // Turning the address off stops delivery to it.
  const off = await call(P, {method: 'PATCH', cookie, body: {inbound: 'off'}});
  eq(off.data.project?.inbound_address, null, JSON.stringify(off));
  eq((await post({...mail, MessageID: 'after-off'})).data.reason, 'unknown_address');
}

// ---- The meaning-match radar ---------------------------------------------------------------------
{
  const s = await newScope(cookie);
  const r = await call(`/api/scopes/${s.project_id}/radar`, {method: 'POST', cookie, body: {message: 'क्या आप वेबसाइट होस्टिंग भी सेट कर देंगे?'}});
  eq(r.status, 200);
  eq([r.data.semantic, r.data.result.engine, r.data.result.verdict], [true, 'embedding', 'out_of_scope']);
  eq(r.data.result.citations[0].text, 'Website hosting on our server');
}

// ---- Templates: tags, revisions, sharing ---------------------------------------------------------
{
  const cookie = await fresh('templates');
  const content = scopeBody({client: ''});
  const created = await call('/api/templates', {method: 'POST', cookie, body: {name: 'Brand kit', content, tags: ['Branding', 'branding', 'Retainer']}});
  eq(created.status, 201);
  const t = created.data.template;
  eq([t.tags, t.revision, t.share_path], [['branding', 'retainer'], 1, null]);
  const T = `/api/templates/${t.id}`;
  eq((await call(T, {method: 'PUT', cookie, body: {tags: ['x'.repeat(30)]}})).status, 400);
  eq((await call(T, {method: 'PUT', cookie, body: {tags: ['branding']}})).data.template.revision, 1, 'tags alone make no revision');
  const updated = await call(T, {method: 'PUT', cookie, body: {name: 'Brand kit v2', content: {...content, fee: 1500}}});
  eq([updated.data.template.revision, updated.data.template.content.fee], [2, 1500]);
  const history = await call(T + '/revisions', {cookie});
  eq(history.data.revisions.map(r => [r.revision, r.name]), [[1, 'Brand kit']]);
  eq((await call(T + '/revisions', {method: 'POST', cookie, body: {revision: 9}})).status, 404);
  const restored = await call(T + '/revisions', {method: 'POST', cookie, body: {revision: 1}});
  eq([restored.data.template.revision, restored.data.template.name, restored.data.template.content.fee], [3, 'Brand kit', 1000]);
  eq((await call(T + '/revisions', {cookie})).data.revisions.map(r => r.revision), [2, 1]);
  // Sharing: anyone with the link sees it (not the owner); another owner can import a copy.
  const shared = await call(T + '/share', {method: 'POST', cookie, body: {share: true}});
  const path = shared.data.template.share_path, token = path.split('/').pop();
  eq((await call(T + '/share', {method: 'POST', cookie, body: {share: true}})).data.template.share_path, path, 'sharing again keeps the link');
  const view = await call('/api/templates/shared/' + token);
  eq(Object.keys(view.data.template).sort(), ['content', 'name', 'revision', 'tags', 'updated']);
  eq(view.data.template.name, 'Brand kit');
  const other = await signIn(base, `ops-import-${randomUUID()}@example.test`);
  eq((await call('/api/templates/shared/' + token, {method: 'POST'})).status, 401);
  const imported = await call('/api/templates/shared/' + token, {method: 'POST', cookie: other});
  eq([imported.status, imported.data.template.name, imported.data.template.revision, imported.data.template.origin], [201, 'Brand kit', 1, 'Imported from a shared link (revision 3)']);
  eq((await call(`/api/templates/${imported.data.template.id}`, {method: 'PUT', cookie, body: {name: 'Hijack'}})).status, 404, 'the copy belongs to the importer');
  const rotated = await call(T + '/share', {method: 'POST', cookie, body: {share: true, rotate: true}});
  ok(rotated.data.template.share_path !== path, 'a new link');
  eq((await call('/api/templates/shared/' + token)).status, 404, 'the old link stops working');
  eq((await call(T + '/share', {method: 'POST', cookie, body: {share: false}})).data.template.share_path, null);
  eq((await call(T, {method: 'DELETE', cookie})).status, 200);
  eq(rows(`SELECT COUNT(*)::int AS n FROM scopeflow.template_revisions WHERE template_id=${q(t.id)}`)[0].n, 0);
}

// ---- Stripe: deposit and invoice payments, webhook, refunds, reconciliation ----------------------
const stripeSign = body => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex')}`; };
const stub = (path, method = 'GET') => fetch(process.env.STRIPE_API_URL + path, {method}).then(r => r.json());
const payer = await fresh('stripe');
{
  const p = (await call('/api/profile', {cookie: payer})).data.profile;
  assert.equal((await call('/api/profile', {method: 'PUT', cookie: payer, body: {...p, business_name: 'Asha Design'}})).status, 200);
}
// changed by WS-04: client payments go to the freelancer's OWN Stripe account (C3); the operator's
// STRIPE_SECRET_KEY is refused for client charges in production (`next start`). The freelancer
// connects their key (the same CI double) and points their webhook at their account's URL.
const stripeAccount = await call('/api/payment-accounts', {method: 'POST', cookie: payer, body: {kind: 'stripe_keys', secret_key: process.env.STRIPE_SECRET_KEY, webhook_secret: process.env.STRIPE_WEBHOOK_SECRET, currencies: ['EUR', 'GBP']}});
eq(stripeAccount.status, 201);
const stripeHook = new URL(stripeAccount.data.account.webhook_url).pathname;
eq(stripeHook, `/api/payments/stripe/webhook/${stripeAccount.data.account.id}`);
const webhook = (session, signature) => { const body = JSON.stringify({id: 'evt_' + randomUUID().slice(0, 12), type: 'checkout.session.completed', data: {object: session}}); return call(stripeHook, {method: 'POST', raw: body, headers: {'Stripe-Signature': signature ?? stripeSign(body)}}); };
{
  const s = await newScope(payer, {deposit_pct: 30, fee: 1000});
  eq((await call(`/api/review/${s.token}/deposit`, {method: 'POST', body: {}})).data.code, 'not_approved');
  eq((await approve(s.token)).status, 200);
  const view = await call('/api/review/' + s.token);
  // changed by WS-04: ledger.online_payments (review route, not WS-04's) still reads the operator-level
  // status, which is off in production; the deposit view reads the freelancer's own route.
  eq([view.data.deposit.enabled, view.data.deposit.provider], [true, 'stripe']);
  const start = await call(`/api/review/${s.token}/deposit`, {method: 'POST', body: {}});
  eq([start.status, start.data.provider, start.data.amount_minor, start.data.currency], [200, 'stripe', 30000, 'EUR']);
  ok(start.data.url.startsWith('https://checkout.stripe.test/c/cs_test_'), start.data.url);
  const sessionId = start.data.url.split('/').pop();
  eq((await call(`/api/review/${s.token}/deposit`, {method: 'POST', body: {}})).data.url, start.data.url, 'a second click gets the same session');
  const session = await stub(`/v1/checkout/sessions/${sessionId}`);
  eq([session.amount_total, session.currency, session.metadata.purpose], [30000, 'eur', 'deposit']);
  ok(!JSON.stringify(session).includes(s.token), 'the review token never goes to Stripe');
  // The webhook: a bad signature is refused; an unpaid session is ignored; the paid one is recorded once.
  const paid = await stub(`/_pay/${sessionId}`, 'POST');
  eq((await webhook(paid, 't=1,v1=00')).status, 400);
  eq((await webhook({...paid, payment_status: 'unpaid'})).data, {ignored: 'event'});
  // changed by WS-04: an amount mismatch is recorded as paid with an alert (M20), not ignored; see tests/ws-04-providers.mjs.
  const recorded = await webhook(paid);
  eq([recorded.status, recorded.data.recorded, recorded.data.ledger], [200, true, true]);
  eq((await webhook(paid)).data, {recorded: false, duplicate: true});
  const ledger = (await call(`/api/scopes/${s.project_id}/ledger`, {cookie: payer})).data;
  const entry = ledger.entries.find(e => e.kind === 'payment');
  eq([entry.actor, entry.payload.provider, entry.payload.purpose, entry.payload.amount, entry.payload.currency, entry.payload.payment_id], ['system', 'stripe', 'deposit', 300, 'EUR', paid.payment_intent]);
  eq((await call('/api/review/' + s.token)).data.deposit.paid.amount, 300);
  eq((await call(`/api/review/${s.token}/deposit`, {method: 'POST', body: {}})).data.code, 'already_paid');

  // Paying an issued invoice online: what is still open on it, a partial payment of the balance.
  const inv = await call(`/api/scopes/${s.project_id}/invoices`, {method: 'POST', cookie: payer, body: {amount: 500, request_id: 'inv-' + randomUUID().slice(0, 8)}});
  eq(inv.status, 201);
  const seq = inv.data.invoice.seq;
  eq((await call(`/api/review/${s.token}/invoices/999/pay`, {method: 'POST', body: {}})).status, 404);
  const invStart = await call(`/api/review/${s.token}/invoices/${seq}/pay`, {method: 'POST', body: {}});
  eq([invStart.status, invStart.data.provider, invStart.data.amount_minor], [200, 'stripe', 50000]);
  const invSession = await stub(`/_pay/${invStart.data.url.split('/').pop()}`, 'POST');
  // A lost webhook: the reconciliation job asks Stripe and records it exactly once.
  const rec = await call('/api/payments/razorpay/reconcile', {method: 'POST', headers: {Authorization: 'Bearer ' + process.env.SCOPEFLOW_CRON_SECRET}});
  eq(rec.status, 200);
  ok(rec.data.results.some(r => r.order_id === invSession.id && r.recorded && r.ledger), JSON.stringify(rec.data));
  eq((await webhook(invSession)).data, {recorded: false, duplicate: true});
  const after = (await call(`/api/scopes/${s.project_id}/ledger`, {cookie: payer})).data.entries.filter(e => e.kind === 'payment');
  eq(after.map(e => [e.payload.purpose, e.payload.amount, e.payload.invoice_number ?? null]), [['deposit', 300, null], ['invoice', 500, inv.data.invoice.number]]);
  const invoices = (await call(`/api/scopes/${s.project_id}/invoices`, {cookie: payer})).data.invoices;
  eq(invoices.find(i => i.seq === seq).status, 'paid');
  eq((await call(`/api/review/${s.token}/invoices/${seq}/pay`, {method: 'POST', body: {}})).data.code, 'already_paid');

  // Refunds: through Stripe for an online payment, at most what is left on it; or recorded by hand.
  const R = `/api/scopes/${s.project_id}/refunds`, depositSeq = entry.seq;
  eq((await call(R, {method: 'POST', cookie: payer, body: {payment_seq: depositSeq, amount: 301, request_id: 'refund-too-much'}})).data.code, 'refund_exceeds_paid');
  const refund = await call(R, {method: 'POST', cookie: payer, body: {payment_seq: depositSeq, amount: 120, note: 'Dropped the brand guide', request_id: 'refund-' + randomUUID().slice(0, 8)}});
  eq(refund.status, 201);
  ok(/^re_/.test(refund.data.refund_id), refund.data.refund_id);
  const replay = await call(R, {method: 'POST', cookie: payer, body: {payment_seq: depositSeq, amount: 120, request_id: 'refund-' + 'replay01'}});
  eq(replay.status, 201);
  eq((await call(R, {method: 'POST', cookie: payer, body: {payment_seq: depositSeq, amount: 120, request_id: 'refund-' + 'replay01'}})).data.replayed, true, 'a retry does not refund twice');
  eq((await call(R, {method: 'POST', cookie: payer, body: {payment_seq: depositSeq, amount: 61, request_id: 'refund-over'}})).data.code, 'refund_exceeds_paid', '300 - 120 - 120 = 60 left');
  eq((await call(`/api/scopes/${s.project_id}/ledger`, {method: 'POST', cookie: payer, body: {kind: 'refund', baseline_version: 1, payload: {amount: 5, method: 'stripe', refunded: '2026-10-09'}}})).status, 400, 'online refunds go through the provider');
  eq((await call(`/api/scopes/${s.project_id}/ledger`, {method: 'POST', cookie: payer, body: {kind: 'refund', baseline_version: 1, payload: {amount: 9999, method: 'bank_transfer', refunded: '2026-10-09'}}})).data.code, 'refund_exceeds_paid');
  eq((await call(`/api/scopes/${s.project_id}/ledger`, {method: 'POST', cookie: payer, body: {kind: 'refund', baseline_version: 1, payload: {amount: 10, method: 'bank_transfer', refunded: '2026-10-09', note: 'Goodwill'}}})).status, 201);
  const final = (await call(`/api/scopes/${s.project_id}/ledger`, {cookie: payer})).data.entries.filter(e => e.kind === 'refund');
  eq(final.map(e => [e.payload.amount, e.payload.method, e.payload.refund_of ?? null]), [[120, 'stripe', depositSeq], [120, 'stripe', depositSeq], [10, 'bank_transfer', null]]);
  // The client sees the refunds and the net amount paid on the statement.
  const statement = await fetch(`${base}/api/review/${s.token}/statement`);
  writeFileSync(join(dir, 'statement.pdf'), Buffer.from(await statement.arrayBuffer()));
  const text = execFileSync('pdftotext', [join(dir, 'statement.pdf'), '-']).toString();
  ok(/Refund · Stripe/.test(text) && /−€120\.00|-€120\.00/.test(text), text.slice(0, 2000));
  ok(/€550\.00/.test(text), 'net paid 300 + 500 - 120 - 120 - 10');
  // Another owner cannot refund this project's payments.
  const other = await signIn(base, `ops-refund-${randomUUID()}@example.test`);
  eq((await call(R, {method: 'POST', cookie: other, body: {payment_seq: depositSeq, amount: 1, request_id: 'refund-other1'}})).status, 404);
}
// INR keeps Razorpay (not configured here), so online payment stays off for it.
{
  const s = await newScope(payer, {currency: 'INR', deposit_pct: 30});
  eq((await approve(s.token)).status, 200);
  eq((await call(`/api/review/${s.token}/deposit`, {method: 'POST', body: {}})).data.code, 'payments_disabled');
}

// ---- Model-lifecycle guard -----------------------------------------------------------------------
{
  const env = {...process.env}; delete env.OPENAI_API_KEY; delete env.ANTHROPIC_API_KEY;
  const r = spawnSync(process.execPath, ['scripts/check-models.mjs', '--strict'], {encoding: 'utf8', env});
  eq(r.status, 0, r.stderr);
  eq(JSON.parse(r.stdout), {checked: 0, models: [], problems: 0});
}

console.log(`operations: ${passed} checks passed`);
