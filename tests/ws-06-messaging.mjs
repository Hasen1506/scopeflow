// WS-06 messaging suite (test:local, localhost and scopeflow_test only). Spawns its OWN production
// server (`next start`, the build CI already made) on another port, pointed at in-process doubles for
// the three mail providers (Resend, Postmark, SES), the WhatsApp Cloud API and the OpenAI API, so each
// test can assert exactly what would have been sent, to whom and through which provider. Nothing
// leaves localhost; no real email or WhatsApp message is sent. Fictional TEST data only; no retries.
//
// Covers: H18 x2 / SF-13 (CO proposed -> client email with the amount incl. GST; notify_client off ->
// nothing queued), M18 (409 contact_mismatch, address unchanged), M19 (51st email in a day -> 429; new
// recipient domain needs confirmation), L7 (stranger -> quarantined, not in the radar inbox), SF-04 x3
// (signed forward from a linked phone -> reply with the CO link; unsigned -> 401; unlinked phone ->
// onboarding reply, nothing stored), SF-19 (Resend 500 -> Postmark; suppression after a hard bounce),
// L11 (primary model 404 -> fallback, 200, readiness warning), M11 (owner default INR, request USD).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHmac, randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {signIn, localSql, requireLocalDatabase, ack} from './support/local.mjs';

requireLocalDatabase();
const PORT = Number(process.env.WS06_PORT || 5736);
const base = `http://localhost:${PORT}`;
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
let passed = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); passed++; };
const ok = (v, m) => { assert.ok(v, m); passed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sql = q => localSql(q)[0].results;
const esc = s => "'" + String(s).replaceAll("'", "''") + "'";

// ---- Doubles ------------------------------------------------------------------------------------
const log = [];
const mode = {resend: 200};
const sampleDraft = {title: 'TEST Clinic website', client: 'TEST Smile Dental', items: [{title: 'Page designs', qty: 5, unit: 'pages', price: null, acceptance: 'Approved in Figma'}], client_inputs: [], exclusions: 'Hosting', fee: 150000, currency: 'INR', revisions: 2, due: '', notes: ''};
const doubles = createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    let body = null; try { body = JSON.parse(raw); } catch { /* not JSON */ }
    const path = req.url ?? '';
    const send = (status, data) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(data)); };
    const n = log.length + 1;
    if (path === '/resend/emails') { log.push({kind: 'mail', provider: 'resend', status: mode.resend, to: body?.to?.[0], subject: body?.subject, text: body?.text, headers: body?.headers ?? null}); return mode.resend === 200 ? send(200, {id: 're_' + n}) : send(mode.resend, {message: 'Resend is down (double)'}); }
    if (path === '/postmark/email') { log.push({kind: 'mail', provider: 'postmark', status: 200, to: body?.To, subject: body?.Subject, text: body?.TextBody}); return send(200, {MessageID: 'pm_' + n, ErrorCode: 0}); }
    if (path === '/ses/v2/email/outbound-emails') { log.push({kind: 'mail', provider: 'ses', status: 200, to: body?.Destination?.ToAddresses?.[0], subject: body?.Content?.Simple?.Subject?.Data, text: body?.Content?.Simple?.Body?.Text?.Data}); return send(200, {MessageId: 'ses_' + n}); }
    if (/^\/wa\/v[\d.]+\/\d+\/messages$/.test(path)) { log.push({kind: 'whatsapp', to: body?.to, type: body?.type, text: body?.text?.body ?? body?.interactive?.body?.text ?? null, auth: req.headers.authorization}); return send(200, {messages: [{id: 'wamid.' + n}]}); }
    if (path === '/openai/v1/chat/completions') {
      log.push({kind: 'ai', model: body?.model});
      if (body?.model === 'gone-model') return send(404, {error: {message: 'The model `gone-model` does not exist or you do not have access to it.', code: 'model_not_found'}});
      return send(200, {choices: [{message: {content: JSON.stringify(sampleDraft)}}]});
    }
    send(404, {error: 'unknown double path ' + path});
  });
});
await new Promise(r => doubles.listen(0, '127.0.0.1', r));
const D = `http://127.0.0.1:${doubles.address().port}`;
const mails = to => log.filter(l => l.kind === 'mail' && l.to === to);

