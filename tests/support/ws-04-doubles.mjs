// WS-04 provider doubles (localhost only): Razorpay (orders, payments, refunds with idempotency,
// settlements), Razorpay Technology Partner OAuth (token exchange) and Stripe (Checkout sessions
// with idempotency and expiry, refunds, balance, payouts). Every request is logged so tests can
// assert who was called with which credentials, and how often. Used by tests/ws-04-providers.mjs.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';

const id = p => p + randomUUID().replaceAll('-', '').slice(0, 14);
export async function startDoubles() {
  const log = [];
  const rz = {orders: new Map(), payments: new Map(), refunds: new Map(), idem: new Map(), onRefund: null};
  const st = {sessions: new Map(), idem: new Map(), refunds: new Map(), refundIdem: new Map()};
  const send = (res, status, body) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(body)); };
  async function razorpay(req, res, path, body, auth) {
    if (auth === 'Basic ' + Buffer.from('rzp_test_badkey00:bad').toString('base64')) return send(res, 401, {error: {description: 'Authentication failed'}});
    if (req.method === 'GET' && path === '/v1/orders') return send(res, 200, {items: []});
    if (req.method === 'POST' && path === '/v1/orders') {
      const b = JSON.parse(body), o = {id: id('order_'), entity: 'order', amount: b.amount, currency: b.currency, receipt: b.receipt, notes: b.notes, transfers: b.transfers, status: 'created', auth};
      rz.orders.set(o.id, o); return send(res, 200, o);
    }
    let m;
    if (req.method === 'GET' && (m = path.match(/^\/v1\/orders\/(order_\w+)\/payments$/))) return rz.orders.has(m[1]) ? send(res, 200, {items: [...rz.payments.values()].filter(p => p.order_id === m[1])}) : send(res, 404, {error: {description: 'The id provided does not exist'}});
    if (req.method === 'GET' && (m = path.match(/^\/v1\/payments\/(pay_\w+)$/))) return rz.payments.has(m[1]) ? send(res, 200, rz.payments.get(m[1])) : send(res, 404, {error: {description: 'The id provided does not exist'}});
    if (req.method === 'POST' && (m = path.match(/^\/v1\/payments\/(pay_\w+)\/refund$/))) {
      const p = rz.payments.get(m[1]);
      if (!p) return send(res, 400, {error: {description: 'The id provided does not exist'}});
      const key = req.headers['x-razorpay-idempotency'];
      if (key && rz.idem.has(key)) return send(res, 200, rz.refunds.get(rz.idem.get(key)));
      const b = JSON.parse(body);
      const done = [...rz.refunds.values()].filter(r => r.payment_id === p.id).reduce((s, r) => s + r.amount, 0);
      if (done + b.amount > p.amount) return send(res, 400, {error: {description: 'The refund amount provided is greater than amount captured'}});
      const r = {id: id('rfnd_'), entity: 'refund', payment_id: p.id, amount: b.amount, receipt: b.receipt, notes: b.notes ?? {}, status: 'processed'};
      rz.refunds.set(r.id, r); if (key) rz.idem.set(key, r.id);
      if (rz.onRefund) { const hook = rz.onRefund; rz.onRefund = null; await hook(r); }
      return send(res, 200, r);
    }
    if (req.method === 'GET' && (m = path.match(/^\/v1\/payments\/(pay_\w+)\/refunds$/))) return send(res, 200, {items: [...rz.refunds.values()].filter(r => r.payment_id === m[1])});
    if (req.method === 'GET' && path === '/v1/settlements') return send(res, 200, {items: [{id: 'setl_test1', amount: 290000, fees: 5900, tax: 900, status: 'processed', utr: 'UTRSETTLE01', created_at: 1760000000}]});
    return send(res, 404, {error: {description: 'Unknown URL'}});
  }
  function oauth(req, res, path, body) {
    if (req.method === 'POST' && path === '/token') {
      const b = JSON.parse(body);
      if (b.client_id !== 'partner_client_test' || b.client_secret !== 'partner_secret_test') return send(res, 401, {error: 'invalid_client', error_description: 'Client authentication failed'});
      if (b.grant_type === 'authorization_code' && b.code === 'good-code') return send(res, 200, {token_type: 'Bearer', expires_in: 7776000, access_token: 'oauth-access-1', refresh_token: 'oauth-refresh-1', public_token: 'rzp_test_oauth_PUBLIC1', razorpay_account_id: 'acc_SUBMERCH01'});
      if (b.grant_type === 'refresh_token') return send(res, 200, {token_type: 'Bearer', expires_in: 7776000, access_token: 'oauth-access-2', refresh_token: 'oauth-refresh-2', public_token: 'rzp_test_oauth_PUBLIC1', razorpay_account_id: 'acc_SUBMERCH01'});
      return send(res, 400, {error: 'invalid_grant', error_description: 'Bad code'});
    }
    if (req.method === 'POST' && path === '/revoke') return send(res, 200, {message: 'Token Revoked'});
    return send(res, 404, {error: 'not_found'});
  }
  function stripe(req, res, path, body, auth) {
    if (auth === 'Bearer rk_test_badkey00') return send(res, 401, {error: {message: 'Invalid API Key provided'}});
    let m;
    if (req.method === 'GET' && path === '/v1/balance') return send(res, 200, {object: 'balance', available: []});
    if (req.method === 'POST' && path === '/v1/checkout/sessions') {
      const key = req.headers['idempotency-key'];
      if (key && st.idem.has(key)) return send(res, 200, st.sessions.get(st.idem.get(key)));
      const f = new URLSearchParams(body), sid = 'cs_test_' + randomUUID().replaceAll('-', '');
      const s = {id: sid, object: 'checkout.session', url: 'https://checkout.stripe.test/c/' + sid, status: 'open', payment_status: 'unpaid', payment_intent: null, amount_total: Number(f.get('line_items[0][price_data][unit_amount]')), currency: f.get('line_items[0][price_data][currency]'), expires_at: Number(f.get('expires_at')) || null, success_url: f.get('success_url'), auth};
      st.sessions.set(sid, s); if (key) st.idem.set(key, sid);
      return send(res, 200, s);
    }
    if (req.method === 'GET' && (m = path.match(/^\/v1\/checkout\/sessions\/(cs_test_\w+)$/))) return st.sessions.has(m[1]) ? send(res, 200, st.sessions.get(m[1])) : send(res, 404, {error: {message: 'No such checkout session'}});
    if (req.method === 'POST' && (m = path.match(/^\/v1\/checkout\/sessions\/(cs_test_\w+)\/expire$/))) { const s = st.sessions.get(m[1]); if (!s) return send(res, 404, {error: {message: 'No such checkout session'}}); s.status = 'expired'; return send(res, 200, s); }
    if (req.method === 'POST' && path === '/v1/refunds') {
      const key = req.headers['idempotency-key'];
      if (key && st.refundIdem.has(key)) return send(res, 200, st.refunds.get(st.refundIdem.get(key)));
      const f = new URLSearchParams(body), pi = f.get('payment_intent'), amount = Number(f.get('amount'));
      const s = [...st.sessions.values()].find(x => x.payment_intent === pi);
      if (!s) return send(res, 400, {error: {message: 'No such payment_intent'}});
      const r = {id: 're_' + randomUUID().slice(0, 12), object: 'refund', amount, payment_intent: pi, metadata: {scopeflow_request: f.get('metadata[scopeflow_request]')}, status: 'succeeded'};
      st.refunds.set(r.id, r); if (key) st.refundIdem.set(key, r.id);
      return send(res, 200, r);
    }
    if (req.method === 'GET' && path === '/v1/refunds') { const pi = new URL('http://x' + req.url).searchParams.get('payment_intent'); return send(res, 200, {data: [...st.refunds.values()].filter(r => r.payment_intent === pi)}); }
    if (req.method === 'GET' && path === '/v1/payouts') return send(res, 200, {data: [{id: 'po_test1', amount: 25000, currency: 'eur', status: 'paid', arrival_date: 1760000000}]});
    return send(res, 404, {error: {message: 'Unrecognized request URL'}});
  }
  const server = createServer((req, res) => {
    const parts = [];
    req.on('data', c => parts.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(parts).toString(), url = req.url, auth = req.headers.authorization ?? null;
      const [service, ...rest] = url.split('?')[0].replace(/^\//, '').split('/');
      const path = '/' + rest.join('/');
      log.push({service, method: req.method, path, auth, idempotency: req.headers['x-razorpay-idempotency'] ?? req.headers['idempotency-key'] ?? null, body});
      try {
        if (service === 'razorpay') return await razorpay(req, res, path, body, auth);
        if (service === 'oauth') return oauth(req, res, path, body);
        if (service === 'stripe') return stripe(req, res, path, body, auth);
        send(res, 404, {error: 'unknown service'});
      } catch (e) { send(res, 500, {error: String(e)}); }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, log, rz, st,
    count: (service, method, re) => log.filter(l => l.service === service && l.method === method && re.test(l.path)).length,
    /** The client pays a Razorpay order (Checkout): a captured payment for `amount` (default: the order amount). */
    capture(orderId, amount) { const o = rz.orders.get(orderId); const p = {id: id('pay_'), entity: 'payment', order_id: orderId, amount: amount ?? o.amount, currency: o?.currency ?? 'INR', status: 'captured'}; rz.payments.set(p.id, p); return p; },
    /** The client completes a Stripe Checkout session. */
    payStripe(sessionId) { const s = st.sessions.get(sessionId); Object.assign(s, {status: 'complete', payment_status: 'paid', payment_intent: 'pi_' + sessionId.slice(8, 24)}); return s; },
    close: () => new Promise(r => server.close(r)),
  };
}
