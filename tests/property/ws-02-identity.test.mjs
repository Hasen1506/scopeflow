// WS-02 pure tests: signing status and key policy (C1, C6), evidence wording and masking (C5, L1,
// L2, L3, QA-02, QA-03), OTP limits (M15) and the diff-base rule (H2, M29). No server, no network,
// seeded fast-check, frozen clock where time matters.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fc} from '../support/property.mjs';

const S = await import('../../lib/signing.ts');
const E = await import('../../lib/evidence.ts');
const O = await import('../../lib/otp-limits.ts');
const {diffBaseVersion} = await import('../../lib/diff.ts');
const {scopeSchema, sample} = await import('../../lib/scope.ts');
const {sha256} = await import('../../lib/ledger.ts');

const DEDICATED = 'd'.repeat(40), COOKIE = 'c'.repeat(40), OLD = 'o'.repeat(40);

// @covers C1
test('C1 signingStatus() matrix: unset / <32 chars / dedicated / previous-only, and production fails closed', () => {
  assert.equal(S.signingStatus({NODE_ENV: 'production'}), 'off');
  assert.equal(S.signingStatus({NODE_ENV: 'production', SCOPEFLOW_SIGNING_SECRET: 'short-secret'}), 'off');
  assert.equal(S.signingStatus({NODE_ENV: 'production', SCOPEFLOW_SIGNING_SECRET: DEDICATED}), 'dedicated');
  assert.equal(S.signingStatus({NODE_ENV: 'production', SCOPEFLOW_SIGNING_SECRET_PREVIOUS: OLD}), 'previous_only');
  assert.equal(S.signingStatus({NODE_ENV: 'production', NEON_AUTH_COOKIE_SECRET: COOKIE}), 'off');
  assert.equal(S.signingStatus({NODE_ENV: 'production', NEON_AUTH_COOKIE_SECRET: COOKIE, SCOPEFLOW_ALLOW_COOKIE_SIGNING: '1'}), 'cookie_fallback');
  assert.equal(S.signingStatus({NODE_ENV: 'development', NEON_AUTH_COOKIE_SECRET: COOKIE}), 'cookie_fallback');
  // Fail closed: production with anything but the dedicated key creates no record.
  assert.equal(S.signingBlocked({NODE_ENV: 'production'}), true);
  assert.equal(S.signingBlocked({NODE_ENV: 'production', SCOPEFLOW_SIGNING_SECRET: 'short-secret'}), true);
  assert.equal(S.signingBlocked({NODE_ENV: 'production', SCOPEFLOW_SIGNING_SECRET_PREVIOUS: OLD}), true);
  assert.equal(S.signingBlocked({NODE_ENV: 'production', NEON_AUTH_COOKIE_SECRET: COOKIE, SCOPEFLOW_ALLOW_COOKIE_SIGNING: '1'}), true);
  assert.equal(S.signingBlocked({NODE_ENV: 'production', SCOPEFLOW_SIGNING_SECRET: DEDICATED}), false);
  assert.equal(S.signingBlocked({NODE_ENV: 'development'}), false);
});

/** Signs `message` as a server configured with `env` would. */
function signAs(env, message) {
  const saved = {...process.env};
  for (const k of ['SCOPEFLOW_SIGNING_SECRET', 'SCOPEFLOW_SIGNING_SECRET_PREVIOUS', 'NEON_AUTH_COOKIE_SECRET', 'SCOPEFLOW_ALLOW_COOKIE_SIGNING', 'NODE_ENV']) delete process.env[k];
  Object.assign(process.env, env);
  try { return S.signRecord(message); } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
}

