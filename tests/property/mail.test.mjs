// "Send for signature" mail, with the provider stubbed (no network): whatever the scope's
// title or client says, the message stays header-safe and HTML-escaped, and provider
// failures surface as MailError (the route then returns the copy-link / mailto fallback).
import '../support/fc-setup.mjs';
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const mail = await import('../../lib/mail.ts');
const text = fc.string({maxLength: 200, unit: fc.oneof(fc.constantFrom('\r', '\n', '\t', '<', '>', '&', '"', "'", 'é', '🎨'), fc.string({minLength: 1, maxLength: 1}))});
const config = {apiKey: 're_test', from: 'Scopeflow <scopes@example.test>', replyTo: null};

test('provider request: header-safe subject, escaped HTML, link intact, idempotency key passed', async () => {
  await fc.assert(fc.asyncProperty(text, text, fc.integer({min: 1, max: 100}), fc.emailAddress(), async (title, client, version, to) => {
    const calls = [];
    const fetchMock = mock.method(globalThis, 'fetch', async (url, init) => { calls.push({url, init}); return new Response(JSON.stringify({id: 'msg_1'}), {status: 200}); });
    try {
      const reviewUrl = 'https://scopeflow.example/review/' + 'a'.repeat(64);
      const m = mail.signatureEmail({title, client, version, reviewUrl});
      assert.doesNotMatch(m.subject, /[\r\n]/);
      assert.doesNotMatch(m.html.replace(/<\/?(p|strong|a|br)( [^>]*)?>/g, ''), /[<>]/, 'only the template\'s own tags');
      assert.ok(m.text.includes(reviewUrl) && m.html.includes(`href="${reviewUrl}"`));
      const result = await mail.sendMail(config, to, m, 'key-1');
      assert.equal(result.id, 'msg_1');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://api.resend.com/emails');
      assert.equal(calls[0].init.headers['Idempotency-Key'], 'key-1');
      assert.deepEqual(JSON.parse(calls[0].init.body).to, [to]);
      assert.ok(decodeURIComponent(mail.mailtoLink(to, m)).includes(reviewUrl));
    } finally { fetchMock.mock.restore(); }
  }), {numRuns: 100});
});

test('provider refusal and network failure become MailError (never an unhandled error)', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(400, 401, 403, 422, 429, 500, 503, 0), text, async (status, message) => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      if (status === 0) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({message}), {status});
    });
    try {
      await assert.rejects(mail.sendMail(config, 'client@example.test', mail.signatureEmail({title: 'T', client: 'C', version: 1, reviewUrl: 'https://x.test/r'})), e => e instanceof mail.MailError && !/[\r\n]/.test(e.message));
    } finally { fetchMock.mock.restore(); }
  }), {numRuns: 60});
});

test('reminders: wording stays header-safe and says how long it has waited; one a day, three per version', () => {
  fc.assert(fc.property(text, text, fc.integer({min: 1, max: 100}), fc.nat(60), (title, client, version, days) => {
    const reviewUrl = 'https://scopeflow.example/review/' + 'b'.repeat(64);
    const m = mail.reminderEmail({title, client, version, reviewUrl, days});
    assert.doesNotMatch(m.subject, /[\r\n]/);
    assert.ok(m.subject.startsWith('Reminder: please review '));
    assert.doesNotMatch(m.html.replace(/<\/?(p|strong|a|br)( [^>]*)?>/g, ''), /[<>]/);
    assert.ok(m.text.includes(reviewUrl) && m.html.includes(`href="${reviewUrl}"`));
    assert.equal(m.text.includes(`for ${days} days`), days >= 2);
  }), {numRuns: 200});
  const now = Date.parse('2026-10-09T12:00:00Z'), ago = h => new Date(now - h * 3600_000).toISOString();
  const block = (state, v = 2) => mail.reminderBlock({last_sent: null, sent_version: null, reminders: 0, ...state}, v, now)?.code ?? null;
  assert.equal(block({}), null);
  assert.equal(block({last_sent: ago(2), sent_version: 2}), 'recently_sent');
  assert.equal(block({last_sent: ago(2), sent_version: 1}), null); // emailed about another version
  assert.equal(block({last_sent: ago(25), sent_version: 2, reminders: 2}), null);
  assert.equal(block({last_sent: ago(25), sent_version: 2, reminders: 3}), 'reminder_limit');
  assert.match(mail.reminderBlock({last_sent: ago(23.5), sent_version: 2, reminders: 0}, 2, now).error, /about 1 hour\./);
});
