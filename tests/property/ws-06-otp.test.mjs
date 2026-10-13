// WS-06: one-time-code transport for WS-02 (SF-10). Pure: the WhatsApp Cloud API and the mail
// providers are local stubs (injected fetch), nothing leaves the process.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freezeClock} from '../support/property.mjs';

freezeClock();
const sms = await import('../../lib/sms.ts');

const WA_ENV = {WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_ACCESS_TOKEN: 'wa-token', WHATSAPP_OTP_TEMPLATE: 'scopeflow_code', WHATSAPP_API_URL: 'http://wa.double.test', APP_URL: 'https://scopeflow.example'};
const mailConfigs = {postmark: {provider: 'postmark', apiKey: 'pm', from: 'Scopeflow <codes@scopeflow.example>', replyTo: null, apiUrl: 'http://pm.double.test', stream: 'outbound'}};
function doubles({whatsapp = 200, postmark = 200} = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({url: String(url), body, headers: init.headers});
    if (String(url).startsWith('http://wa.double.test')) return new Response(JSON.stringify(whatsapp === 200 ? {messages: [{id: 'wamid.ok'}]} : {error: {code: 131026}}), {status: whatsapp});
    if (String(url).startsWith('http://pm.double.test')) return new Response(JSON.stringify(postmark === 200 ? {MessageID: 'pm-1', ErrorCode: 0} : {Message: 'down'}), {status: postmark});
    return new Response('{}', {status: 599});
  };
  return {calls, fetchImpl};
}

// @covers SF-10
test('SF-10: OTP via the WhatsApp double is the authentication template carrying the code', async () => {
  const d = doubles();
  const r = await sms.sendOtpMessage('whatsapp', '+91 98765 43210', '482913', {env: WA_ENV, fetchImpl: d.fetchImpl, mailConfigs, fallbacks: [{channel: 'email', to: 'client@acme.example'}]});
  assert.deepEqual([r.channel, r.provider, r.id, r.to], ['whatsapp', 'meta', 'wamid.ok', '+91 98765 43210']);
  assert.equal(d.calls.length, 1);
  assert.equal(d.calls[0].url, 'http://wa.double.test/v21.0/1234567890/messages');
  assert.equal(d.calls[0].headers.Authorization, 'Bearer wa-token');
  const t = d.calls[0].body;
  assert.equal(t.type, 'template'); assert.equal(t.template.name, 'scopeflow_code'); assert.equal(t.to, '919876543210');
  assert.deepEqual(t.template.components.map(c => c.parameters[0].text), ['482913', '482913']);
});

// @covers SF-10
test('SF-10: a WhatsApp failure falls back to email (auth class, Postmark) at the address the caller gave', async () => {
  const d = doubles({whatsapp: 400});
  const r = await sms.sendOtpMessage('whatsapp', '+919876543210', '482913', {env: WA_ENV, fetchImpl: d.fetchImpl, mailConfigs, fallbacks: [{channel: 'email', to: 'client@acme.example'}], title: 'Brand refresh'});
  assert.deepEqual([r.channel, r.to, r.provider, r.id], ['email', 'client@acme.example', 'postmark', 'pm-1']);
  assert.deepEqual(r.attempts.map(a => [a.channel, a.ok]), [['whatsapp', false], ['email', true]]);
  const mail = d.calls[1].body;
  assert.equal(mail.To, 'client@acme.example');
  assert.match(mail.Subject, /^482913 is your Scopeflow code/);
  assert.ok(mail.TextBody.includes('482913'));
  // Every channel down: a typed error with each attempt, and never a different destination.
  const down = doubles({whatsapp: 500, postmark: 503});
  await assert.rejects(sms.sendOtpMessage('whatsapp', '+919876543210', '482913', {env: WA_ENV, fetchImpl: down.fetchImpl, mailConfigs, fallbacks: [{channel: 'email', to: 'client@acme.example'}]}),
    e => e instanceof sms.OtpTransportError && e.attempts.length === 2 && e.attempts.every(a => !a.ok));
  assert.deepEqual([...new Set(down.calls.map(c => c.body.to ?? c.body.To))], ['919876543210', 'client@acme.example']);
  await assert.rejects(sms.sendOtpMessage('email', 'a@b.co', 'abc', {env: WA_ENV}), /4–10 digits/);
});

// @covers SF-10
test('SF-10: without the Cloud API or a provider, dev mode logs the code and production refuses', async () => {
  await assert.rejects(sms.sendOtpMessage('whatsapp', '+919876543210', '123456', {env: {APP_URL: 'https://scopeflow.example'}, mailConfigs: {}}), sms.OtpTransportError);
  const r = await sms.sendOtpMessage('whatsapp', '+919876543210', '123456', {env: {APP_URL: 'http://localhost:5173', SCOPEFLOW_OTP_DEV: '1'}, mailConfigs: {}});
  assert.equal(r.provider, 'dev_log');
});
