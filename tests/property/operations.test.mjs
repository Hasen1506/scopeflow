// Product and operations (pure, no server): the mail provider adapters (Resend, Postmark, SES with
// AWS Signature V4), the production signing-key rule, owner logos and their PDF embedding, email
// forwarding parsing, embedding-based radar matching, the retention SQL, Stripe Checkout and
// webhooks, refunds on the ledger, the model-lifecycle guard and template tags.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fc} from '../support/property.mjs';

const mail = await import('../../lib/mail.ts');
const {signingSource} = await import('../../lib/signing.ts');
const img = await import('../../lib/image.ts');
const brand = await import('../../lib/brand.ts');
const inbound = await import('../../lib/inbound.ts');
const emb = await import('../../lib/embeddings.ts');
const radar = await import('../../lib/radar.ts');
const rsql = await import('../../lib/retention-sql.ts');
const stripe = await import('../../lib/stripe.ts');
const rz = await import('../../lib/razorpay.ts');
const L = await import('../../lib/ledger.ts');
const {checkModels} = await import('../../lib/llm.ts');
const {tagsSchema} = await import('../../lib/template-store.ts');
const {scopeSchema} = await import('../../lib/scope.ts');
const {renderInvoicePdf, invoiceContent} = await import('../../lib/invoice.ts');

const message = {subject: 'Please review', text: 'Hi', html: '<p>Hi</p>'};
const dir = mkdtempSync(join(tmpdir(), 'sf-ops-'));

test('mail: provider chosen from the environment; nothing without a sender', () => {
  assert.equal(mail.mailConfig({RESEND_API_KEY: 're_1'}), null, 'needs SCOPEFLOW_MAIL_FROM');
  assert.equal(mail.mailConfig({RESEND_API_KEY: 're_1', SCOPEFLOW_MAIL_FROM: 'a@b.co'}).provider, 'resend');
  assert.equal(mail.mailConfig({POSTMARK_SERVER_TOKEN: 'pm', SCOPEFLOW_MAIL_FROM: 'a@b.co'}).provider, 'postmark');
  const ses = mail.mailConfig({SCOPEFLOW_SES_ACCESS_KEY_ID: 'AKID', SCOPEFLOW_SES_SECRET_ACCESS_KEY: 's', SCOPEFLOW_SES_REGION: 'ap-south-1', SCOPEFLOW_MAIL_FROM: 'a@b.co'});
  assert.deepEqual([ses.provider, ses.region], ['ses', 'ap-south-1']);
  assert.equal(mail.mailConfig({SCOPEFLOW_SES_ACCESS_KEY_ID: 'AKID', SCOPEFLOW_SES_SECRET_ACCESS_KEY: 's', SCOPEFLOW_SES_REGION: 'mars', SCOPEFLOW_MAIL_FROM: 'a@b.co'}), null, 'region checked');
  // Several configured: Resend first, unless SCOPEFLOW_MAIL_PROVIDER picks another; a named provider without keys is off.
  const both = {RESEND_API_KEY: 're_1', POSTMARK_SERVER_TOKEN: 'pm', SCOPEFLOW_MAIL_FROM: 'a@b.co'};
  assert.equal(mail.mailConfig(both).provider, 'resend');
  assert.equal(mail.mailConfig({...both, SCOPEFLOW_MAIL_PROVIDER: 'postmark'}).provider, 'postmark');
  assert.equal(mail.mailConfig({...both, SCOPEFLOW_MAIL_PROVIDER: 'ses'}), null);
});