const APP_SECRET = 'ws06-ci-whatsapp-app-secret';
const MAIL_HOOK = 'ws06-ci-mail-webhook-secret';
const serverEnv = {
  ...process.env,
  NODE_ENV: 'production', PORT: String(PORT), APP_URL: base, SCOPEFLOW_TEST_URL: base,
  SCOPEFLOW_MAIL_FROM: 'Scopeflow TEST <scopes@mail.scopeflow.test>',
  RESEND_API_KEY: 're_ci_only', POSTMARK_SERVER_TOKEN: 'pm-ci-only',
  SCOPEFLOW_SES_ACCESS_KEY_ID: 'AKIACIONLY', SCOPEFLOW_SES_SECRET_ACCESS_KEY: 'ci-only-ses-secret', SCOPEFLOW_SES_REGION: 'eu-west-1',
  SCOPEFLOW_MAIL_API_URL_RESEND: D + '/resend', SCOPEFLOW_MAIL_API_URL_POSTMARK: D + '/postmark', SCOPEFLOW_MAIL_API_URL_SES: D + '/ses',
  SCOPEFLOW_MAIL_WEBHOOK_SECRET: MAIL_HOOK,
  WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_ACCESS_TOKEN: 'wa-ci-only', WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_VERIFY_TOKEN: 'ws06-verify', WHATSAPP_API_URL: D + '/wa',
  OPENAI_API_KEY: 'sk-ci-only', SCOPEFLOW_OPENAI_URL: D + '/openai', SCOPEFLOW_MODELS: 'fast=openai:gone-model,openai:backup-model;careful=openai:backup-model',
};
for (const k of ['SCOPEFLOW_MAIL_ROUTES', 'SCOPEFLOW_MAIL_PROVIDER', 'SCOPEFLOW_MAIL_API_URL', 'ANTHROPIC_API_KEY', 'SCOPEFLOW_LLM_PROVIDER', 'SCOPEFLOW_LIMIT_MAIL_PER_DAY', 'SCOPEFLOW_LIMIT_MAIL_PER_RECIPIENT', 'RESEND_WEBHOOK_SECRET']) delete serverEnv[k];

let server = null;
async function startServer() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', 'localhost', '--port', String(PORT)], {env: serverEnv, stdio: ['ignore', 'pipe', 'pipe']});
  const out = [];
  server.stdout.on('data', c => out.push(String(c))); server.stderr.on('data', c => out.push(String(c)));
  server.logs = out;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + '/api/health')).status < 600) return; } catch { /* starting */ }
    if (server.exitCode !== null) break;
    await sleep(500);
  }
  throw new Error('The WS-06 server did not start:\n' + out.join('').slice(-4000));
}
async function finish(code) {
  if (server && server.exitCode === null) { const done = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await done; }
  await new Promise(r => doubles.close(r));
  process.exit(code);
}
const fail = e => { console.error(e); if (server?.logs) console.error(server.logs.join('').slice(-4000)); void finish(1); };
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

async function call(path, {method = 'GET', cookie, body, raw, headers = {}} = {}) {
  const h = {Origin: base, ...headers};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined || raw !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: 'manual'});
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data};
}
const scope = extra => ({title: 'TEST WS-06 ' + randomUUID().slice(0, 8), client: 'TEST Client', deliverables: '', items: [{id: 'logo', title: 'Logo suite', price: 1000}], client_inputs: [], exclusions: 'Video production', fee: 1000, currency: 'INR', revisions: 2, due: '', notes: '', ...extra});
async function project(cookie, {settings = {}, approved = true, ...extra} = {}) {
  const c = await call('/api/scopes', {method: 'POST', cookie, body: scope(extra)});
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const {project_id, token} = c.data.scope;
  // Contact details first: the client approves the version they were sent to.
  if (Object.keys(settings).length) { const p = await call('/api/scopes/' + project_id, {method: 'PATCH', cookie, body: settings}); assert.equal(p.status, 200, JSON.stringify(p.data)); }
  if (approved) { const r = await call('/api/review/' + token, {method: 'POST', body: await ack(base, token, {decision: 'approved', signer: 'TEST Client', comment: '', version: 1})}); assert.equal(r.status, 200, JSON.stringify(r.data)); }
  return {project_id, token, P: '/api/scopes/' + project_id};
}
const proposeCo = (cookie, P, title, fee_delta) => call(P + '/ledger', {method: 'POST', cookie, body: {kind: 'change_order', baseline_version: 1, payload: {title, reason: '', request_quote: '', add_items: [], remove_item_ids: [], fee_delta, days_delta: 0, revisions_delta: 0}, request_id: randomUUID()}});
const ownerOf = id => sql(`SELECT owner FROM scopeflow.projects WHERE id=${esc(id)}`)[0].owner;
const tag = randomUUID().slice(0, 8);

