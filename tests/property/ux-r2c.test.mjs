// UX round 2c (reaudit-visual.md): time-zone picker list shape (#1), sign-in errors on both the
// returned and thrown SDK paths (#3), one /plans story for accounts without a subscription (#7, #8,
// #26), API-created projects in the account zone (#17), canonical zone names (#34), owner-facing
// payment copy (#10). Seeded, no network.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fc} from '../support/property.mjs';

const {authProblem, AuthProblem, AUTH_COPY} = await import('../../lib/auth/problem.ts');
const {canonicalZone, serverProjectZone, zoneToAdopt, validTimeZone} = await import('../../lib/time.ts');
const P = await import('../../lib/plans.ts');
const read = rel => readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

test('#1: the time-zone listbox is a rounded panel, never the 999px button pill', () => {
  const css = read('app/components/timezone-select.module.css');
  const list = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.list\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(list, /--btn-radius|--r-pill|999px/);
  assert.match(list, /border-radius:\s*var\(--r\b/);
  assert.match(list, /box-shadow:/);
  assert.match(list, /background:\s*var\(--popover/);
});

test('#3: a returned Better Auth error and a thrown normalized error give the same copy and clear the password', () => {
  const returned = authProblem({status: 401, code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password'}, 'sign-in');
  // What @neondatabase/auth throws from its fetch wrapper (supabase-style AuthApiError).
  const thrownErr = Object.assign(new Error('Invalid email or password'), {status: 401, code: 'invalid_credentials', name: 'AuthApiError'});
  const thrown = authProblem(thrownErr, 'sign-in');
  for (const p of [returned, thrown]) {
    assert.ok(p instanceof AuthProblem);
    assert.equal(p.message, AUTH_COPY.wrongDetails);
    assert.equal(p.credentials, true);
  }
  // A code alone (no status) still maps; so does the upstream message alone.
  assert.equal(authProblem({code: 'user_not_found'}, 'sign-in').message, AUTH_COPY.wrongDetails);
  assert.equal(authProblem(new Error('Invalid email or password'), 'sign-in').message, AUTH_COPY.wrongDetails);
});

test('#3: rate limits, service trouble, offline and unverified email keep the password and say whose problem it is', () => {
  const keep = (e, copy) => { const p = authProblem(e, 'sign-in'); assert.equal(p.message, copy); assert.equal(p.credentials, false); };
  keep({status: 429}, AUTH_COPY.tooMany);
  keep(Object.assign(new Error('x'), {status: 400, code: 'over_request_rate_limit'}), AUTH_COPY.tooMany);
  keep({status: 503, message: 'down'}, AUTH_COPY.ourSide);
  keep(Object.assign(new Error(''), {status: 500}), AUTH_COPY.ourSide);
  keep({}, AUTH_COPY.ourSide);
  keep(null, AUTH_COPY.ourSide);
  keep(new TypeError('Failed to fetch'), AUTH_COPY.offline);
  keep({status: 403, code: 'EMAIL_NOT_VERIFIED'}, AUTH_COPY.verifyFirst);
  keep(Object.assign(new Error('Email not confirmed'), {status: 403, code: 'email_not_confirmed'}), AUTH_COPY.verifyFirst);
  // An AuthProblem passes through untouched.
  const own = new AuthProblem('x', false);
  assert.equal(authProblem(own, 'sign-in'), own);
});

test('#3: sign-up keeps its own wording; never throws on any input', () => {
  assert.equal(authProblem({status: 422, code: 'USER_ALREADY_EXISTS'}, 'sign-up').message, AUTH_COPY.exists);
  assert.equal(authProblem({status: 400, message: 'Password too short'}, 'sign-up').message, 'Password too short');
  assert.notEqual(authProblem({status: 401, code: 'INVALID_EMAIL_OR_PASSWORD'}, 'sign-up').message, AUTH_COPY.wrongDetails);
  fc.assert(fc.property(fc.anything(), fc.constantFrom('sign-in', 'sign-up'), (e, mode) => {
    const p = authProblem(e, mode);
    return p instanceof AuthProblem && typeof p.message === 'string' && p.message.length > 0;
  }));
});

test('#3: the sign-in form wraps the SDK call so a thrown error is mapped too', () => {
  const src = read('app/auth/[path]/auth-form.tsx');
  assert.match(src, /catch \(thrown\) \{ throw authProblem\(thrown, mode\); \}/);
  assert.match(src, /if \(result\.error\) throw authProblem\(result\.error, mode\)/);
  assert.match(src, /error\.credentials && passwordRef\.current\) \{ passwordRef\.current\.value = ''/);
});

test('#7: /plans tells one story about the free beta, in visitor words', () => {
  const beta = P.defaultPlanNote(P.PLANS.beta);
  assert.ok(beta);
  assert.match(beta.title, /early beta/i);
  assert.match(beta.body, /100 active projects/);
  assert.match(beta.body, /Free plan below is what .* once the beta ends/);
  // When accounts without a subscription get a plan that has a card, there is nothing extra to say.
  assert.equal(P.defaultPlanNote(P.PLANS.free), null);
  for (const id of Object.keys(P.PLANS)) {
    const n = P.defaultPlanNote(P.PLANS[id]);
    if (n) assert.doesNotMatch(n.title + n.body, /server|operator|SCOPEFLOW_|env/i);
  }
  const page = read('app/plans/page.tsx') + read('app/plans/upgrade.tsx');
  assert.doesNotMatch(page, /this server’s default plan|server's default plan/);
  assert.doesNotMatch(page, /this server has no billing provider/);
});

test('#8/#26 + R3-03: plans heading keeps its space on phones; each card states its seat cap', () => {
  assert.match(read('app/plans/page.tsx'), /Start small\.\{' '\}<br\/>/);
  const cards = P.planCards('INR', n => '₹' + n);
  for (const c of cards) assert.equal(c.lines.filter(l => /\bseats?\b/i.test(l)).length, 1, c.id);
  assert.equal(cards.find(c => c.id === 'agency').seats, 5);
  assert.equal(cards.find(c => c.id === 'free').seats, 1);
});

test('#17: API-created projects take the requested zone, else the account zone, else none', () => {
  assert.equal(serverProjectZone(undefined, 'Asia/Calcutta'), 'Asia/Kolkata');
  assert.equal(serverProjectZone('Europe/London', 'Asia/Kolkata'), 'Europe/London');
  assert.equal(serverProjectZone('Mars/Base', 'Asia/Kolkata'), 'Asia/Kolkata');
  assert.equal(serverProjectZone(null, null), null);
  assert.equal(serverProjectZone('', undefined), null);
  fc.assert(fc.property(fc.anything(), fc.option(fc.string()), (r, a) => { const z = serverProjectZone(r, a); return z === null || validTimeZone(z); }));
  const route = read('app/api/scopes/route.ts');
  assert.match(route, /serverProjectZone\(requestedZone,own\?\.timezone\)/);
});

test('#17: the browser zone is adopted only when the account has none saved', () => {
  assert.equal(zoneToAdopt(null, 'Asia/Calcutta'), 'Asia/Kolkata');
  assert.equal(zoneToAdopt(undefined, 'Europe/Berlin'), 'Europe/Berlin');
  assert.equal(zoneToAdopt('UTC', 'Asia/Kolkata'), null);
  assert.equal(zoneToAdopt('Asia/Kolkata', 'Europe/Berlin'), null);
  assert.equal(zoneToAdopt(null, 'nonsense'), null);
  assert.equal(zoneToAdopt('bad', ''), null);
});

test('#34: legacy aliases show and save under their canonical names', () => {
  assert.equal(canonicalZone('Asia/Calcutta'), 'Asia/Kolkata');
  assert.equal(canonicalZone('Asia/Kolkata'), 'Asia/Kolkata');
  assert.equal(canonicalZone('Etc/UTC'), 'UTC');
  assert.equal(canonicalZone(null), null);
  fc.assert(fc.property(fc.constantFrom(...Intl.supportedValuesOf('timeZone')), z => validTimeZone(canonicalZone(z)) && canonicalZone(canonicalZone(z)) === canonicalZone(z)));
  assert.match(read('app/components/slots/timezone-select.tsx'), /const label = \(z: string\) => canonicalZone\(z\)/);
});

test('#10: the payments warning speaks to the freelancer, not the operator', async () => {
  const src = read('lib/payment-accounts.ts');
  assert.doesNotMatch(src, /warnings\.push\('The operator’s own payment keys/);
  assert.match(src, /Client payments go to your own payment account/);
});