// @covers C6
test('C6 verificationKeys() env matrix: the cookie-derived key is trusted only when allowed, and then as legacy_key', () => {
  const message = 'scopeflow-anchor-v1:' + 'a'.repeat(64);
  const cookieSig = signAs({NODE_ENV: 'development', NEON_AUTH_COOKIE_SECRET: COOKIE}, message);
  const kid = S.cookieKeyId({NEON_AUTH_COOKIE_SECRET: COOKIE});
  assert.ok(cookieSig.startsWith(kid + '.'));
  const prod = {NODE_ENV: 'production', SCOPEFLOW_SIGNING_SECRET: DEDICATED, NEON_AUTH_COOKIE_SECRET: COOKIE};
  assert.equal(S.verificationKeys(prod).has(kid), false);
  assert.notEqual(S.verifyRecordDetailed(message, cookieSig, prod), 'valid');
  assert.equal(S.verifyRecordDetailed(message, cookieSig, prod), 'unknown_key');
  assert.equal(S.verifyRecordDetailed(message, cookieSig, {...prod, SCOPEFLOW_LEGACY_KEY_IDS: 'ffffffffffffffff, ' + kid}), 'legacy_key');
  assert.equal(S.verifyRecordDetailed(message, cookieSig, {...prod, SCOPEFLOW_ALLOW_COOKIE_SIGNING: '1'}), 'legacy_key');
  assert.equal(S.verifyRecordDetailed(message, cookieSig, {NODE_ENV: 'development', NEON_AUTH_COOKIE_SECRET: COOKIE}), 'valid');
  // The dedicated key and retired dedicated keys are fully trusted; rotation never looks like tampering.
  const dedicatedSig = signAs({NODE_ENV: 'production', SCOPEFLOW_SIGNING_SECRET: OLD}, message);
  assert.equal(S.verifyRecordDetailed(message, dedicatedSig, {NODE_ENV: 'production', SCOPEFLOW_SIGNING_SECRET: DEDICATED, SCOPEFLOW_SIGNING_SECRET_PREVIOUS: OLD}), 'valid');
  assert.equal(S.verifyRecordDetailed(message, dedicatedSig, {NODE_ENV: 'production', SCOPEFLOW_SIGNING_SECRET: DEDICATED}), 'unknown_key');
  assert.equal(S.verifyRecordDetailed(message + 'x', dedicatedSig, {NODE_ENV: 'production', SCOPEFLOW_SIGNING_SECRET: OLD}), 'invalid');
  assert.equal(S.verifyRecordDetailed(message, null, prod), 'unsigned');
  assert.deepEqual([...S.verificationKeys({NODE_ENV: 'production', SCOPEFLOW_SIGNING_SECRET: DEDICATED, SCOPEFLOW_SIGNING_SECRET_PREVIOUS: `${OLD}, short`}).values()].map(k => k.trust), ['current', 'current']);
});

// @covers C5
test('C5 maskAddress(): first character of the local part and of the domain label, plus the TLD; phones keep country code and last four', () => {
  assert.equal(E.maskAddress('email', 'sam@example.com'), 's***@e***.com');
  assert.equal(E.maskAddress('email', 'ada.client@example.test'), 'a***@e***.test');
  assert.equal(E.maskAddress('email', 'finance@acme.co.in'), 'f***@a***.in');
  assert.equal(E.maskAddress('email', 'x@y'), 'x***@y***');
  assert.equal(E.maskAddress('email', 'not-an-address'), '***');
  assert.equal(E.maskAddress('sms', '+917904184044'), '+91 ****4044');
  assert.equal(E.maskAddress('whatsapp', '+14155550100'), '+1 ****0100');
  assert.equal(E.maskAddress('phone', '12'), '****');
  fc.assert(fc.property(fc.emailAddress(), email => {
    const m = E.maskAddress('email', email);
    const [local, domain] = [email.slice(0, email.lastIndexOf('@')), email.slice(email.lastIndexOf('@') + 1)];
    assert.ok(m.startsWith(local[0] + '***@'));
    if (local.length > 4) assert.ok(!m.includes(local), 'never the full local part');
    assert.ok(!m.includes(domain.split('.')[0]) || domain.split('.')[0].length <= 1);
  }));
});

// @covers C5
test('C5 receipt wording (snapshot): what the record proves, never more', () => {
  assert.equal(E.evidenceStatement({decision: 'approved'}), 'Approved by whoever held this link. The name was typed by the person approving.');
  assert.equal(E.evidenceStatement({decision: 'approved', code_to: 's***@e***.com', on_file_since: '2026-10-03T06:00:00.000Z', time_zone: 'Asia/Kolkata'}),
    'Approved by whoever held this link, after entering a code sent to s***@e***.com, the address on file for this client since 3 Oct 2026. The name was typed by the person approving.');
  assert.equal(E.evidenceStatement({decision: 'approved', owner_session: true}), 'Approved by whoever held this link. The name was typed by the person approving. ⚠ Submitted from a browser signed in to the creator’s account.');
  assert.equal(E.evidenceStatement({decision: 'approved', owner_session: true, plain: true}).endsWith('Warning: Submitted from a browser signed in to the creator’s account.'), true);
  assert.equal(E.evidenceStatement({decision: 'changes_requested'}).startsWith('Changes were requested by whoever held this link.'), true);
  assert.equal(E.codeLine('s***@e***.com', '2026-10-03T06:00:00.000Z', 'UTC'), 'code verified to s***@e***.com (the address on file since 3 Oct 2026)');
});

