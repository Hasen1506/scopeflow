// WS-06: outbound mail. Pure (no server, no network): owner text inside the fixed templates (M19),
// the mail router's failover across providers (SF-19), provider request shapes with the
// List-Unsubscribe header, signed unsubscribe links and the bounce/complaint webhook parsers.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, freezeClock, TEST_SECRET} from '../support/property.mjs';

freezeClock();
const mail = await import('../../lib/mail.ts');
const router = await import('../../lib/mail-router.ts');
const unsub = await import('../../lib/unsubscribe.ts');
const events = await import('../../lib/mail-events.ts');

const LINK = 'https://scopeflow.example/review/' + 'a'.repeat(64);
// Owner text that tries hard to smuggle links and markup in.
const nasty = fc.oneof(
  fc.string({maxLength: 80}),
  fc.constantFrom('http://evil.test/login', 'https://bank.example/verify?x=1', 'www.phish.co', 'evil.com', 'pay at acme.in/now', 'mail me@evil.test', 'javascript:alert(1)', 'data:text/html,<b>x</b>', '<a href="http://x.y">click</a>', '<img src=x onerror=alert(1)>', '<script>alert(1)</script>', 'HTTP://SHOUT.EXAMPLE', 'ftp://files.example/x', '{link}', '\r\nBcc: victim@x.test', 'Node.js app', 'v1.5 release', 'e.g. this'),
);
const ownerText = fc.array(nasty, {minLength: 1, maxLength: 4}).map(parts => parts.join(' '));
const urls = text => (text.match(/\b(?:[a-z][a-z0-9+.-]{1,15}:\/\/|www\.)[^\s<>"']*/gi) ?? []);
const bareDomains = text => (text.match(/[a-z0-9_%+-]\.(?=(?=[a-z0-9-]*[a-z])[a-z0-9-]{2,63}\b)/gi) ?? []);
const anchors = html => [...html.matchAll(/<a\b[^>]*href="([^"]*)"/gi)].map(m => m[1]);
const tags = html => [...html.matchAll(/<\/?([a-z0-9]+)[\s>/]/gi)].map(m => m[1].toLowerCase());
const ALLOWED_TAGS = new Set(['p', 'strong', 'a', 'br']);

function assertSafe(m, link) {
  // Text: the only URL is the record link (the owner's wording may place {link} more than once);
  // no other scheme link, no auto-linkable bare domain.
  assert.deepEqual([...new Set(urls(m.text))], [link], m.text);
  assert.deepEqual(bareDomains(m.text.replaceAll(link, '')), [], m.text);
  assert.doesNotMatch(m.subject, /[\r\n]/);
  assert.deepEqual(urls(m.subject), []);
  // HTML: every anchor goes to the record link; only the template's own tags (owner markup is escaped).
  assert.deepEqual([...new Set(anchors(m.html))], [link]);
  assert.ok(tags(m.html).every(t => ALLOWED_TAGS.has(t)), m.html);
  assert.deepEqual(urls(m.html.replaceAll(`href="${link}"`, '').replaceAll(link, '')), [], m.html);
  assert.deepEqual(bareDomains(m.html.replaceAll(link, '')), [], m.html);
}

// @covers M19
test('M19: owner text never yields a second link or raw HTML in any client template', () => {
  fc.assert(fc.property(ownerText, ownerText, ownerText, ownerText, fc.integer({min: 1, max: 99}), (title, client, seller, extra, n) => {
    assertSafe(mail.signatureEmail({title, client, version: n, reviewUrl: LINK}), LINK);
    assertSafe(mail.signatureEmail({title, client, version: n, reviewUrl: LINK, template: {subject: extra, body: `${extra}\n\n{link}\n\n${seller} {title} {client}`}}), LINK);
    assertSafe(mail.reminderEmail({title, client, version: n, reviewUrl: LINK, days: n}), LINK);
    assertSafe(mail.changeOrderEmail({title, client, seller, seq: n, coTitle: extra, amount: '₹1,180.00', taxNote: 'incl. GST 18%', reviewUrl: LINK}), LINK);
    assertSafe(mail.invoiceIssuedEmail({title, client, seller, number: extra, amount: '₹1,180.00', due: '2026-11-01', reviewUrl: LINK}), LINK);
    assertSafe(mail.invoiceReminderEmail({title, client, number: extra, amount: '₹1,180.00', due: '2026-11-01', days: n, reviewUrl: LINK, seller}), LINK);
    assertSafe(mail.cosignInviteEmail({title, role: extra, seller, reviewUrl: LINK}), LINK);
    assertSafe(mail.accountClosedEmail({title, client, seller, reviewUrl: LINK}), LINK);
    assertSafe(mail.tdsCertificateEmail({title, client, seller, number: extra, amount: '₹2,000.00', quarter: 'Q1 FY 2026-27', reviewUrl: LINK}), LINK);
  }));
});

// @covers M19
test('M19: link-free owner text keeps ordinary words and is idempotent', () => {
  assert.equal(mail.linkFree('Logo for Acme Ltd, version 1.5'), 'Logo for Acme Ltd, version 1.5');
  assert.equal(mail.linkFree('see https://evil.test/x now'), 'see [link removed] now');
  assert.equal(mail.linkFree('pay acme.in'), 'pay acme[.]in');
  fc.assert(fc.property(ownerText, s => { const once = mail.linkFree(s); assert.equal(mail.linkFree(once), once); }));
});

// ---- SF-19: router ----------------------------------------------------------------------------
const configsAll = Object.fromEntries(['resend', 'postmark', 'ses'].map(p => [p, {provider: p, apiKey: 'k', from: 'S <s@x.example>', replyTo: null, apiUrl: null, secretKey: 's', region: 'eu-west-1'}]));
const outcome = fc.constantFrom('ok', '5xx', 'timeout', '4xx');
// @covers SF-19
test('SF-19: for any provider failure pattern, a deliverable message is attempted on the next provider exactly once', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...router.MAIL_CLASSES), fc.record({resend: outcome, postmark: outcome, ses: outcome}), fc.record({resend: fc.boolean(), postmark: fc.boolean(), ses: fc.boolean()}), fc.subarray(['resend', 'postmark', 'ses'], {minLength: 1}), async (cls, pattern, open, configured) => {
    const configs = Object.fromEntries(configured.map(p => [p, configsAll[p]]));
    const now = 1_000_000;
    const breaker = new router.CircuitBreaker(1, 60_000, () => now);
    for (const p of Object.keys(open)) if (open[p]) breaker.failure(p);
    const calls = [];
    const send = async config => {
      calls.push(config.provider);
      const r = pattern[config.provider];
      if (r === 'ok') return {id: 'id-' + config.provider};
      throw new mail.MailError(r, {status: r === '5xx' ? 503 : r === '4xx' ? 422 : null, retryable: r !== '4xx'});
    };
    const result = await router.routeMail({cls, to: 'c@client.example', message: {subject: 's', text: 't', html: '<p>t</p>'}, configs, breaker, send});
    const order = router.DEFAULT_ROUTES[cls].filter(p => configs[p]);
    const live = order.filter(p => !open[p]);
    // Each provider at most once, in class order, open circuits skipped.
    assert.equal(new Set(calls).size, calls.length);
    assert.deepEqual(calls, live.slice(0, calls.length));
    // After a retryable failure, the next live provider is tried exactly once; it stops at a send or a refusal.
    for (let i = 0; i < calls.length; i++) {
      const r = pattern[calls[i]];
      if (r === 'ok' || r === '4xx') assert.equal(calls.length, i + 1, 'stops after a send or a refusal');
      else if (i + 1 < live.length) assert.equal(calls[i + 1], live[i + 1], 'fails over to the next provider');
    }
    if (calls.length) {
      const last = pattern[calls.at(-1)];
      assert.equal(result.status, last === 'ok' ? 'sent' : last === '4xx' ? 'refused' : 'failed');
      if (last === 'ok') assert.equal(result.provider, calls.at(-1));
    } else assert.equal(result.status, order.length ? 'failed' : 'no_provider');
    if (!live.length) assert.equal(calls.length, 0);
    else if (live.every(p => pattern[p] === '5xx' || pattern[p] === 'timeout')) assert.deepEqual(calls, live, 'a deliverable message reaches every provider once');
  }));
});