await startServer();
const cookie = await signIn(base, `ws06-owner-${tag}@example.test`);

// ---- H18 / SF-13: client email when a change order is proposed ------------------------------------
// @covers H18 SF-13
{
  const client = `co-${tag}@acme-ws06.example`;
  const a = await project(cookie, {tax_pct: 18, tax_label: 'GST', settings: {client_email: client}});
  const co = await proposeCo(cookie, a.P, 'Extra reel', 400);
  eq(co.status, 201, JSON.stringify(co.data));
  const n = await call(a.P + '/notifications', {cookie});
  eq(n.status, 200, JSON.stringify(n.data));
  const notice = n.data.change_orders.find(c => c.title === 'Extra reel');
  eq(notice.email?.status, 'sent', JSON.stringify(n.data));
  const sent = mails(client);
  eq(sent.length, 1, 'one email to the client');
  eq(sent[0].provider, 'resend', 'transactional mail goes to Resend first');
  ok(/^Change order CO-\d+ for .+: ₹472\.00$/.test(sent[0].subject), sent[0].subject);
  ok(sent[0].text.includes('Amount: ₹472.00 (incl. GST 18%)'), sent[0].text);
  ok(sent[0].text.includes(`${base}/review/${a.token}`), 'links to the client page');
  eq(notice.amount, '₹472.00');
  // Idempotent: a second drain, or a retried call, never emails twice.
  await call(a.P + '/notifications', {cookie});
  eq(mails(client).length, 1);

  // notify_client off -> nothing is queued for the client.
  eq((await call(a.P + '/notifications', {method: 'PATCH', cookie, body: {notify_client: false}})).data, {notify_client: false});
  const co2 = await proposeCo(cookie, a.P, 'Second extra', 200);
  eq(co2.status, 201, JSON.stringify(co2.data));
  const n2 = await call(a.P + '/notifications', {cookie});
  eq(n2.data.notify_client, false);
  eq(mails(client).length, 1, 'no email with client notices off');
  const seq2 = n2.data.change_orders.find(c => c.title === 'Second extra').seq;
  eq(Number(sql(`SELECT COUNT(*)::int AS n FROM scopeflow.mail_outbox WHERE dedupe_key=${esc(`co_proposed:${a.project_id}:${seq2}`)}`)[0].n), 0, 'nothing in the outbox');
  eq(sql(`SELECT status FROM scopeflow.notify_events WHERE project_id=${esc(a.project_id)} AND ref=${esc(String(seq2))}`)[0]?.status, 'skipped');
}

// ---- M18: Send never rewrites the client's address --------------------------------------------------
// @covers M18
const clientB = `send-${tag}@acme-ws06.example`;
const b = await project(cookie, {approved: false, settings: {client_email: clientB}});
{
  const r = await call(b.P + '/send', {method: 'POST', cookie, body: {version: 1, email: `other-${tag}@acme-ws06.example`}});
  eq(r.status, 409, JSON.stringify(r.data));
  eq(r.data.code, 'contact_mismatch');
  eq((await call(b.P, {cookie})).data.project.client_email, clientB, 'the address on file is unchanged');
  eq(mails(`other-${tag}@acme-ws06.example`).length, 0);
}

