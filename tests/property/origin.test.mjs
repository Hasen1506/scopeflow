// CSRF guard (lib/origin.ts safeOrigin): a browser request from a foreign origin is never
// accepted, whatever host the server is reached on. Pure: Request objects, no server.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const {safeOrigin, safeReturnPath, publicOrigin} = await import('../../lib/origin.ts');
const APP = 'https://scopeflow.example';
process.env.APP_URL = APP;

const schemeArb = fc.constantFrom('http', 'https');
const hostArb = fc.oneof(fc.domain(), fc.constantFrom('localhost', '127.0.0.1', '[::1]', 'scopeflow.example.evil.test', 'evil-scopeflow.example', 'scopeflow.example.co'));
const portArb = fc.option(fc.integer({min: 1, max: 65535}), {nil: null});
const originArb = fc.tuple(schemeArb, hostArb, portArb).map(([s, h, p]) => `${s}://${h}${p ? ':' + p : ''}`);
// Where the server believes it was reached: bind address, proxy headers, or APP_URL itself.
const servedArb = fc.record({url: fc.constantFrom('http://0.0.0.0:10000/api/scopes', 'http://localhost:5173/api/scopes', 'https://scopeflow.example/api/scopes'), host: fc.option(fc.constantFrom('scopeflow.example', 'localhost:5173', '0.0.0.0:10000'), {nil: null}), proto: fc.option(fc.constantFrom('https', 'http'), {nil: null})});

function request({url, host, proto}, origin) {
  const headers = new Headers();
  if (origin !== undefined) headers.set('origin', origin);
  if (host) headers.set('x-forwarded-host', host);
  if (proto) headers.set('x-forwarded-proto', proto);
  return new Request(url, {method: 'POST', headers});
}
const ownOrigin = ({url, host, proto}) => {
  const u = new URL(url);
  return host ? `${proto ?? u.protocol.slice(0, -1)}://${host}` : u.origin;
};

test('a foreign Origin is always rejected', () => {
  fc.assert(fc.property(servedArb, originArb, (served, origin) => {
    const own = new URL(ownOrigin(served)).origin;
    fc.pre(origin !== APP && new URL(origin).origin !== own);
    assert.equal(safeOrigin(request(served, origin)), false, `${origin} accepted on ${JSON.stringify(served)}`);
  }), {numRuns: 300});
});

test('opaque and malformed origins are rejected', () => {
  fc.assert(fc.property(servedArb, fc.oneof(fc.constant('null'), fc.string(), fc.constantFrom('file://', 'chrome-extension://abc', 'https://scopeflow.example.', 'HTTPS://SCOPEFLOW.EXAMPLE', 'https://scopeflow.example/', ' https://scopeflow.example')), (served, origin) => {
    fc.pre(origin !== APP && origin !== ownOrigin(served));
    let req;
    try { req = request(served, origin); } catch { return; } // not a valid header value at all
    const sent = req.headers.get('origin'); // what a browser would actually deliver (whitespace trimmed)
    fc.pre(sent !== APP && sent !== ownOrigin(served) && sent !== '');
    assert.equal(safeOrigin(req), false, JSON.stringify(origin));
  }), {numRuns: 300});
});

test('the canonical origin and the origin the request was addressed to are accepted', () => {
  fc.assert(fc.property(servedArb, served => {
    assert.equal(safeOrigin(request(served, APP)), true);
    assert.equal(safeOrigin(request(served, ownOrigin(served))), true);
    assert.equal(safeOrigin(request(served, undefined)), true, 'non-browser clients send no Origin');
  }), {numRuns: 100});
});

test('sign-in return paths never leave the site', () => {
  fc.assert(fc.property(fc.oneof(fc.string(), fc.webUrl(), fc.webPath(), fc.constantFrom('//evil.example', '/.//evil.example', '/\\evil.example', '/%2F%2Fevil.example', '/\t/evil.example', '/auth/sign-in', '/api/auth/x')), value => {
    const out = safeReturnPath(value);
    assert.ok(out.startsWith('/') && !out.startsWith('//') && !out.includes('\\'), out);
    assert.equal(new URL(out, 'https://scopeflow.example').origin, 'https://scopeflow.example');
    assert.ok(!out.startsWith('/auth/') && !out.startsWith('/api/auth/'));
  }), {numRuns: 300});
});

// Review S12: in production without APP_URL a spoofed X-Forwarded-Host must never reach emailed links.
test('S12: public links refuse to use forwarded headers in production without APP_URL', () => {
  const spoofed = new Request('http://0.0.0.0:10000/api/x', {headers: {'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https'}});
  assert.throws(() => publicOrigin(spoofed, {NODE_ENV: 'production'}), e => e.name === 'Unavailable' && e.dep === 'public_origin');
  assert.equal(publicOrigin(spoofed, {NODE_ENV: 'development'}), 'https://evil.example', 'outside production the request origin is still used');
  assert.equal(publicOrigin(spoofed, {NODE_ENV: 'production', APP_URL: APP}), APP);
});