// @covers QA-03
test('QA-03 chip wording by status (§6.1)', () => {
  assert.equal(E.chipWording('dedicated'), 'Verified · sealed by ScopeFlow');
  assert.equal(E.chipWording('legacy_key'), 'Verified · older seal');
  assert.equal(E.chipWording('unsigned'), 'Record unchanged · saved before sealing was on');
  assert.match(E.chipWording('invalid'), /^Not verified/);
  assert.equal(E.chipWording('dedicated', {esign: {provider: 'leegality'}}), 'Verified · sealed by ScopeFlow · Aadhaar eSign');
  assert.equal(E.chipWording('dedicated', {pades: true}), 'Verified · sealed by ScopeFlow · Digitally signed PDF');
  assert.equal(E.sealStatus('valid'), 'dedicated'); assert.equal(E.sealStatus('legacy_key'), 'legacy_key'); assert.equal(E.sealStatus('unsigned'), 'unsigned');
  assert.equal(E.sealStatus('unknown_key'), 'invalid'); assert.equal(E.sealStatus(null), 'unsigned');
  // C1: the receipt line for each state.
  assert.equal(E.evidenceWording('dedicated', {kid: 'abc', at: 'T', verifyUrl: 'U'}), 'Sealed by ScopeFlow (Ed25519, key abc) at T; check at U.');
  assert.equal(E.evidenceWording('legacy_key', {kid: 'old'}), 'Sealed with an earlier ScopeFlow key (old).');
  assert.equal(E.evidenceWording('unsigned'), 'Recorded by ScopeFlow; not sealed (sealing was not configured when this was saved).');
});

// @covers L1
test('L1 client and server canonical hash are equal for the golden scope', async () => {
  const content = scopeSchema.parse({...sample, due: '2026-12-15'});
  const server = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  assert.equal(await E.contentFingerprint(content), server);
  assert.equal(await sha256(E.canonical(content)), server);
  assert.equal(E.canonical(content), JSON.stringify(content)); // unchanged canonical form: older receipts still check
  assert.equal(E.fingerprintWording('ab'), 'The page you approved showed content with fingerprint ab.');
});

// @covers L2
test('L2 copy snapshot: "digital signature" appears only on PAdES / eSign paths', () => {
  const roots = ['lib/evidence.ts', 'lib/receipt.ts', 'lib/statement.ts', 'app/verify', 'app/review/[token]/countersign.tsx', 'app/review/[token]/otp-gate.tsx', 'app/cosign', 'app/components/evidence', 'app/components/slots/contact-change.tsx', 'app/components/slots/cosigner-editor.tsx'];
  const files = roots.flatMap(function walk(p) { return statSync(p).isDirectory() ? readdirSync(p).flatMap(f => walk(p + '/' + f)) : [p]; });
  for (const f of files) for (const [i, line] of readFileSync(f, 'utf8').split('\n').entries()) {
    if (!/digital(ly)? sign/i.test(line)) continue;
    assert.match(line, /pades|esign|aadhaar|L2/i, `${f}:${i + 1} says "digital signature" outside a PAdES/eSign path`);
  }
  assert.equal(E.acceptanceWording(), 'Electronic acceptance (typed name + click), recorded and sealed by ScopeFlow');
  assert.match(E.acceptanceWording({esign: {provider: 'leegality'}}), /^Aadhaar eSign/);
});

// @covers L3
test('L3 link expiry in the project zone: "13 Oct 2026, 1:30 am IST"', () => {
  assert.equal(E.formatExpiry('2026-10-12T20:00:00.000Z', 'Asia/Kolkata'), '13 Oct 2026, 1:30 am IST');
  assert.equal(E.formatExpiry('2026-10-12T20:00:00.000Z', 'UTC'), '12 Oct 2026, 8:00 pm UTC');
  assert.equal(E.formatExpiry('2026-10-12T20:00:00.000Z', 'Not/AZone'), '12 Oct 2026, 8:00 pm UTC');
  assert.equal(E.formatExpiry(null, 'UTC'), '');
});