// ---- SF-19: Resend 500 -> Postmark; suppression after a hard bounce ----------------------------------
// @covers SF-19
{
  mode.resend = 500;
  const r = await call(b.P + '/send', {method: 'POST', cookie, body: {version: 1, confirm_new_domain: true}});
  mode.resend = 200;
  eq(r.status, 200, JSON.stringify(r.data));
  eq([r.data.sent, r.data.provider], [true, 'postmark']);
  eq(mails(clientB).map(m => [m.provider, m.status]), [['resend', 500], ['postmark', 200]], 'tried Resend once, then Postmark once');
  const hook = body => call('/api/mail/events/postmark', {method: 'POST', body, headers: {Authorization: 'Basic ' + Buffer.from('postmark:' + MAIL_HOOK).toString('base64')}});
  eq((await call('/api/mail/events/postmark', {method: 'POST', body: {RecordType: 'Bounce', Type: 'HardBounce', Email: clientB, ID: 1}, headers: {Authorization: 'Basic ' + Buffer.from('postmark:wrong').toString('base64')}})).status, 401);
  const id = Math.floor(Math.random() * 1e9);
  const bounced = await hook({RecordType: 'Bounce', Type: 'HardBounce', Email: clientB.toUpperCase(), ID: id});
  eq(bounced.status, 200, JSON.stringify(bounced.data));
  eq([bounced.data.suppressed, bounced.data.reason], [1, 'hard_bounce']);
  eq((await hook({RecordType: 'Bounce', Type: 'HardBounce', Email: clientB, ID: id})).data.duplicate, true, 'a provider retry is not re-applied');
  eq(sql(`SELECT reason FROM scopeflow.mail_suppressions WHERE address=${esc(clientB)}`)[0]?.reason, 'hard_bounce');
  // Any later email to that address, from any provider, is suppressed.
  const c = await project(cookie, {approved: false, settings: {client_email: clientB}});
  const before = mails(clientB).length;
  const r2 = await call(c.P + '/send', {method: 'POST', cookie, body: {version: 1, confirm_new_domain: true}});
  eq(r2.status, 502, JSON.stringify(r2.data));
  eq(r2.data.code, 'suppressed');
  eq(mails(clientB).length, before, 'no provider was called');
}

// ---- M19: daily cap (51st email -> 429) and new-domain confirmation ----------------------------------
// @covers M19
{
  const f = await project(cookie, {approved: false, settings: {client_email: `new-${tag}@fresh-${tag}.example`}});
  const r = await call(f.P + '/send', {method: 'POST', cookie, body: {version: 1}});
  eq(r.status, 409, JSON.stringify(r.data));
  eq([r.data.code, r.data.domain], ['confirm_new_domain', `fresh-${tag}.example`]);
  eq(mails(`new-${tag}@fresh-${tag}.example`).length, 0, 'nothing sent before the owner confirms');

  const capCookie = await signIn(base, `ws06-cap-${tag}@example.test`);
  const d = await project(capCookie, {approved: false, settings: {client_email: `d-${tag}@cap-ws06.example`}});
  const e = await project(capCookie, {approved: false, settings: {client_email: `e-${tag}@cap-ws06.example`}});
  const owner = ownerOf(d.project_id);
  // 49 emails already sent today (to 49 different recipients).
  sql(`INSERT INTO scopeflow.mail_outbox (id,owner,event,class,recipient,recipient_domain,status,created)
    SELECT 'ws06-cap-' || g || '-${tag}', ${esc(owner)}, 'review_link', 'transactional', 'r' || g || '-${tag}@cap-ws06.example', 'cap-ws06.example', 'sent', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM generate_series(1, 49) g`);
  const fiftieth = await call(d.P + '/send', {method: 'POST', cookie: capCookie, body: {version: 1, confirm_new_domain: true}});
  eq([fiftieth.status, fiftieth.data.sent], [200, true], JSON.stringify(fiftieth.data));
  const fiftyFirst = await call(e.P + '/send', {method: 'POST', cookie: capCookie, body: {version: 1, confirm_new_domain: true}});
  eq(fiftyFirst.status, 429, JSON.stringify(fiftyFirst.data));
  eq(fiftyFirst.data.code, 'daily_cap');
  eq(mails(`e-${tag}@cap-ws06.example`).length, 0);
}

