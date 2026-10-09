// PR B: email one-time code before signing. Pure (no server, no network): code hashing,
// masking, the code email, dev-mode delivery, provider delivery through a stubbed fetch,
// and the signed identity evidence that ties a verified email to the decision anchor.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fc, freezeClock, TEST_SECRET} from '../support/property.mjs';

process.env.SCOPEFLOW_SIGNING_SECRET = TEST_SECRET;
freezeClock();
const otp = await import('../../lib/otp.ts');

test('codes are 6 digits; hashes are salted by the OTP id and deterministic', async () => {
  for (let i = 0; i < 200; i++) assert.match(otp.generateCode(), /^\d{6}$/);
  assert.equal(await otp.codeHash('a', '123456'), await otp.codeHash('a', '123456'));
  assert.notEqual(await otp.codeHash('a', '123456'), await otp.codeHash('b', '123456'));
  assert.notEqual(await otp.codeHash('a', '123456'), await otp.codeHash('a', '123457'));
  assert.equal(otp.normalizeCode(' 123-456 '), '123456');
  assert.equal(otp.normalizeCode(123456), '');
});

test('emails are masked before they reach the review page', () => {
  assert.equal(otp.maskEmail('ada@example.com'), 'a**@example.com');
  assert.equal(otp.maskEmail('a@example.com'), '*@example.com');
  assert.equal(otp.maskEmail('averyveryverylongname@example.com'), 'a******@example.com');
  fc.assert(fc.property(fc.emailAddress(), email => {
    const masked = otp.maskEmail(email);
    assert.equal(masked.split('@')[1], email.split('@')[1]);
    if (email.split('@')[0].length > 1) assert.notEqual(masked, email);
  }));
});

test('the code email is header-safe and escapes the scope title', () => {
  const m = otp.otpEmail({code: '042517', title: 'Logo <b>\r\nBcc: x@evil.example', version: 3});
  assert.ok(!/[\r\n]/.test(m.subject));
  assert.match(m.subject, /^042517 is your Scopeflow code/);
  assert.ok(m.text.includes('042517') && m.html.includes('042517'));
  assert.ok(!m.html.includes('<b>') && m.html.includes('&lt;b&gt;'));
});

test('dev mode only on a localhost APP_URL; availability needs a provider or dev mode', () => {
  assert.equal(otp.otpDevMode({SCOPEFLOW_OTP_DEV: '1', APP_URL: 'http://localhost:5173'}), true);
  assert.equal(otp.otpDevMode({SCOPEFLOW_OTP_DEV: '1', APP_URL: 'https://scopeflow.example'}), false);
  assert.equal(otp.otpDevMode({SCOPEFLOW_OTP_DEV: '0', APP_URL: 'http://localhost:5173'}), false);
  assert.equal(otp.otpAvailable({}), false);
  assert.equal(otp.otpAvailable({RESEND_API_KEY: 're_x', SCOPEFLOW_MAIL_FROM: 'S <s@x.example>'}), true);
});

test('dev-mode delivery logs the code and never calls the network', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network used'); };
  const log = join(mkdtempSync(join(tmpdir(), 'otp-')), 'codes.log');
  const info = console.info; const lines = []; console.info = x => lines.push(x);
  try {
    const r = await otp.deliverCode('ada@example.com', otp.otpEmail({code: '111222', title: 'T', version: 1}), {code: '111222', version_id: 'v1', id: 'o1'}, {SCOPEFLOW_OTP_DEV: '1', APP_URL: 'http://localhost:5173', SCOPEFLOW_OTP_DEV_LOG: log});
    assert.equal(r.delivered, 'dev_log');
    assert.match(lines[0], /code 111222 for version v1 \(a\*\*@example\.com by email\)/);
    assert.deepEqual(JSON.parse(readFileSync(log, 'utf8')), {version_id: 'v1', email: 'ada@example.com', channel: 'email', code: '111222', at: '2026-10-07T09:00:00.000Z'});
    await assert.rejects(otp.deliverCode('ada@example.com', otp.otpEmail({code: '1', title: 'T', version: 1}), {code: '1', version_id: 'v', id: 'o'}, {}), otp.OtpUnavailable);
  } finally { globalThis.fetch = realFetch; console.info = info; }
});