// @covers SF-19
test('SF-19: routes come from SCOPEFLOW_MAIL_ROUTES (defaults per plan §8); the breaker opens and recovers', () => {
  assert.deepEqual(router.parseRoutes(''), {transactional: ['resend', 'postmark', 'ses'], auth: ['postmark', 'resend', 'ses'], bulk: ['ses', 'resend']});
  assert.deepEqual(router.parseRoutes('auth:ses>postmark;bulk:resend;nonsense:x').auth, ['ses', 'postmark']);
  assert.deepEqual(router.parseRoutes('{"transactional":["postmark","bogus"]}').transactional, ['postmark']);
  assert.deepEqual(router.parseRoutes('transactional:').transactional, ['resend', 'postmark', 'ses'], 'an empty list keeps the default');
  const env = {SCOPEFLOW_MAIL_FROM: 'S <s@x.example>', POSTMARK_SERVER_TOKEN: 'pm', RESEND_API_KEY: 're'};
  assert.deepEqual(router.routeFor('bulk', env), ['resend'], 'SES has no credentials, so bulk mail uses Resend');
  assert.deepEqual(router.routeFor('auth', env), ['postmark', 'resend']);
  let t = 0;
  const b = new router.CircuitBreaker(2, 1000, () => t);
  b.failure('ses'); assert.equal(b.isOpen('ses'), false);
  b.failure('ses'); assert.equal(b.isOpen('ses'), true);
  t = 1001; assert.equal(b.isOpen('ses'), false, 'half-open after the cooldown');
  assert.equal(router.retryDelayMs(1), 60_000); assert.equal(router.retryDelayMs(6), null);
});