// ---- L7: inbound mail from a stranger is quarantined ---------------------------------------------------
// @covers L7
{
  const g = await project(cookie, {settings: {client_email: `in-${tag}@acme-ws06.example`}});
  const address = (await call(g.P, {method: 'PATCH', cookie, body: {inbound: 'on'}})).data.project.inbound_address;
  ok(/^scope-[0-9a-f]{24}@/.test(address), address);
  const mail = {FromFull: {Email: `stranger-${tag}@evil-ws06.example`}, ToFull: [{Email: address}], OriginalRecipient: address, Subject: 'Fwd: one more thing', TextBody: 'Could you also add a 30 second video for us?', MessageID: 'ws06-' + randomUUID()};
  const r = await call('/api/inbound/email', {method: 'POST', body: mail, headers: {Authorization: 'Bearer ' + process.env.SCOPEFLOW_INBOUND_SECRET}});
  eq(r.status, 200, JSON.stringify(r.data));
  eq([r.data.accepted, r.data.reason, r.data.detail], [false, 'quarantined', 'unknown_sender']);
  eq((await call(g.P + '/inbound', {cookie})).data.messages.length, 0, 'not in the radar inbox');
  eq(sql(`SELECT reason,status FROM scopeflow.inbound_quarantine WHERE project_id=${esc(g.project_id)}`).map(x => [x.reason, x.status]), [['unknown_sender', 'held']]);
  // Only the envelope recipient names the project: an address in To/Cc alone is not enough.
  const viaTo = await call('/api/inbound/email', {method: 'POST', body: {...mail, OriginalRecipient: `nobody-${tag}@in.scopeflow.test`, MessageID: 'ws06-' + randomUUID()}, headers: {Authorization: 'Bearer ' + process.env.SCOPEFLOW_INBOUND_SECRET}});
  eq(viaTo.data, {accepted: false, reason: 'unknown_address'});
}