test('SMS and WhatsApp: providers from env, masked numbers, request shapes, dev-mode log, safe errors', async () => {
  const sms = await import('../../lib/sms.ts');
  assert.equal(sms.smsConfig({}), null);
  const msg91 = sms.smsConfig({MSG91_AUTH_KEY: 'k91', MSG91_OTP_TEMPLATE_ID: 't1'});
  assert.equal(msg91.provider, 'msg91'); assert.deepEqual(msg91.channels, ['sms']);
  const twilio = sms.smsConfig({TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_SMS_FROM: '+15550001', TWILIO_WHATSAPP_FROM: '+15550002', TWILIO_WHATSAPP_CONTENT_SID: 'HX1'});
  assert.deepEqual(twilio.channels, ['sms', 'whatsapp']);
  assert.equal(sms.smsConfig({MSG91_AUTH_KEY: 'k', MSG91_OTP_TEMPLATE_ID: 't', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_SMS_FROM: '+1', SCOPEFLOW_SMS_PROVIDER: 'twilio'}).provider, 'twilio');
  assert.equal(sms.maskPhone('+919876543210'), '+91******3210');
  assert.ok(!sms.maskPhone('+15551234567').includes('555123'));
  const m = sms.smsRequest(msg91, 'sms', '+919876543210', 'text', '123456');
  assert.equal(m.url, 'https://control.msg91.com/api/v5/flow'); assert.equal(m.init.headers.authkey, 'k91');
  assert.deepEqual(JSON.parse(m.init.body).recipients, [{mobiles: '919876543210', otp: '123456'}]);
  const w = sms.smsRequest(twilio, 'whatsapp', '+919876543210', 'text', '654321');
  const form = new URLSearchParams(w.init.body);
  assert.equal(form.get('To'), 'whatsapp:+919876543210'); assert.equal(form.get('From'), 'whatsapp:+15550002');
  assert.equal(form.get('ContentSid'), 'HX1'); assert.equal(form.get('ContentVariables'), '{"1":"654321"}'); assert.equal(form.get('Body'), null);
  assert.equal(new URLSearchParams(sms.smsRequest(twilio, 'sms', '+919876543210', 'hello 1', '1').init.body).get('Body'), 'hello 1');
  assert.match(sms.otpSms({code: '123456', title: 'Logo\nSubject: x'}), /^123456 is your Scopeflow code .*"Logo Subject: x"/);
  assert.ok(otp.otpAvailable({TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_SMS_FROM: '+1'}, 'sms'));
  assert.ok(!otp.otpAvailable({TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_SMS_FROM: '+1'}, 'whatsapp'));
  assert.deepEqual(otp.otpChannels({SCOPEFLOW_OTP_DEV: '1', APP_URL: 'http://localhost:5173'}), ['email', 'sms', 'whatsapp']);
  // Provider refusals never echo the token.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({message: 'bad token tok'}), {status: 401});
  try { await assert.rejects(otp.deliverCode('+919876543210', otp.otpEmail({code: '1', title: 'T', version: 1}), {code: '1', version_id: 'v', id: 'o'}, {TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_SMS_FROM: '+1'}, 'sms'), e => e instanceof otp.OtpDeliveryError && !e.message.includes('tok')); }
  finally { globalThis.fetch = realFetch; }
  // Phone evidence is signed in its own canonical form; the email form is unchanged.
  const anchor = 'a'.repeat(64);
  const ev = {method: 'sms_otp', phone: '+919876543210', verified_at: '2026-10-07T09:00:00.000Z', otp_id: 'o1'};
  assert.match(await otp.evidenceMessage(anchor, ev), /^scopeflow-evidence-v1:a{64}:[0-9a-f]{64}$/);
  const sig = await otp.signEvidence(anchor, ev);
  assert.equal(await otp.verifyEvidence(anchor, ev, sig), 'valid');
  assert.equal(await otp.verifyEvidence(anchor, {...ev, phone: '+919876543211'}, sig), 'invalid');
});

test('provider delivery sends the code through Resend with an idempotency key', async () => {
  const realFetch = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({url, init}); return new Response(JSON.stringify({id: 'em_1'}), {status: 200}); };
  try {
    const r = await otp.deliverCode('ada@example.com', otp.otpEmail({code: '333444', title: 'T', version: 1}), {code: '333444', version_id: 'v1', id: 'o9'}, {RESEND_API_KEY: 're_test', SCOPEFLOW_MAIL_FROM: 'S <s@x.example>', SCOPEFLOW_OTP_DEV: '1', APP_URL: 'http://localhost:5173'});
    assert.equal(r.delivered, 'email');
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].init.headers['Idempotency-Key'], 'scopeflow-otp-o9');
    const sent = JSON.parse(calls[0].init.body);
    assert.deepEqual(sent.to, ['ada@example.com']);
    assert.ok(sent.text.includes('333444'));
  } finally { globalThis.fetch = realFetch; }
});

test('identity evidence is signed over the anchor: any change breaks the signature', async () => {
  const anchor = 'a'.repeat(64);
  const ev = {method: 'email_otp', email: 'ada@example.com', verified_at: '2026-10-07T09:00:00.000Z', otp_id: 'o1'};
  const sig = await otp.signEvidence(anchor, ev);
  assert.equal(await otp.verifyEvidence(anchor, ev, sig), 'valid');
  assert.equal(await otp.verifyEvidence('b'.repeat(64), ev, sig), 'invalid');
  for (const field of Object.keys(ev)) assert.equal(await otp.verifyEvidence(anchor, {...ev, [field]: ev[field] + 'x'}, sig), 'invalid', field);
  assert.equal(await otp.verifyEvidence(anchor, ev, null), 'unsigned');
  // Key order of the stored JSON never matters.
  assert.equal(await otp.verifyEvidence(anchor, {otp_id: 'o1', verified_at: ev.verified_at, email: ev.email, method: 'email_otp'}, sig), 'valid');
});