// @covers M19
test('M19: List-Unsubscribe reaches every provider request; values cannot add headers', () => {
  const headers = {...mail.unsubscribeHeaders('https://x.example/api/mail/unsubscribe?t=abc'), 'X-Evil\r\nBcc': 'v\r\nBcc: a@b.c'};
  const msg = {subject: 's', text: 't', html: '<p>t</p>'};
  const resend = JSON.parse(mail.mailRequest(configsAll.resend, 'c@x.example', msg, {headers}).body);
  assert.equal(resend.headers['List-Unsubscribe'], '<https://x.example/api/mail/unsubscribe?t=abc>');
  assert.equal(resend.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(resend.headers['X-EvilBcc'], 'v Bcc: a@b.c');
  const pm = JSON.parse(mail.mailRequest({...configsAll.postmark, stream: 'outbound'}, 'c@x.example', msg, {headers}).body);
  assert.ok(pm.Headers.some(h => h.Name === 'List-Unsubscribe'));
  const ses = JSON.parse(mail.mailRequest(configsAll.ses, 'c@x.example', msg, {headers, now: new Date(Date.UTC(2026, 9, 7))}).body);
  assert.ok(ses.Content.Simple.Headers.some(h => h.Name === 'List-Unsubscribe-Post'));
  // Without headers the request bodies are unchanged.
  assert.equal('headers' in JSON.parse(mail.mailRequest(configsAll.resend, 'c@x.example', msg).body), false);
});

// @covers M19
test('M19: unsubscribe links are signed per address', () => {
  const env = {SCOPEFLOW_SIGNING_SECRET: TEST_SECRET};
  fc.assert(fc.property(fc.emailAddress(), fc.emailAddress(), (a, b) => {
    const t = unsub.unsubscribeToken(a, env);
    assert.equal(unsub.verifyUnsubscribe(t, env), a.toLowerCase());
    if (a.toLowerCase() !== b.toLowerCase()) assert.equal(unsub.verifyUnsubscribe(`${t.split('.')[0]}.${unsub.unsubscribeToken(b, env).split('.')[1]}`, env), null);
  }));
  assert.equal(unsub.verifyUnsubscribe('garbage', env), null);
  assert.equal(unsub.verifyUnsubscribe(unsub.unsubscribeToken('a@b.co', env), {SCOPEFLOW_SIGNING_SECRET: 'another-secret-that-is-long-enough-0123'}), null);
  // S3: no empty-key or cookie-secret fallback: without a secret, nothing is signed and nothing verifies.
  assert.throws(() => unsub.unsubscribeToken('a@b.co', {NEON_AUTH_COOKIE_SECRET: 'cookie-secret-that-is-long-enough-0123'}), unsub.UnsubscribeUnconfigured);
  assert.throws(() => unsub.unsubscribeToken('a@b.co', {}), unsub.UnsubscribeUnconfigured);
  assert.equal(unsub.verifyUnsubscribe(unsub.unsubscribeToken('a@b.co', env), {}), null);
  assert.equal(unsub.verifyUnsubscribe(unsub.unsubscribeToken('a@b.co', env), {SCOPEFLOW_MAIL_UNSUBSCRIBE_SECRET: 'dedicated-unsubscribe-secret-0123456789', SCOPEFLOW_SIGNING_SECRET: TEST_SECRET}), null, 'the dedicated secret wins');
});

// @covers SF-19
test('SF-19: bounce and complaint webhooks from all three providers parse into suppressions', () => {
  const secret = 'whsec_' + Buffer.from('k'.repeat(24)).toString('base64');
  const body = JSON.stringify({type: 'email.bounced', data: {to: ['Gone@Client.example'], bounce: {type: 'Permanent'}}});
  const ts = Math.floor(Date.now() / 1000);
  assert.equal(events.svixValid(body, {id: 'msg_1', timestamp: String(ts), signature: events.svixSign(body, 'msg_1', ts, secret)}, secret), true);
  assert.equal(events.svixValid(body + ' ', {id: 'msg_1', timestamp: String(ts), signature: events.svixSign(body, 'msg_1', ts, secret)}, secret), false);
  assert.equal(events.svixValid(body, {id: 'msg_1', timestamp: String(ts - 3600), signature: events.svixSign(body, 'msg_1', ts - 3600, secret)}, secret), false, 'replays are refused');
  assert.deepEqual(events.parseResend(JSON.parse(body), 'msg_1'), {id: 'msg_1', reason: 'hard_bounce', addresses: ['gone@client.example']});
  assert.equal(events.parseResend({type: 'email.bounced', data: {to: ['a@b.co'], bounce: {type: 'Transient'}}}, 'x'), null, 'soft bounces are not suppressed');
  assert.deepEqual(events.parsePostmark({RecordType: 'Bounce', Type: 'HardBounce', Email: 'a@b.co', ID: 7}), {id: '7:Bounce', reason: 'hard_bounce', addresses: ['a@b.co']});
  assert.equal(events.parsePostmark({RecordType: 'Bounce', Type: 'SoftBounce', Email: 'a@b.co', ID: 8}), null);
  assert.deepEqual(events.parsePostmark({RecordType: 'SpamComplaint', Email: 'a@b.co', ID: 9}).reason, 'complaint');
  const sns = {Type: 'Notification', MessageId: 'm1', Message: JSON.stringify({notificationType: 'Bounce', bounce: {bounceType: 'Permanent', bouncedRecipients: [{emailAddress: 'x@y.co'}]}})};
  assert.deepEqual(events.parseSes(sns), {id: 'm1', reason: 'hard_bounce', addresses: ['x@y.co']});
  assert.equal(events.snsConfirmUrl('https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription'), 'https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription');
  assert.equal(events.snsConfirmUrl('https://evil.example/sns.eu-west-1.amazonaws.com'), null);
  assert.equal(events.basicPasswordValid('Basic ' + Buffer.from('postmark:s3cret').toString('base64'), 's3cret'), true);
  assert.equal(events.basicPasswordValid('Basic ' + Buffer.from('postmark:nope').toString('base64'), 's3cret'), false);
});
