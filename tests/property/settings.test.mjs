// Retention + editable wording (account settings), and QoL: restoring a malformed local draft.
// Pure (no server): settings validation, template filling, the owner-worded signature email,
// the server default retention, and restoreDraft sanitising list rows.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const {settingsSchema, defaultRetentionDays, fromRow, defaultSettings} = await import('../../lib/settings.ts');
const {signatureEmail, fillTemplate} = await import('../../lib/mail.ts');
const {restoreDraft, serializeDraft} = await import('../../lib/editor.ts');
const {sample} = await import('../../lib/scope.ts');
const valid = {context_retention_days: 90, email_subject: 'Please sign {title}', email_body: 'Hi {client},\n\nHere it is: {link}', default_exclusions: 'Hosting', default_terms: 'Net 15'};

test('settings: retention 1–3650 days or null, draft expiry 7–3650 days or null; the email body must contain {link}', () => {
  // draft_expiry_days was added later: older clients that leave it out keep drafts (null).
  assert.deepEqual(settingsSchema.parse(valid), {...valid, draft_expiry_days: null});
  assert.deepEqual(settingsSchema.parse({...valid, draft_expiry_days: 90}), {...valid, draft_expiry_days: 90});
  for (const bad of [6, 3651, 30.5]) assert.equal(settingsSchema.safeParse({...valid, draft_expiry_days: bad}).success, false, String(bad));
  assert.equal(settingsSchema.safeParse({...valid, context_retention_days: null}).success, true);
  for (const bad of [{context_retention_days: 0}, {context_retention_days: 3651}, {context_retention_days: 1.5}, {email_body: 'No link here'}, {email_subject: 'x'.repeat(201)}, {extra: 1}]) {
    assert.equal(settingsSchema.safeParse({...valid, ...bad}).success, false, JSON.stringify(bad));
  }
  assert.deepEqual(fromRow(null), defaultSettings);
  assert.equal(defaultRetentionDays({SCOPEFLOW_CONTEXT_RETENTION_DAYS: '180'}), 180);
  // changed by WS-08: M32 founder decision — the server default is 180 days; "keep" disables it.
  // @covers M32
  assert.equal(defaultRetentionDays({SCOPEFLOW_CONTEXT_RETENTION_DAYS: 'forever'}), 180);
  assert.equal(defaultRetentionDays({SCOPEFLOW_CONTEXT_RETENTION_DAYS: 'keep'}), null);
  assert.equal(defaultRetentionDays({}), 180);
});

test('owner wording replaces the default email; subject stays header-safe and HTML escaped', () => {
  const m = signatureEmail({title: 'Logo <x>', client: 'Ada\r\nBcc: evil@example.test', version: 2, reviewUrl: 'https://s.example/review/abc', template: {subject: 'Sign {title} v{version} {link}', body: 'Hi {client},\n\nPlease review: {link}\nThanks'}});
  assert.equal(m.subject, 'Sign Logo <x> v2');
  assert.ok(!/[\r\n]/.test(m.subject));
  assert.ok(m.text.startsWith('Hi Ada Bcc: evil@example.test,\n\nPlease review: https://s.example/review/abc\nThanks'));
  assert.ok(m.html.includes('<a href="https://s.example/review/abc">https://s.example/review/abc</a>'));
  assert.ok(!m.html.includes('<x>'));
  const subjectOnly = signatureEmail({title: 'T', client: 'C', version: 1, reviewUrl: 'https://s.example/r', template: {subject: 'Custom {title}'}});
  assert.equal(subjectOnly.subject, 'Custom T'); assert.ok(subjectOnly.text.includes('https://s.example/r'));
  assert.deepEqual(signatureEmail({title: 'T', client: 'C', version: 1, reviewUrl: 'u', template: {}}), signatureEmail({title: 'T', client: 'C', version: 1, reviewUrl: 'u'}));
  fc.assert(fc.property(fc.string({maxLength: 80}), s => assert.ok(!fillTemplate(s, {client: 'c', title: 't', version: 1, link: 'l'}).includes('{link}'))));
});

test('QoL regression: a malformed saved draft restores without broken rows instead of crashing the editor', () => {
  const draft = {...sample, items: [null, 'x', {id: 'a'}, {id: 'b', title: 'Logo', qty: 'two', price: 'free'}, sample.items[0]], client_inputs: [{title: 'no id'}, {id: 'c', title: 'Copy'}]};
  const restored = restoreDraft(serializeDraft(draft, 1000), 2000);
  assert.deepEqual(restored.items, [{id: 'b', title: 'Logo', qty: 1, unit: '', price: null, acceptance: ''}, sample.items[0]]);
  assert.deepEqual(restored.client_inputs, [{id: 'c', title: 'Copy', due: ''}]);
  assert.deepEqual(restoreDraft(serializeDraft(sample, 1000), 2000), sample); // well-formed drafts are unchanged
});