test('mail: each provider gets its own request shape, with the branded sender and reply-to', () => {
  const base = {from: 'Scopeflow <scopes@example.com>', replyTo: null, apiUrl: null};
  const r = mail.mailRequest({...base, provider: 'resend', apiKey: 're_1'}, 'c@x.co', message, {idempotencyKey: 'k1', fromName: 'Asha Design', replyTo: 'asha@studio.in'});
  assert.equal(r.url, 'https://api.resend.com/emails');
  assert.equal(r.headers['Idempotency-Key'], 'k1');
  assert.deepEqual(JSON.parse(r.body), {from: '"Asha Design via Scopeflow" <scopes@example.com>', to: ['c@x.co'], subject: 'Please review', text: 'Hi', html: '<p>Hi</p>', reply_to: 'asha@studio.in'});
  const p = mail.mailRequest({...base, provider: 'postmark', apiKey: 'pm', stream: 'outbound'}, 'c@x.co', message);
  assert.equal(p.headers['X-Postmark-Server-Token'], 'pm');
  assert.deepEqual(JSON.parse(p.body), {From: 'Scopeflow <scopes@example.com>', To: 'c@x.co', Subject: 'Please review', TextBody: 'Hi', HtmlBody: '<p>Hi</p>', MessageStream: 'outbound'});
  const s = mail.mailRequest({...base, provider: 'ses', apiKey: 'AKID', secretKey: 'secret', region: 'ap-south-1', sessionToken: null}, 'c@x.co', message, {now: new Date('2026-10-09T10:00:00Z')});
  assert.equal(s.url, 'https://email.ap-south-1.amazonaws.com/v2/email/outbound-emails');
  assert.match(s.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKID\/20261009\/ap-south-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(JSON.parse(s.body).Content.Simple.Body.Html.Data, '<p>Hi</p>');
  // Header injection: names with quotes, angle brackets or newlines cannot break the From header.
  assert.equal(mail.brandedFrom('scopes@example.com', 'Evil"\r\nBcc: x@y <z>'), '"Evil Bcc: x@y z via Scopeflow" <scopes@example.com>');
  assert.equal(mail.brandedFrom('scopes@example.com', ''), 'scopes@example.com');
});

test('mail: AWS Signature V4 matches the published get-vanilla vector', () => {
  const h = mail.sigV4({method: 'GET', url: 'https://example.amazonaws.com/', headers: {}, body: '', accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service', now: new Date('2015-08-30T12:36:00Z')});
  assert.equal(h.Authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  assert.equal(h['x-amz-date'], '20150830T123600Z');
});

test('mail: sendMail reads each provider’s answer; Postmark error codes count as refusals', async () => {
  const reply = (status, body) => async () => new Response(JSON.stringify(body), {status});
  const pm = {provider: 'postmark', apiKey: 'pm', from: 'a@b.co', replyTo: null, apiUrl: null};
  assert.deepEqual(await mail.sendMail(pm, 'c@x.co', message, undefined, {fetchImpl: reply(200, {ErrorCode: 0, MessageID: 'm-1'})}), {id: 'm-1'});
  await assert.rejects(mail.sendMail(pm, 'c@x.co', message, undefined, {fetchImpl: reply(200, {ErrorCode: 406, Message: 'Inactive recipient'})}), /refused the message: Inactive recipient/);
  await assert.rejects(mail.sendMail(pm, 'c@x.co', message, undefined, {fetchImpl: async () => { throw new Error('down'); }}), /could not be reached/);
  const ses = {provider: 'ses', apiKey: 'AKID', secretKey: 's', region: 'eu-west-1', from: 'a@b.co', replyTo: null, apiUrl: null};
  assert.deepEqual(await mail.sendMail(ses, 'c@x.co', message, undefined, {fetchImpl: reply(200, {MessageId: 'ses-1'})}), {id: 'ses-1'});
});

test('mail: the brand header escapes the owner’s name and only accepts a hex colour', () => {
  const m = mail.brandEmail(message, {name: '<b>Asha</b>', color: 'red;background:url(x)', logoUrl: null});
  assert.match(m.html, /^<div style="border-top:4px solid #d0d7de;/);
  assert.match(m.html, /&lt;b&gt;Asha&lt;\/b&gt;/);
  assert.equal(mail.brandEmail(message, null), message);
  assert.match(mail.brandEmail(message, {name: 'Asha', color: '#1f6feb', logoUrl: 'https://app.example/api/brand/' + 'a'.repeat(32)}).html, /<img src="https:\/\/app\.example\/api\/brand\/a{32}" alt="Asha"/);
});

test('signing: production never signs with the cookie secret unless explicitly allowed', () => {
  const cookie = {NEON_AUTH_COOKIE_SECRET: 'c'.repeat(40)};
  assert.equal(signingSource({...cookie, NODE_ENV: 'development'}), 'cookie_fallback');
  assert.equal(signingSource({...cookie, NODE_ENV: 'production'}), 'off');
  assert.equal(signingSource({...cookie, NODE_ENV: 'production', SCOPEFLOW_ALLOW_COOKIE_SIGNING: '1'}), 'cookie_fallback');
  assert.equal(signingSource({...cookie, NODE_ENV: 'production', SCOPEFLOW_SIGNING_SECRET: 's'.repeat(40)}), 'dedicated');
  assert.equal(signingSource({NODE_ENV: 'production', SCOPEFLOW_SIGNING_SECRET: 'short'}), 'off');
});

// Minimal PNG writer for the tests: one IDAT, filter 0 on every row.
function png(width, height, type, rows, extra = []) {
  const crc = buf => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); Buffer.from(d).copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = type;
  const raw = Buffer.concat(rows.map(r => Buffer.from([0, ...r])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra.map(([t, d]) => chunk(t, Buffer.from(d))), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
// A 3×2 RGB baseline JPEG (ImageMagick: convert -size 3x2 xc:'#336699' -quality 80 jpg:-).
const JPEG = '/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJAAnHX/2Q==';

test('logos: PNG (RGB, RGBA, palette) and JPEG are decoded; anything else is refused with a reason', () => {
  const rgba = img.parseLogo(dataUrl('image/png', png(2, 2, 6, [[255, 0, 0, 255, 0, 255, 0, 128], [0, 0, 255, 255, 255, 255, 255, 0]])));
  assert.deepEqual([rgba.width, rgba.height, rgba.mime], [2, 2, 'image/png']);
  assert.match(rgba.hash, /^[0-9a-f]{32}$/);
  const d = img.decodePng(rgba.bytes);
  assert.deepEqual([...d.pixels], [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  assert.deepEqual([...d.alpha], [255, 128, 255, 0]);
  const opaque = img.decodePng(png(1, 1, 2, [[9, 8, 7]]));
  assert.equal(opaque.alpha, null);
  const palette = img.decodePng(png(2, 1, 3, [[1, 0]], [['PLTE', [0, 0, 0, 200, 100, 50]], ['tRNS', [0]]]));
  assert.deepEqual([...palette.pixels], [200, 100, 50, 0, 0, 0]);
  assert.deepEqual([...palette.alpha], [255, 0]);
  const jpeg = img.parseLogo('data:image/jpeg;base64,' + JPEG);
  assert.deepEqual([jpeg.width, jpeg.height], [3, 2]);
  assert.equal(img.pdfImage(jpeg).colors, 3);
  assert.equal(img.pdfImage(jpeg).filter, 'DCTDecode');
  assert.throws(() => img.parseLogo('data:image/gif;base64,R0lGOD'), /PNG or JPEG/);
  assert.throws(() => img.parseLogo(dataUrl('image/png', Buffer.from('not a png at all, just text padding'))), /not a valid PNG/);
  assert.throws(() => img.parseLogo(dataUrl('image/png', Buffer.alloc(img.LOGO_MAX_BYTES + 1))), /under 150 KB/);
  const huge = png(1, 1, 2, [[0, 0, 0]]); huge.writeUInt32BE(5000, 16);
  assert.throws(() => img.parseLogo(dataUrl('image/png', huge)), /at most 2000 pixels/);
});

test('logos: a branded invoice PDF embeds the logo (with its transparency) and draws the accent bar', () => {
  const logo = img.parseLogo(dataUrl('image/png', png(2, 2, 6, [[255, 0, 0, 255, 0, 255, 0, 128], [0, 0, 255, 255, 255, 255, 255, 0]])));
  const b = brand.pdfBrand({name: 'Asha Design', color: '#1f6feb', logo, replyTo: null});
  assert.deepEqual(b.rgb.map(x => Math.round(x * 255)), [31, 111, 235]);
  const content = invoiceContent({number: 'INV-1', issued: '2026-10-09', due_days: 15, description: 'Balance', amount: 100, seller: {name: 'Asha Design', address: '', tax_id: '', payment_details: ''}, client: {name: 'Acme', email: ''}, project: {id: 'p1', title: 'Brand refresh', version: 1}, currency: 'USD', tax_label: '', tax_pct: 0, agreed_total: 100, paid: 0, payment_terms: ''});
  const pdf = renderInvoicePdf(content, b);
  writeFileSync(join(dir, 'inv.pdf'), pdf);
  const list = execFileSync('pdfimages', ['-list', join(dir, 'inv.pdf')]).toString();
  assert.match(list, /\bimage\s+2\s+2\s+rgb\b/);
  assert.match(list, /\bsmask\s+2\s+2\s+gray\b/);
  assert.match(Buffer.from(pdf).toString('latin1'), /0\.12 0\.44 0\.92 rg 0 835\.89 595\.28 6 re f/);
  assert.equal(brand.pdfBrand(null), null);
  assert.equal(brand.pdfBrand({name: 'x', color: null, logo: null, replyTo: 'a@b.co'}), null, 'nothing to draw');
  // Unbranded invoices are unchanged (no image, no colour).
  assert.doesNotMatch(Buffer.from(renderInvoicePdf(content)).toString('latin1'), /\/XObject| rg /);
  assert.equal(brand.textSafe('#ffff00'), null, 'yellow on white is unreadable');
  assert.equal(brand.textSafe('#1a4fb0'), '#1a4fb0');
});

test('inbound: Postmark and generic payloads parse; the project token comes from the address', () => {
  const pm = inbound.parseInbound({FromFull: {Email: 'Owner@Studio.in'}, ToFull: [{Email: 'scope-0123456789abcdef01234567@in.example.com', Name: ''}], Subject: 'Fwd: one more thing\r\nBcc: x', TextBody: 'please also add a banner', MessageID: 'abc-1'});
  // changed by WS-06 (L7): the parse also returns the envelope recipients and the SPF/DKIM/DMARC verdicts.
  assert.deepEqual(pm, {recipients: ['scope-0123456789abcdef01234567@in.example.com'], envelope: [], from: 'owner@studio.in', subject: 'Fwd: one more thing Bcc: x', text: 'please also add a banner', messageId: 'abc-1', auth: {spf: null, dkim: null, dmarc: null}});
  const generic = inbound.parseInbound({from: 'A <a@b.co>', to: 'X <scope-0123456789abcdef01234567+fwd@in.example.com>, other@b.co', subject: 's', html: '<p>Hello<br>there &amp; you</p>'});
  assert.equal(generic.text, 'Hello\nthere & you');
  assert.equal(inbound.tokenFrom(generic.recipients, 'in.example.com'), '0123456789abcdef01234567');
  assert.equal(inbound.tokenFrom(generic.recipients, 'other.example.com'), null, 'only the configured domain');
  assert.equal(inbound.parseInbound({to: 'a@b.co'}), null, 'no body');
  assert.equal(inbound.inboundAddress('0123456789abcdef01234567', {SCOPEFLOW_INBOUND_DOMAIN: 'in.example.com', SCOPEFLOW_INBOUND_SECRET: 'x'.repeat(20)}), 'scope-0123456789abcdef01234567@in.example.com');
  assert.equal(inbound.inboundAddress('t', {SCOPEFLOW_INBOUND_DOMAIN: 'in.example.com', SCOPEFLOW_INBOUND_SECRET: 'short'}), null, 'secret too short: off');
});

test('inbound: the client’s words are taken out of a forwarded email', () => {
  const gmail = 'FYI, see below.\n\n---------- Forwarded message ---------\nFrom: Ada <ada@acme.co>\nDate: Thu, 8 Oct 2026\nSubject: Logo\nTo: Me <me@studio.in>\n\nCould you also design business cards?\nThanks, Ada\n-- \nSent from my phone';
  assert.equal(inbound.clientMessage(gmail), 'Could you also design business cards?\nThanks, Ada');
  assert.equal(inbound.clientMessage('> Can we add a page?\n> Thanks'), 'Can we add a page?\nThanks');
  assert.equal(inbound.clientMessage('Plain request with no forward marker.'), 'Plain request with no forward marker.');
  fc.assert(fc.property(fc.string({maxLength: 6000}), s => inbound.clientMessage(s).length <= 4000));
});

test('inbound: the webhook secret is checked as a bearer token or a basic-auth password', () => {
  const secret = 'inbound-secret-0123456789';
  assert.equal(inbound.inboundAuthorized('Bearer ' + secret, secret), true);
  assert.equal(inbound.inboundAuthorized('Basic ' + Buffer.from('postmark:' + secret).toString('base64'), secret), true);
  assert.equal(inbound.inboundAuthorized('Basic ' + Buffer.from('postmark:wrong').toString('base64'), secret), false);
  assert.equal(inbound.inboundAuthorized(null, secret), false);
  assert.equal(inbound.inboundAuthorized('Bearer ' + secret.slice(0, -1), secret), false);
});

// Embedding stub: each text becomes a bag of "concepts", so Hindi and English words for the same
// thing land on the same axis (what a multilingual embedding model does, made deterministic).
const CONCEPTS = [['hosting', 'होस्टिंग', 'server', 'domain'], ['logo', 'लोगो'], ['card', 'cards', 'कार्ड'], ['seo', 'search']];
const vector = t => CONCEPTS.map(words => words.filter(w => t.toLowerCase().includes(w)).length + 0.01);
const embedFetch = (calls = []) => async (_url, init) => { const body = JSON.parse(init.body); calls.push(body); return new Response(JSON.stringify({data: body.input.map((t, index) => ({index, embedding: vector(t)}))}), {status: 200}); };

test('embeddings: off without a provider and key; similarity ranking is stable', () => {
  assert.equal(emb.embeddingConfig({OPENAI_API_KEY: 'sk'}), null, 'opt-in only');
  assert.equal(emb.embeddingConfig({SCOPEFLOW_EMBEDDINGS: 'openai'}), null, 'needs the key');
  assert.deepEqual(emb.embeddingConfig({SCOPEFLOW_EMBEDDINGS: 'openai', OPENAI_API_KEY: 'sk'}), {provider: 'openai', apiKey: 'sk', model: 'text-embedding-3-small', url: 'https://api.openai.com/v1/embeddings'});
  assert.equal(emb.embeddingConfig({SCOPEFLOW_EMBEDDINGS: 'voyage', VOYAGE_API_KEY: 'v'}).model, 'voyage-3.5');
  assert.equal(emb.cosine([1, 0], [1, 0]), 1);
  assert.equal(emb.cosine([1, 0], [0, 1]), 0);
  assert.deepEqual(emb.rankBySimilarity([1, 0], [{id: 'B', vector: [0, 1]}, {id: 'A', vector: [1, 0]}]).map(m => m.id), ['A', 'B']);
  fc.assert(fc.property(fc.array(fc.integer({min: -500, max: 500}).map(n => n / 100), {minLength: 1, maxLength: 8}), v => { const c = emb.cosine(v, v.map(x => x * 3)); return v.every(x => x === 0) ? c === 0 : Math.abs(c - 1) < 1e-9; }));
});

const scope = scopeSchema.parse({title: 'Brand kit', client: 'Acme', deliverables: '', items: [{id: 'logo', title: 'Logo design', qty: 1}], exclusions: 'Website hosting on our server\nSEO', fee: 1000, currency: 'INR', revisions: 2, due: '', notes: ''});
const agreement = L.computeAgreement(scope, 1, []);

test('radar: a Hindi request the keywords cannot place is matched by meaning to the English exclusion', async () => {
  const msg = 'क्या आप वेबसाइट होस्टिंग भी सेट कर देंगे?';
  const keyword = radar.keywordRadar(msg, scope, agreement);
  assert.equal(keyword.verdict, 'ambiguous');
  const calls = [];
  const config = {provider: 'openai', apiKey: 'sk', model: 'test-embed', url: 'http://stub/embeddings'};
  const r = await radar.scopeRadar(msg, scope, agreement, {embeddings: config, fetchImpl: embedFetch(calls)});
  assert.equal(r.engine, 'embedding');
  assert.equal(r.verdict, 'out_of_scope');
  assert.equal(r.citations[0].kind, 'exclusion');
  assert.match(r.citations[0].text, /hosting/i);
  assert.ok(r.change_order, 'drafts a change order');
  assert.equal(r.semantic[0].id, r.citations[0].id);
  // Clause vectors are cached: a second request embeds only the new message.
  await radar.scopeRadar('लोगो का रंग बदल दें', scope, agreement, {embeddings: config, fetchImpl: embedFetch(calls)});
  assert.equal(calls[1].input.length, 1);
  // An unreachable embedding service falls back to the keyword check with a note.
  const down = await radar.scopeRadar('something new entirely', scope, agreement, {embeddings: {...config, model: 'other'}, fetchImpl: async () => { throw new Error('x'); }});
  assert.equal(down.engine, 'keyword');
  assert.match(down.note, /meaning match was unavailable/);
});

test('radar: semantic matches never override a keyword verdict, and need a clear lead over the next clause', () => {
  const kw = radar.keywordRadar('please also add a website hosting plan', scope, agreement);
  assert.notEqual(kw.verdict, 'ambiguous');
  assert.equal(radar.semanticRadar(kw, [{id: 'D1', score: 0.99}], 'x', scope, agreement).verdict, kw.verdict);
  const amb = radar.keywordRadar('क्या?', scope, agreement);
  assert.equal(radar.semanticRadar(amb, [{id: 'X1', score: 0.7}, {id: 'D1', score: 0.69}], 'क्या?', scope, agreement).verdict, 'ambiguous', 'too close to call');
  assert.equal(radar.semanticRadar(amb, [{id: 'X1', score: 0.3}], 'क्या?', scope, agreement).verdict, 'ambiguous', 'below the floor');
  assert.equal(radar.semanticRadar(amb, [{id: 'D1', score: 0.8}, {id: 'X1', score: 0.2}], 'क्या?', scope, agreement).verdict, 'in_scope');
  assert.equal(radar.semanticFloor({SCOPEFLOW_EMBEDDING_MIN: '0.6'}), 0.6);
  assert.equal(radar.semanticFloor({SCOPEFLOW_EMBEDDING_MIN: '7'}), 0.45);
  assert.match(radar.radarPrompt('m', radar.clausesOf(scope, agreement), [{id: 'X1', score: 0.71}]).user, /closest in meaning to the request \(similarity, a hint only\): X1 0\.71/);
});

test('retention SQL: legal hold is excluded everywhere; placeholders match the parameters', () => {
  const count = sql => (sql.match(/\?/g) ?? []).length;
  for (const owner of ['o1', null]) {
    const q = rsql.redactionQueries(owner, 30, '2026-10-09T00:00:00.000Z');
    for (const [sql, params] of [q.versions, q.entries]) {
      assert.equal(count(sql), params.length, sql);
      assert.match(sql, /NOT p\.legal_hold/);
      assert.match(sql, /coalesce\(p\.retention_days, s\.context_retention_days, \?::int\)/);
    }
    const [drafts, dp] = rsql.expiredDraftsQuery(owner, '2026-10-09T00:00:00.000Z');
    assert.equal(count(drafts), dp.length);
    assert.match(drafts, /p\.archived IS NOT NULL AND NOT p\.legal_hold/);
    assert.match(drafts, /status<>'pending'/);
  }
  // changed by WS-08 (WS-10 C7): draft deletion is one call to a SECURITY DEFINER function; its
  // legal-hold and evidence re-checks live in migration 0022a (tests/property/ws-08-modes-billing).
  const [del, delParams] = rsql.deleteDraftQuery('p1', 'o1');
  assert.equal(count(del), delParams.length, del);
  assert.match(del, /^SELECT scopeflow\.ws08_delete_draft\(\?, \?\)/);
});

test('stripe: form encoding, signature check, paid events and provider choice', () => {
  assert.equal(stripe.stripeForm({mode: 'payment', line_items: [{quantity: 1, price_data: {currency: 'usd', unit_amount: 1250}}], metadata: {project_id: 'p 1'}, skip: undefined}),
    'mode=payment&line_items%5B0%5D%5Bquantity%5D=1&line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=usd&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=1250&metadata%5Bproject_id%5D=p%201');
  const secret = 'whsec_test', body = '{"id":"evt_1"}', t = 1_790_000_000;
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  assert.equal(stripe.verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, t * 1000), true);
  assert.equal(stripe.verifyStripeSignature(body, `t=${t},v1=bad,v1=${sig}`, secret, t * 1000), true, 'any v1 may match (secret rotation)');
  assert.equal(stripe.verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, secret, t * 1000), false);
  assert.equal(stripe.verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, (t + 301) * 1000), false, 'replay window');
  assert.equal(stripe.verifyStripeSignature(body, null, secret), false);
  const session = {id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 1250, currency: 'usd'};
  assert.deepEqual(stripe.stripePaidEvent({id: 'evt_1', type: 'checkout.session.completed', data: {object: session}}), {event_id: 'evt_1', order_id: 'cs_1', payment_id: 'pi_1', amount_minor: 1250, currency: 'USD'});
  assert.equal(stripe.stripePaidEvent({type: 'checkout.session.completed', data: {object: {...session, payment_status: 'unpaid'}}}), null);
  assert.equal(stripe.stripePaidEvent({type: 'payment_intent.created', data: {object: session}}), null);
  assert.equal(stripe.stripeConfig({STRIPE_SECRET_KEY: 'pk_test_1'}), null, 'a publishable key is refused');
  // changed by WS-04: operator Razorpay keys need RAZORPAY_WEBHOOK_SECRET (H7), and outside development
  // they never take a client payment (C3; covered in tests/property/ws-04-payments.test.mjs).
  const both = {RAZORPAY_KEY_ID: 'rzp', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w', STRIPE_SECRET_KEY: 'sk_test_1'};
  assert.equal(rz.providerFor('INR', both), 'razorpay');
  assert.equal(rz.providerFor('USD', both), 'stripe');
  assert.equal(rz.providerFor('USD', {RAZORPAY_KEY_ID: 'rzp', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w'}), 'razorpay');
  assert.equal(rz.providerFor('INR', {RAZORPAY_KEY_ID: 'rzp', RAZORPAY_KEY_SECRET: 's'}), null, 'no webhook secret: misconfigured');
  assert.equal(rz.providerFor('INR', {...both, NODE_ENV: 'production'}), null, 'operator keys refused in production');
  assert.equal(rz.providerFor('INR', {STRIPE_SECRET_KEY: 'sk_test_1'}), 'stripe');
  assert.equal(rz.providerFor('INR', {}), null);
  assert.equal(rz.providerFor('USD', {STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_CURRENCIES: 'eur, gbp'}), null, 'STRIPE_CURRENCIES limits Stripe');
  assert.equal(rz.providerFor('EUR', {STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_CURRENCIES: 'eur, gbp'}), 'stripe');
  assert.equal(rz.paymentsStatus({STRIPE_SECRET_KEY: 'sk_live_x'}, 'EUR').provider, 'stripe');
});

test('stripe: checkout sessions and refunds send the right requests and read the answers', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({url, init}); return new Response(JSON.stringify(url.endsWith('/v1/refunds') ? {id: 're_1', status: 'succeeded'} : {id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1'}), {status: 200}); };
  const env = {STRIPE_API_URL: 'http://stub'};
  const s = await stripe.createCheckoutSession({secretKey: 'sk_test_1'}, {amount_minor: 1250, currency: 'USD', name: 'Invoice INV-1', description: 'Brand kit', success_url: 'https://app/payment-return?status=success', cancel_url: 'https://app/payment-return?status=cancel', metadata: {project_id: 'p1', purpose: 'invoice'}, idempotencyKey: 'k'}, {fetchImpl, env});
  assert.deepEqual(s, {id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1'});
  assert.equal(calls[0].url, 'http://stub/v1/checkout/sessions');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'k');
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '1250');
  assert.equal(form.get('line_items[0][price_data][currency]'), 'usd');
  assert.equal(form.get('payment_intent_data[metadata][purpose]'), 'invoice');
  assert.doesNotMatch(calls[0].init.body, /review/, 'the review link never goes to Stripe');
  assert.deepEqual(await stripe.stripeRefund({secretKey: 'sk_test_1'}, 'pi_1', 500, 'r1', {fetchImpl, env}), {id: 're_1', status: 'succeeded'});
  assert.equal(new URLSearchParams(calls[1].init.body).get('amount'), '500');
  await assert.rejects(stripe.createCheckoutSession({secretKey: 'sk_test_1'}, {amount_minor: 1, currency: 'USD', name: 'x', description: '', success_url: 'a', cancel_url: 'b', metadata: {}}, {fetchImpl: async () => new Response('{"error":{"message":"No such price"}}', {status: 400}), env}), /Stripe refused the request: No such price/);
});

test('refunds: lower the amount paid, are refundable only up to the payment, and only the creator records them', () => {
  const entry = (seq, kind, payload) => ({seq, kind, baseline_version: 1, actor: kind === 'payment' ? 'system' : 'owner', created: '2026-10-09T10:00:00.000Z', payload});
  const entries = [
    entry(1, 'payment', {provider: 'stripe', purpose: 'deposit', order_id: 'cs_1', payment_id: 'pi_1', amount: 300, currency: 'USD'}),
    entry(2, 'payment_received', {amount: 200, method: 'bank_transfer', received: '2026-10-08', reference: '', note: ''}),
    entry(3, 'refund', {amount: 120, method: 'stripe', refunded: '2026-10-09', reference: '', note: 'Dropped D3', provider_refund_id: 're_1', refund_of: 1}),
  ];
  const {lines, paid} = L.paymentsOf(entries);
  assert.equal(paid, 380);
  assert.deepEqual(lines.map(l => [l.source, l.amount]), [['stripe', 300], ['owner', 200], ['refund', -120]]);
  assert.equal(L.refundableOf(lines[0], lines), 180);
  assert.equal(L.refundableOf(lines[1], lines), 0, 'offline payments are refunded offline');
  assert.equal(L.describeEntry(entries[2], 'USD'), 'Refund: $120.00 returned through Stripe on 9 Oct 2026: Dropped D3');
  assert.equal(L.payloadSchemas.refund.safeParse({amount: 0, method: 'upi', refunded: '2026-10-09'}).success, false);
  assert.equal(L.payloadSchemas.refund.safeParse({amount: 10, method: 'paypal', refunded: '2026-10-09'}).success, false);
  const ok = L.payloadSchemas.refund.parse({amount: 10, method: 'upi', refunded: '2026-10-09'});
  assert.equal(L.checkEntry('refund', ok, scope, agreement, 'owner'), null);
  assert.match(L.checkEntry('refund', ok, scope, agreement, 'client'), /Only the creator/);
  assert.match(L.checkEntry('refund', {...ok, refunded: '2999-01-01'}, scope, agreement, 'owner'), /future/);
  fc.assert(fc.property(fc.array(fc.integer({min: 1, max: 100000}), {maxLength: 6}), fc.array(fc.integer({min: 1, max: 100000}), {maxLength: 6}), (ins, outs) => {
    const list = [...ins.map((a, i) => entry(i + 1, 'payment_received', {amount: a / 100, method: 'upi', received: '2026-10-01', reference: '', note: ''})), ...outs.map((a, i) => entry(100 + i, 'refund', {amount: a / 100, method: 'upi', refunded: '2026-10-02', reference: '', note: ''}))];
    return Math.abs(L.paymentsOf(list).paid - (ins.reduce((s, a) => s + a, 0) - outs.reduce((s, a) => s + a, 0)) / 100) < 0.005;
  }));
});

test('razorpay: refunds post the amount to the payment and read the refund id', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({url, init}); return new Response(JSON.stringify({id: 'rfnd_1', status: 'processed'}), {status: 200}); };
  assert.deepEqual(await rz.razorpayRefund({keyId: 'rzp', keySecret: 's'}, 'pay_9', 1500, 'sf-p1-3', fetchImpl, {RAZORPAY_API_URL: 'http://stub'}), {id: 'rfnd_1', status: 'processed'});
  assert.equal(calls[0].url, 'http://stub/v1/payments/pay_9/refund');
  assert.deepEqual(JSON.parse(calls[0].init.body), {amount: 1500, receipt: 'sf-p1-3'});
  await assert.rejects(rz.razorpayRefund({keyId: 'rzp', keySecret: 's'}, 'pay_9', 1, 'r', async () => new Response('{"error":{"description":"The refund amount is greater"}}', {status: 400})), /refused the refund: The refund amount is greater/);
});

test('model guard: a model the provider no longer serves is reported; retirements warn ahead', async () => {
  const seen = [];
  const fetchImpl = async url => { seen.push(url); return new Response('{}', {status: url.includes('claude-haiku-4-5') ? 404 : 200}); };
  const r = await checkModels({ANTHROPIC_API_KEY: 'k', SCOPEFLOW_ANTHROPIC_MODEL: 'claude-haiku-4-5'}, {today: '2026-10-09', fetchImpl});
  assert.deepEqual(r.map(x => [x.tier, x.model, x.status]), [['fast', 'claude-haiku-4-5', 'missing'], ['careful', 'claude-sonnet-5-5', 'available']]);
  assert.match(r[0].warning, /not served by anthropic any more .* SCOPEFLOW_ANTHROPIC_MODEL to a current model/);
  assert.equal(r[1].warning, null);
  assert.equal(seen[0], 'https://api.anthropic.com/v1/models/claude-haiku-4-5');
  const soon = await checkModels({ANTHROPIC_API_KEY: 'k', SCOPEFLOW_ANTHROPIC_MODEL: 'claude-haiku-4-5'}, {today: '2026-10-09', fetchImpl: async () => new Response('{}', {status: 200})});
  assert.match(soon[0].warning, /scheduled to retire on 2026-10-15/);
  const down = await checkModels({OPENAI_API_KEY: 'k'}, {fetchImpl: async () => { throw new Error('offline'); }});
  assert.deepEqual(down.map(x => x.status), ['unreachable', 'unreachable']);
  assert.deepEqual(await checkModels({}), [], 'no key, nothing to check');
});

test('templates: tags are trimmed, lower-cased, de-duplicated and limited', () => {
  assert.deepEqual(tagsSchema.parse([' Branding ', 'branding', 'Retainer/Monthly']), ['branding', 'retainer/monthly']);
  assert.deepEqual(tagsSchema.parse(['ब्रांडिंग']), ['ब्रांडिंग']);
  assert.equal(tagsSchema.safeParse(Array.from({length: 9}, (_, i) => 't' + i)).success, false);
  assert.equal(tagsSchema.safeParse(['<script>']).success, false);
  assert.equal(tagsSchema.safeParse(['x'.repeat(25)]).success, false);
});
