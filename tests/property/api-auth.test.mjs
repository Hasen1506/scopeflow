// Every API route either checks an identity (session, API token, cron secret, webhook signature,
// or a bearer review/cosign link) or is on the short public list. A new route that forgets both fails here.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';

function* routes(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* routes(path);
    else if (name === 'route.ts') yield path;
  }
}

const AUTH = /ownerAuth|\bowner\(|getUser|adminAuthorized|templateAccess|inboundAuthorized|projectFor\(|resolveReviewToken|resolveCosignToken|clientNotice\(|verifyUnsubscribe|parseCallback|verifyStripeSignature|verifyWebhookSignature|verifyRazorpaySignature|verifyPaymentSignature|validSignature|svixValid|basicPasswordValid|tokenValid|startCheckout|SCOPEFLOW_CRON_SECRET|timingSafeEqual/;

/** Pages and lookups that are public on purpose. Capability links live in AUTH via their resolvers. */
const PUBLIC = new Set([
  'app/api/route.ts',
  'app/api/health/route.ts',
  'app/api/openapi/route.ts',
  'app/api/signing-key/route.ts',
  'app/api/verify/route.ts',
  'app/api/brand/[hash]/route.ts',
  'app/api/auth/[...path]/route.ts',
  'app/api/payments/stripe/return/route.ts',
]);

test('every API route authenticates, or is on the public list', () => {
  const bare = [];
  for (const path of routes('app/api')) {
    const rel = path.split('app/api/').pop();
    const key = 'app/api/' + rel;
    const src = readFileSync(path, 'utf8');
    const capability = key.includes('[token]') && /token/.test(src);
    if (!AUTH.test(src) && !PUBLIC.has(key) && !capability) bare.push(key);
  }
  assert.deepEqual(bare, []);
});
