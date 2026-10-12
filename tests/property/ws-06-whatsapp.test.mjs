// WS-06: WhatsApp. Pure (no server, no network): wa.me share links and the prefilled messages
// (LT-03, SF-01), the Cloud API request bodies (SF-10 OTP template, SF-04 replies), the webhook
// signature check and payload parser (SF-04), and the inbound sender rules (L7).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, freezeClock} from '../support/property.mjs';

freezeClock();
const wa = await import('../../lib/whatsapp.ts');
const inbound = await import('../../lib/inbound.ts');
const LINK = 'https://scopeflow.example/review/' + 'b'.repeat(64);

// @covers LT-03 SF-01
test('LT-03: waLink() encodes newlines, ₹ and emoji; strips + and spaces from the phone', () => {
  const text = 'Hi Ada,\n\nCO-2 “Reel” ₹1,180.00 🎬 & more?\nThanks';
  const link = wa.waLink('+91 98765 43210', text);
  assert.ok(link.startsWith('https://wa.me/919876543210?text='), link);
  const encoded = link.split('?text=')[1];
  assert.doesNotMatch(encoded, /[\s\n+&#?]/, 'nothing in the text breaks the query string');
  assert.match(encoded, /%0A%0A/);
  assert.match(encoded, /%E2%82%B9/, '₹ is percent-encoded UTF-8');
  assert.match(encoded, /%F0%9F%8E%AC/, 'emoji survive');
  assert.equal(decodeURIComponent(encoded), text);
  assert.equal(wa.waLink('+44 (20) 7946-0958', 'x'), 'https://wa.me/442079460958?text=x');
  // No usable phone: the owner picks the chat.
  for (const phone of [null, '', 'not a phone', '+0123', '12']) assert.equal(wa.waLink(phone, 'hello'), 'https://wa.me/?text=hello');
  fc.assert(fc.property(fc.string({maxLength: 200}), fc.stringMatching(/^\+?[1-9][0-9 ]{7,16}$/), (t, phone) => {
    const l = wa.waLink(phone, t);
    const [head, q] = l.split('?text=');
    assert.match(head, /^https:\/\/wa\.me\/\d*$/);
    assert.doesNotMatch(head, /[+ ]/);
    assert.equal(decodeURIComponent(q), t.normalize('NFC').slice(0, 3000));
  }));
});

// @covers LT-03 SF-01
test('SF-01: polite prefilled messages for scope, change order, invoice and reminder in en/hi/ta', () => {
  const v = {client: 'Ada\nBcc: x', title: 'Brand refresh', link: LINK, seller: 'Studio K', seq: 2, co_title: 'Extra reel', amount: '₹1,180.00', number: 'INV-7', due: '2026-11-01'};
  for (const lang of ['en', 'hi', 'ta']) for (const kind of ['scope', 'change_order', 'invoice', 'reminder']) {
    const m = wa.shareMessage(kind, v, lang);
    assert.ok(m.includes(LINK), `${lang}/${kind} carries the link`);
    assert.ok(m.includes('Brand refresh') || kind === 'reminder', `${lang}/${kind} names the project`);
    assert.doesNotMatch(m, /Bcc: x\n/, 'owner text cannot add lines');
  }
  assert.match(wa.shareMessage('change_order', v, 'en'), /CO-2 "Extra reel".*₹1,180\.00/);
  assert.match(wa.shareMessage('scope', v, 'hi'), /नमस्ते/);
  assert.match(wa.shareMessage('invoice', v, 'ta'), /வணக்கம்/);
  assert.equal(wa.shareMessage('scope', v, 'fr'), wa.shareMessage('scope', v, 'en'), 'unknown languages fall back to English');
});

// @covers SF-10 SF-04
test('SF-10: the OTP is an authentication template with the code in the body and the copy-code button', () => {
  const body = wa.cloudBody({otpTemplate: 'scopeflow_code', otpLang: 'en'}, '+91 98765 43210', {type: 'otp', code: '482913'});
  assert.equal(body.to, '919876543210');
  assert.equal(body.type, 'template');
  assert.equal(body.template.name, 'scopeflow_code');
  assert.deepEqual(body.template.components[0], {type: 'body', parameters: [{type: 'text', text: '482913'}]});
  assert.deepEqual(body.template.components[1], {type: 'button', sub_type: 'url', index: '0', parameters: [{type: 'text', text: '482913'}]});
  assert.throws(() => wa.cloudBody({otpTemplate: null, otpLang: 'en'}, '+919876543210', {type: 'otp', code: '1'}), /WHATSAPP_OTP_TEMPLATE/);
  const list = wa.cloudBody({otpTemplate: null, otpLang: 'en'}, '+919876543210', {type: 'list', body: 'Which project?', button: 'Choose project please now', rows: Array.from({length: 12}, (_, i) => ({id: 'p:' + i, title: 'A very long project title number ' + i}))});
  assert.equal(list.interactive.action.sections[0].rows.length, 10);
  assert.ok(list.interactive.action.sections[0].rows.every(r => r.title.length <= 24));
  assert.equal(wa.cloudBody({otpTemplate: null, otpLang: 'en'}, '+919876543210', {type: 'text', text: 'x'.repeat(5000)}).text.body.length, 4096);
  assert.equal(wa.cloudConfig({WHATSAPP_PHONE_NUMBER_ID: '12345', WHATSAPP_ACCESS_TOKEN: 't'}).apiUrl, 'https://graph.facebook.com');
  assert.equal(wa.cloudConfig({WHATSAPP_PHONE_NUMBER_ID: 'abc', WHATSAPP_ACCESS_TOKEN: 't'}), null);
});

// @covers SF-04
test('SF-04: X-Hub-Signature-256 is checked in constant time; webhook messages parse', () => {
  const secret = 'app-secret-test';
  fc.assert(fc.property(fc.string({maxLength: 300}), fc.string({maxLength: 5}), (raw, tweak) => {
    const sig = wa.signBody(raw, secret);
    assert.equal(wa.validSignature(raw, sig, secret), true);
    assert.equal(wa.validSignature(raw, sig.toUpperCase().replace('SHA256=', 'sha256='), secret), true);
    if (tweak) assert.equal(wa.validSignature(raw + tweak, sig, secret), false);
    assert.equal(wa.validSignature(raw, sig, secret + 'x'), false);
  }));
  for (const h of [null, '', 'sha256=', 'sha1=abc', 'sha256=' + 'z'.repeat(64)]) assert.equal(wa.validSignature('{}', h, secret), false);
  const payload = {entry: [{changes: [{value: {statuses: [{id: 's'}], messages: [
    {id: 'wamid.1', from: '919876543210', type: 'text', text: {body: 'Can you also add a reel?'}, context: {forwarded: true}},
    {id: 'wamid.2', from: '919876543210', type: 'interactive', interactive: {list_reply: {id: 'p:abc'}}},
    {id: 'wamid.3', from: '919876543210', type: 'audio'},
    {id: 'wamid.4', from: '919876543210', type: 'image'},
    {from: 'no-id'},
  ]}}]}]};
  assert.deepEqual(wa.parseWebhook(payload).map(m => [m.id, m.from, m.kind, m.text, m.choice, m.forwarded]), [
    ['wamid.1', '+919876543210', 'text', 'Can you also add a reel?', null, true],
    ['wamid.2', '+919876543210', 'choice', '', 'p:abc', false],
    ['wamid.3', '+919876543210', 'audio', '', null, false],
    ['wamid.4', '+919876543210', 'other', '', null, false],
  ]);
  fc.assert(fc.property(fc.anything(), raw => { assert.ok(Array.isArray(wa.parseWebhook(raw))); }));
});

// @covers L7
test('L7: inbound matches only the envelope recipient, reads SPF/DKIM verdicts and builds the allow-list', () => {
  const m = inbound.parseInbound({FromFull: {Email: 'Stranger@Evil.example'}, ToFull: [{Email: 'scope-0123456789abcdef01234567@in.example.com'}], OriginalRecipient: 'other@in.example.com', Subject: 's', TextBody: 'x', Headers: [{Name: 'Received-SPF', Value: 'fail (domain does not designate)'}, {Name: 'Authentication-Results', Value: 'mx; dkim=fail; dmarc=fail'}]});
  assert.deepEqual(m.envelope, ['other@in.example.com']);
  assert.equal(m.from, 'stranger@evil.example');
  assert.equal(inbound.authOutcome(m.auth), 'fail');
  assert.equal(inbound.authOutcome({spf: 'pass', dkim: 'pass', dmarc: null}), 'pass');
  assert.equal(inbound.authOutcome({spf: null, dkim: null, dmarc: null}), 'unknown');
  const allow = inbound.allowList('Client@Acme.co', ['cosigner@acme.co', null], '', 'owner@studio.in');
  assert.deepEqual(allow, ['client@acme.co', 'cosigner@acme.co', 'owner@studio.in']);
  assert.equal(allow.includes('stranger@evil.example'), false);
});
