// Dates, link expiry, and the bounds on scope and settings input. Markup in a decision
// email is escaped. Pure: no database.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';
import '../support/ts-resolve.mjs';

const {dateString, scopeSchema} = await import('../../lib/scope.ts');
const {linkExpires, linkExpired, LINK_EXPIRY_CHOICES} = await import('../../lib/link.ts');
const {formatDay, formatInZone, daysAgo, validTimeZone} = await import('../../lib/time.ts');
const {settingsSchema} = await import('../../lib/settings.ts');
const {ownerDecisionEmail} = await import('../../lib/mail.ts');
const {formatExpiry} = await import('../../lib/evidence.ts');

test('link expiry is exactly the chosen number of days, and decided links never expire', () => {
  fc.assert(fc.property(
    fc.constantFrom(...LINK_EXPIRY_CHOICES),
    fc.integer({min: 0, max: 400}),
    fc.constantFrom('pending', 'approved', 'changes_requested'),
    (days, shift, status) => {
      const created = new Date(Date.UTC(2026, 0, 1) + shift * 86400000).toISOString();
      const row = {status, created, link_expiry_days: days};
      const at = linkExpires(row);
      if (status !== 'pending') return at === null && linkExpired(row, Date.parse(created) + (days + 1) * 86400000) === false;
      const expected = new Date(Date.parse(created) + days * 86400000).toISOString();
      return at === expected && linkExpired(row, Date.parse(at) - 1) === false && linkExpired(row, Date.parse(at)) === true;
    },
  ));
});

test('calendar dates round-trip and impossible days are refused', () => {
  fc.assert(fc.property(fc.integer({min: 2020, max: 2035}), fc.integer({min: 1, max: 12}), fc.integer({min: 1, max: 28}), (y, m, d) => {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return dateString.safeParse(iso).success && formatDay(iso).includes(String(y));
  }));
  assert.equal(dateString.safeParse('2026-02-31').success, false);
  assert.equal(dateString.safeParse('15/12/2026').success, false);
  assert.equal(formatDay(''), '');
  assert.equal(formatInZone('not-a-date'), '');
  assert.equal(formatExpiry(''), '');
  assert.equal(formatExpiry('nope'), '');
  assert.match(formatExpiry('2026-10-13T08:00:00.000Z', 'Asia/Kolkata'), /13 Oct 2026/);
});

test('time zones are IANA names, and day counts use whole days', () => {
  assert.equal(validTimeZone('Asia/Kolkata'), true);
  assert.equal(validTimeZone('Not/AZone'), false);
  assert.equal(validTimeZone('../etc/passwd'), false);
  assert.equal(validTimeZone(''), false);
  const now = Date.UTC(2026, 5, 15, 12);
  fc.assert(fc.property(fc.integer({min: 0, max: 40}), days => {
    const ago = daysAgo(new Date(now - days * 86400000).toISOString(), now);
    return ago.days === days && (days === 0 ? ago.text === 'today' : days === 1 ? ago.text === 'yesterday' : ago.text === `${days} days ago`);
  }));
});

test('scope and settings input is bounded, and decision mail escapes markup', () => {
  assert.equal(scopeSchema.safeParse({title: 'A', client: 'B', deliverables: '', items: [], client_inputs: [], exclusions: '', fee: -1, currency: 'USD', revisions: 1, due: '2026-02-31', notes: ''}).success, false);
  assert.equal(settingsSchema.safeParse({context_retention_days: null, email_subject: '', email_body: 'no link here', default_exclusions: '', default_terms: '', draft_expiry_days: null}).success, false);
  assert.equal(settingsSchema.safeParse({context_retention_days: 0, email_subject: '', email_body: '', default_exclusions: '', default_terms: '', draft_expiry_days: null}).success, false);
  fc.assert(fc.property(fc.string({maxLength: 40}).map(s => `${s}<`), signer => {
    const mail = ownerDecisionEmail({decision: 'changes_requested', title: '<script>alert(1)</script>', signer, version: 2, comment: signer, workspaceUrl: 'https://scope-flow.tech/'});
    const escaped = signer.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return !mail.html.includes('<script') && mail.html.includes('&lt;script&gt;') && mail.html.includes(escaped);
  }));
});