// ---- SF-04: forward-to-bot webhook ------------------------------------------------------------------
// @covers SF-04
{
  const botCookie = await signIn(base, `ws06-bot-${tag}@example.test`);
  const h = await project(botCookie, {tax_pct: 18, tax_label: 'GST'});
  const owner = ownerOf(h.project_id);
  const phone = '+9198' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  const stranger = '+9197' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  sql(`INSERT INTO scopeflow.wa_links (owner,phone,verified,consent) VALUES (${esc(owner)}, ${esc(phone)}, ${esc(new Date().toISOString())}, ${esc(new Date().toISOString())})`);
  const payload = (from, id, text) => JSON.stringify({object: 'whatsapp_business_account', entry: [{id: 'waba', changes: [{field: 'messages', value: {messaging_product: 'whatsapp', messages: [{id, from: from.slice(1), type: 'text', timestamp: '1760000000', text: {body: text}, context: {forwarded: true}}]}}]}]});
  const sign = raw => 'sha256=' + createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  const hook = (raw, sig) => call('/api/whatsapp/webhook', {method: 'POST', raw, headers: sig ? {'X-Hub-Signature-256': sig} : {}});

  // Unsigned (or wrongly signed) -> 401, nothing handled.
  const unsignedId = 'wamid.unsigned-' + tag;
  eq((await hook(payload(phone, unsignedId, 'Can you also add a reel?'))).status, 401);
  eq((await hook(payload(phone, unsignedId, 'Can you also add a reel?'), 'sha256=' + '0'.repeat(64))).status, 401);
  eq(log.filter(l => l.kind === 'whatsapp' && l.to === phone.slice(1)).length, 0);
  eq(Number(sql(`SELECT COUNT(*)::int AS n FROM scopeflow.wa_seen WHERE message_id=${esc(unsignedId)}`)[0].n), 0);

  // Signed forward from the linked phone -> reply to that owner with the verdict and the CO link.
  const raw = payload(phone, 'wamid.fwd-' + tag, 'Can you also add a reel?');
  const r = await hook(raw, sign(raw));
  eq(r.status, 200, JSON.stringify(r.data));
  eq(r.data.results, [{kind: 'reply', status: 'sent'}]);
  const replies = log.filter(l => l.kind === 'whatsapp' && l.to === phone.slice(1));
  eq(replies.length, 1);
  ok(replies[0].text.includes('Not covered: this needs a change order'), replies[0].text);
  ok(replies[0].text.includes('Draft change order'), replies[0].text);
  const link = /Review and propose it: (\S+)/.exec(replies[0].text)?.[1] ?? '';
  ok(link.startsWith(`${base}/share?capture=`), link);
  eq(replies[0].auth, 'Bearer wa-ci-only');
  const capture = decodeURIComponent(link.split('capture=')[1]);
  eq(sql(`SELECT project_id,source FROM scopeflow.capture_drafts WHERE id=${esc(capture)}`).map(x => [x.project_id, x.source]), [[h.project_id, 'whatsapp']]);
  eq(Number(sql(`SELECT COUNT(*)::int AS n FROM scopeflow.wa_outbox WHERE owner=${esc(owner)} AND kind='reply' AND status='sent'`)[0].n), 1);
  eq((await hook(raw, sign(raw))).data.results, [{kind: 'duplicate', status: null}], 'a redelivery is not handled twice');
  // The bot never messages a client: nothing went to anyone but the linked owner.
  ok(log.filter(l => l.kind === 'whatsapp').every(l => l.to !== stranger.slice(1)));

  // Unlinked phone -> onboarding reply, nothing stored.
  const id = 'wamid.unlinked-' + tag;
  const raw2 = payload(stranger, id, 'Can you also add a reel?');
  const captures = Number(sql('SELECT COUNT(*)::int AS n FROM scopeflow.capture_drafts')[0].n);
  const u = await hook(raw2, sign(raw2));
  eq(u.data.results, [{kind: 'onboarding', status: 'sent'}]);
  const onboarding = log.filter(l => l.kind === 'whatsapp' && l.to === stranger.slice(1));
  eq(onboarding.length, 1);
  ok(onboarding[0].text.includes('link this number first'), onboarding[0].text);
  eq(Number(sql(`SELECT COUNT(*)::int AS n FROM scopeflow.wa_outbox WHERE to_phone=${esc(stranger)}`)[0].n), 0);
  eq(Number(sql(`SELECT COUNT(*)::int AS n FROM scopeflow.wa_seen WHERE message_id=${esc(id)}`)[0].n), 0);
  eq(Number(sql('SELECT COUNT(*)::int AS n FROM scopeflow.capture_drafts')[0].n), captures);
}

// ---- L11 / M11: model fallback and the draft currency -----------------------------------------------
// @covers L11 M11
{
  const aiCookie = await signIn(base, `ws06-ai-${tag}@example.test`);
  const profile = (await call('/api/profile', {cookie: aiCookie})).data.profile;
  eq((await call('/api/profile', {method: 'PUT', cookie: aiCookie, body: {...profile, default_currency: 'INR'}})).status, 200);
  const before = log.filter(l => l.kind === 'ai').length;
  const r = await call('/api/draft', {method: 'POST', cookie: aiCookie, body: {brief: 'A five page website for a dental clinic in Chennai with an online booking form', currency: 'USD'}});
  eq(r.status, 200, JSON.stringify(r.data));
  eq(log.filter(l => l.kind === 'ai').slice(before).map(l => l.model), ['gone-model', 'backup-model'], 'the retired model, then its fallback');
  eq([r.data.draft.currency, r.data.currency_source], ['USD', 'request'], 'owner default INR, request USD -> USD');
  let warning = null;
  for (let i = 0; i < 20 && !warning; i++) { warning = sql("SELECT source,message FROM scopeflow.readiness_warnings WHERE key='model:openai:gone-model'")[0] ?? null; if (!warning) await sleep(250); }
  ok(warning, 'a readiness warning names the retired model');
  eq(warning.source, 'ai');
  ok(/gone-model .*fell back to backup-model/.test(warning.message), warning.message);
  // Without a request, the owner's default applies.
  const r2 = await call('/api/draft', {method: 'POST', cookie: aiCookie, body: {brief: 'A five page website for a dental clinic in Chennai with an online booking form'}});
  eq([r2.status, r2.data.currency_source], [200, 'owner_default']);
}

console.log(`ws-06 messaging: ${passed} checks passed`);
await finish(0);
