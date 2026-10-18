// The operator routes accept SCOPEFLOW_CRON_SECRET (or SCOPEFLOW_ADMIN_TOKEN) with a constant-time compare.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../support/ts-resolve.mjs';

const {adminAuthorized} = await import('../../lib/admin-auth.ts');

const secret = 'ci-only-cron-secret';
const env = {SCOPEFLOW_CRON_SECRET: secret};
const call = (authorization) => adminAuthorized(new Request('http://localhost/api/readiness', {headers: authorization ? {authorization} : {}}), env);

test('cron and admin routes reject a missing, short, or wrong bearer secret', () => {
  assert.equal(call(null), false);
  assert.equal(call('Bearer short'), false);
  assert.equal(call('Bearer ' + secret.slice(0, -1) + 'x'), false);
  assert.equal(call('Bearer ' + secret), true);
  assert.equal(adminAuthorized(new Request('http://localhost/api/readiness', {headers: {authorization: 'Bearer ' + secret}}), {SCOPEFLOW_CRON_SECRET: 'tiny'}), false);
  const drain = readFileSync(new URL('../../app/api/notify/drain/route.ts', import.meta.url), 'utf8');
  const reconcile = readFileSync(new URL('../../app/api/payments/razorpay/reconcile/route.ts', import.meta.url), 'utf8');
  assert.match(drain, /SCOPEFLOW_CRON_SECRET/);
  assert.match(drain, /timingSafeEqual/);
  assert.match(reconcile, /SCOPEFLOW_CRON_SECRET/);
});