// @covers M15
test('M15 cooldown schedule and daily limits', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(O.otpCooldownMs), [0, 30_000, 120_000, 600_000, 600_000, 600_000]);
  const now = 1_000_000_000_000, h = 3600_000;
  const base = {now, destination: [], spent: 0, cost: 1, budget: 200};
  assert.deepEqual(O.otpSendAllowed({...base, version: []}), {ok: true});
  const soon = O.otpSendAllowed({...base, version: [now - 10_000]});
  assert.equal(soon.ok, false); assert.equal(soon.code, 'otp_cooldown'); assert.equal(soon.retry_after, 20);
  assert.equal(O.otpSendAllowed({...base, version: [now - 31_000]}).ok, true);
  assert.equal(O.otpSendAllowed({...base, version: [now - 5 * h, now - 60_000]}).code, 'otp_cooldown'); // 2nd → 3rd needs 2 min
  assert.equal(O.otpSendAllowed({...base, version: [now - 5 * h, now - 4 * h, now - 9 * 60_000]}).code, 'otp_cooldown'); // 10 min after the 3rd
  const sixth = O.otpSendAllowed({...base, version: [1, 2, 3, 4, 5].map(i => now - (6 - i) * h)});
  assert.equal(sixth.ok, false); assert.equal(sixth.code, 'otp_send_limit'); assert.equal(sixth.retry_after, 19 * 3600);
  assert.equal(O.otpSendAllowed({...base, version: [], destination: Array.from({length: 10}, (_, i) => now - (i + 1) * h)}).code, 'otp_destination_limit');
  assert.equal(O.otpSendAllowed({...base, version: [], spent: 196, cost: 5}).code, 'otp_budget');
  assert.equal(O.otpDailyBudget({SCOPEFLOW_OTP_DAILY_BUDGET: '50'}), 50); assert.equal(O.otpDailyBudget({}), 200);
  assert.equal(O.preferredChannel({email: 'a@b.c', phone: '+911234567890', available: ['email', 'sms', 'whatsapp']}), 'whatsapp');
  assert.equal(O.preferredChannel({email: 'a@b.c', phone: '+911234567890', available: ['email', 'sms']}), 'email');
  assert.equal(O.preferredChannel({phone: '+911234567890', available: ['sms']}), 'sms');
});

const historyArb = fc.array(fc.record({status: fc.constantFrom('pending', 'pending', 'approved', 'changes_requested'), revoked: fc.boolean(), sent: fc.boolean()}), {minLength: 0, maxLength: 12})
  .map(list => list.map((h, i) => ({version: i + 1, ...h})));

// @covers H2
test('H2 property: the diff base is always an earlier version that was sent or decided, never revoked, never a draft', () => {
  fc.assert(fc.property(historyArb, fc.option(fc.integer({min: 1, max: 14}), {nil: null}), (history, compare) => {
    const current = history.length + 1;
    const base = diffBaseVersion(history, current, compare);
    if (base === null) return;
    const h = history.find(x => x.version === base);
    assert.ok(h && h.version < current);
    assert.ok(!h.revoked, 'never revoked');
    assert.ok(h.sent || h.status !== 'pending', 'sent or decided');
  }));
  // Live-test repro #5: v1 never sent, v2 → no previous.
  assert.equal(diffBaseVersion([{version: 1, status: 'pending', revoked: false, sent: false}], 2), null);
});

// @covers M29
test('M29 diff base: last approved, else last sent', () => {
  const h = [{version: 1, status: 'changes_requested', revoked: false, sent: true}, {version: 2, status: 'approved', revoked: false, sent: true}, {version: 3, status: 'pending', revoked: false, sent: false}];
  assert.equal(diffBaseVersion(h, 4), 2); // approved v2, unsent v3 → v2 for v4
  assert.equal(diffBaseVersion(h.slice(0, 1), 2), 1);
  assert.equal(diffBaseVersion(h, 4, 1), 1); // "compare with v1"
  assert.equal(diffBaseVersion(h, 4, 3), null); // an unsent draft is never offered
});

// @covers QA-02
test('QA-02 receipt input validation', () => {
  assert.equal(E.parseReceiptInput('not-a-receipt').kind, 'invalid');
  assert.equal(E.parseReceiptInput('not-a-receipt').error, E.NOT_A_RECEIPT);
  assert.match(E.NOT_A_RECEIPT, /^That doesn’t look like a ScopeFlow receipt/);
  assert.equal(E.parseReceiptInput('{"oops":1}').kind, 'invalid');
  assert.equal(E.parseReceiptInput('https://example.com/other?p=x').kind, 'invalid');
  const a = 'ab'.repeat(32);
  assert.deepEqual(E.parseReceiptInput(`https://scope-flow.tech/verify?p=proj_1&v=2&a=${a}`), {kind: 'link', p: 'proj_1', v: 2, a});
  assert.deepEqual(E.parseReceiptInput(JSON.stringify({project_id: 'proj_1', version: 2, anchor: a, signer: 'x'})), {kind: 'receipt', p: 'proj_1', v: 2, a});
  assert.deepEqual(E.parseReceiptInput(a.slice(0, 16).toUpperCase()), {kind: 'fingerprint', a: a.slice(0, 16)});
  assert.equal(E.verifyHref('p 1', 3, a), `/verify?p=p%201&v=3&a=${a}`);
});
