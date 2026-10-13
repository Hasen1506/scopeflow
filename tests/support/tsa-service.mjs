// Local RFC 3161 timestamp authority for the integration suites (CI and local runs):
// POST a DER TimeStampReq to http://127.0.0.1:55434/ and get a TimeStampResp, signed by a throwaway
// TSA certificate created with openssl (tests/support/tsa.mjs). Its certificate path is printed.
// Also serves fixed reference exchange rates at GET /fx?base=USD&symbols=INR (a Frankfurter-shaped
// stand-in for SCOPEFLOW_FX_URL), the same rates Frankfurter-v2-shaped at GET /fbil?base=USD&quotes=INR
// (SCOPEFLOW_FBIL_URL, the FBIL provider WS-01 adds), a Stripe double under /stripe (STRIPE_API_URL: Checkout sessions,
// session lookups and refunds; POST /stripe/_pay/<session> marks one paid) and an embeddings double
// at POST /embeddings (SCOPEFLOW_EMBEDDINGS_URL), so the suites never depend on public services.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {makeTsa} from './tsa.mjs';

const tsa = makeTsa();
const sessions = new Map(), idempotent = new Map(), refunded = new Map();
// Embeddings double: a bag of concepts, so Hindi and English words for the same thing share an axis.
const CONCEPTS = [['hosting', 'होस्टिंग', 'server'], ['logo', 'लोगो'], ['card', 'कार्ड'], ['seo', 'search engine']];
const vector = t => CONCEPTS.map(words => words.filter(w => t.toLowerCase().includes(w)).length + 0.01);
const send = (res, status, body) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(body)); };
function stripe(req, res, body) {
  const path = req.url.replace(/^\/stripe/, '').split('?')[0];
  if (req.method === 'POST' && path === '/v1/checkout/sessions') {
    const key = req.headers['idempotency-key'];
    if (key && idempotent.has(key)) return send(res, 200, sessions.get(idempotent.get(key)));
    const f = new URLSearchParams(body), id = 'cs_test_' + randomUUID().replaceAll('-', '');
    const session = {id, object: 'checkout.session', url: 'https://checkout.stripe.test/c/' + id, payment_status: 'unpaid', payment_intent: null, amount_total: Number(f.get('line_items[0][price_data][unit_amount]')), currency: f.get('line_items[0][price_data][currency]'), metadata: Object.fromEntries([...f].filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]))};
    sessions.set(id, session); if (key) idempotent.set(key, id);
    return send(res, 200, session);
  }
  const pay = path.match(/^\/_pay\/(cs_test_\w+)$/);
  if (req.method === 'POST' && pay && sessions.has(pay[1])) { Object.assign(sessions.get(pay[1]), {payment_status: 'paid', payment_intent: 'pi_' + pay[1].slice(8, 24)}); return send(res, 200, sessions.get(pay[1])); }
  const get = path.match(/^\/v1\/checkout\/sessions\/(cs_test_\w+)$/);
  if (req.method === 'GET' && get) return sessions.has(get[1]) ? send(res, 200, sessions.get(get[1])) : send(res, 404, {error: {message: 'No such checkout session'}});
  if (req.method === 'POST' && path === '/v1/refunds') {
    const f = new URLSearchParams(body), pi = f.get('payment_intent'), amount = Number(f.get('amount'));
    const s = [...sessions.values()].find(x => x.payment_intent === pi);
    if (!s) return send(res, 400, {error: {message: 'No such payment_intent'}});
    if ((refunded.get(pi) ?? 0) + amount > s.amount_total) return send(res, 400, {error: {message: 'Refund amount is greater than unrefunded amount on charge'}});
    refunded.set(pi, (refunded.get(pi) ?? 0) + amount);
    return send(res, 200, {id: 're_' + randomUUID().slice(0, 12), object: 'refund', amount, status: 'succeeded'});
  }
  return send(res, 404, {error: {message: 'Unrecognized request URL'}});
}
const port = Number(process.env.TSA_PORT || 55434);
createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/fx')) {
    const u = new URL(req.url, 'http://x'), base = u.searchParams.get('base'), to = u.searchParams.get('symbols');
    const perUsd = {USD: 1, INR: 83.25, EUR: 0.92, GBP: 0.79};
    if (!perUsd[base] || !perUsd[to]) { res.writeHead(404, {'Content-Type': 'application/json'}); res.end('{"message":"not found"}'); return; }
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({amount: 1, base, date: '2026-10-01', rates: {[to]: Math.round(perUsd[to] / perUsd[base] * 1e6) / 1e6}}));
    return;
  }
  // changed by WS-10: FBIL double for SCOPEFLOW_FBIL_URL (request from WS-01); v2 shape [{date, base, quote, rate}].
  if (req.method === 'GET' && req.url.startsWith('/fbil')) {
    const u = new URL(req.url, 'http://x'), base = u.searchParams.get('base'), quotes = (u.searchParams.get('quotes') || '').split(',').filter(Boolean);
    const perUsd = {USD: 1, INR: 83.25, EUR: 0.92, GBP: 0.79};
    const rows = perUsd[base] ? quotes.filter(q => perUsd[q] && q !== base).map(quote => ({date: '2026-10-01', base, quote, rate: Math.round(perUsd[quote] / perUsd[base] * 1e6) / 1e6})) : [];
    if (!rows.length) { res.writeHead(404, {'Content-Type': 'application/json'}); res.end('{"message":"not found"}'); return; }
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(rows));
    return;
  }
  if (req.url.startsWith('/stripe/') || req.url === '/embeddings') {
    const parts = [];
    req.on('data', c => parts.push(c));
    req.on('end', () => {
      const body = Buffer.concat(parts).toString();
      if (req.url === '/embeddings') { const input = JSON.parse(body).input; return send(res, 200, {data: input.map((t, index) => ({index, embedding: vector(t)}))}); }
      stripe(req, res, body);
    });
    return;
  }
  if (req.method === 'GET') { res.writeHead(200); res.end('ok'); return; }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try { const reply = tsa.reply(Buffer.concat(chunks)); res.writeHead(200, {'Content-Type': 'application/timestamp-reply'}); res.end(reply); }
    catch (e) { res.writeHead(400); res.end(String(e)); }
  });
}).listen(port, '127.0.0.1', () => console.log(`tsa listening on ${port}; certificate ${tsa.cert}`));
