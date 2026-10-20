// Gap-audit fixes: bounded request bodies (H1), scheduled jobs on GitHub Actions (H3), legal pages that match the
// code (H6/H7), the review page's h1 (L17), robots/sitemap (M10), plus the round-6 polish. Seeded, no network.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {fc} from '../support/property.mjs';

const B = await import('../../lib/body-limit.ts');
const errors = await import('../../lib/errors.ts');
const {securityTxt} = await import('../../lib/security-txt.ts');
const root = new URL('../../', import.meta.url).pathname;
const read = rel => readFileSync(join(root, rel), 'utf8');
function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const p = join(dir, name);
    if (statSync(join(root, p)).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
/** A request whose body arrives in chunks with no Content-Length (what a chunked upload looks like). */
function chunked(sizes) {
  let i = 0, pulled = 0;
  const stream = new ReadableStream({pull(c) { if (i < sizes.length) { pulled += sizes[i]; c.enqueue(new Uint8Array(sizes[i++]).fill(97)); } else c.close(); }});
  const request = new Request('https://x.test/', {method: 'POST', body: stream, duplex: 'half'});
  return {request, pulled: () => pulled};
}

// ---- H1 -----------------------------------------------------------------------------------------------------
test('H1: readBytes returns the whole body within the limit and refuses anything over it, chunked or declared', async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.integer({min: 1, max: 4000}), {minLength: 0, maxLength: 12}), fc.integer({min: 1, max: 30000}), async (sizes, limit) => {
    const total = sizes.reduce((a, b) => a + b, 0);
    const {request, pulled} = chunked(sizes);
    if (total <= limit) assert.equal((await B.readBytes(request, limit)).byteLength, total);
    else {
      await assert.rejects(B.readBytes(request, limit), e => e instanceof B.BodyTooLarge && e.limit === limit);
      // Reading stops at the first chunk past the limit: never more than limit + one chunk is pulled.
      assert.ok(pulled() <= limit + Math.max(...sizes), 'stops early');
    }
  }), {numRuns: 60});
  const declared = new Request('https://x.test/', {method: 'POST', body: 'x', headers: {'content-length': '999999'}});
  await assert.rejects(B.readBytes(declared, 100), B.BodyTooLarge);
  assert.equal((await B.readBytes(new Request('https://x.test/'), 10)).byteLength, 0);
  assert.equal(await B.readText(new Request('https://x.test/', {method: 'POST', body: 'héllo'}), 100), 'héllo');
  const form = new FormData(); form.set('text', 'hi');
  const fd = await B.readFormData(new Request('https://x.test/', {method: 'POST', body: form}), 10_000);
  assert.equal(fd.get('text'), 'hi');
});

test('H1: an over-limit body answers 413 through failure()', async () => {
  const r = errors.toResponse(new B.BodyTooLarge(10));
  assert.equal(r.status, 413);
  assert.equal((await r.json()).code, 'too_large');
});

test('H1: no route reads a raw body unbounded; proxy buffering is capped at 1 MB; eSign skips the proxy', () => {
  const files = [...walk('app'), ...walk('lib')].filter(f => !f.endsWith('body-limit.ts'));
  const hits = files.filter(f => /request\.(text|formData|arrayBuffer|json|blob)\(\)/.test(read(f)));
  assert.deepEqual(hits, []);
  assert.match(read('next.config.ts'), /proxyClientMaxBodySize:\s*"1mb"/);
  assert.match(read('proxy.ts'), /art\/\|api\/esign\/\)/);
  assert.match(read('app/api/esign/[provider]/callback/route.ts'), /readText\(request, BODY_LIMITS\.esign\)/);
  assert.equal(B.BODY_LIMITS.share, 1024 * 1024);
  // /api/share: the session is checked before the form is read.
  const share = read('app/api/share/route.ts');
  assert.ok(share.indexOf('await session(request)') < share.indexOf('readFormData('), 'session first');
});

// ---- H3 -----------------------------------------------------------------------------------------------------
test('H3: the scheduled-jobs workflow calls every HTTP job endpoint and no-ops without the secret', () => {
  const wf = read('.github/workflows/cron.yml');
  assert.match(wf, /schedule:\s*\n\s*- cron: "30 20 \* \* \*"/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /secrets\.SCOPEFLOW_CRON_SECRET/);
  assert.match(wf, /if \[ -z "\$\{CRON_SECRET:-\}" \]; then[\s\S]*?::notice[\s\S]*?exit 0/);
  for (const path of ['/api/notify/drain', '/api/payments/razorpay/reconcile', '/api/heads/$yesterday', '/api/analytics/export', '/api/readiness/housekeeping']) assert.ok(wf.includes(path), path);
  for (const route of ['app/api/notify/drain/route.ts', 'app/api/payments/razorpay/reconcile/route.ts', 'app/api/heads/[date]/route.ts', 'app/api/analytics/export/route.ts', 'app/api/readiness/housekeeping/route.ts']) {
    assert.ok(existsSync(join(root, route)), route);
    assert.match(read(route), /export async function POST/);
  }
  assert.match(wf, /https:\/\/scope-flow\.tech/);
  assert.match(wf, /permissions:\s*\n\s*contents: read/);
});

// ---- H6 / H7 ------------------------------------------------------------------------------------------------
test('H6/H7: one SUPPORT_EMAIL constant, a placeholder until set, and the legal pages in the footer', () => {
  const site = read('config/site.ts');
  assert.match(site, /export const SUPPORT_EMAIL: string = process\.env\.NEXT_PUBLIC_SUPPORT_EMAIL\?\.trim\(\) \|\| '';/);
  assert.match(site, /SUPPORT_EMAIL_PENDING = 'support email coming soon'/);
  const defining = [...walk('app'), ...walk('lib'), ...walk('config')].filter(f => /(?:const|let)\s+SUPPORT_EMAIL\s*[:=]/.test(read(f)));
  assert.deepEqual(defining, ['config/site.ts']);
  // No address is invented anywhere in the pages.
  for (const f of ['app/contact/page.tsx', 'app/about/page.tsx', 'app/refund/page.tsx', 'app/terms/page.tsx', 'app/privacy/page.tsx', 'app/support/page.tsx']) assert.doesNotMatch(read(f), /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, f);
  const footer = read('app/site-footer.tsx');
  for (const href of ['/about', '/contact', '/privacy', '/terms', '/refund']) assert.ok(footer.includes(`href="${href}"`), href);
  assert.equal(securityTxt('', 'https://x.test'), null);
  const txt = securityTxt('help@example.test', 'https://x.test', Date.UTC(2026, 9, 13));
  assert.match(txt, /^Contact: mailto:help@example\.test\nExpires: 2027-10-13T00:00:00\.000Z\n/);
  assert.match(txt, /Canonical: https:\/\/x\.test\/\.well-known\/security\.txt/);
});

test('H6: privacy and refund copy follow the code (closure keeps client records; analytics; WhatsApp; renewals)', () => {
  const privacy = read('app/privacy/page.tsx');
  assert.doesNotMatch(privacy, /Your Neon Auth login account remains active/);
  assert.match(privacy, /by default 8 years/);
  assert.match(read('lib/retention-sql.ts'), /TOMBSTONE_RETENTION_YEARS = 8/);
  assert.match(privacy, /PostHog’s EU service under a salted hash/);
  assert.match(privacy, /WhatsApp Business Platform/);
  assert.match(privacy, /<h2>Scopeflow subscriptions<\/h2>/);
  const refund = read('app/refund/page.tsx');
  assert.match(refund, /\{GRACE_DAYS\} days/);
  assert.match(refund, /renews automatically/);
  assert.match(read('lib/plans.ts'), /case 'cancelled': return now < t\(row\.period_end\)/, 'cancelled keeps the plan to the period end');
});

// ---- L17 / M10 / M4 / round 6 ------------------------------------------------------------------------------
test('L17: the review page has one h1, the scope title', () => {
  const doc = read('app/review/[token]/scope-document.tsx');
  assert.match(doc, /<h1 className="paper-title">\{scope\.title/);
  assert.match(read('app/globals.css'), /\.paper h2,\.paper h1\.paper-title\{/);
});

test('M10: robots disallows token pages and APIs; the sitemap lists only public pages', async () => {
  const site = await import('../../config/site.ts');
  for (const p of ['/api/', '/review/', '/cosign/', '/pay/', '/oauth/']) assert.ok(site.ROBOTS_DISALLOW.includes(p), p);
  for (const p of site.PUBLIC_PAGES) assert.ok(!site.ROBOTS_DISALLOW.some(d => p.startsWith(d)), p);
  assert.ok(existsSync(join(root, 'app/robots.ts')) && existsSync(join(root, 'app/sitemap.ts')));
});

test('M4: projectFor never finds a closed account’s project', () => {
  assert.match(read('lib/invoice-api.ts'), /FROM projects WHERE id=\? AND owner=\? AND owner_deleted IS NULL/);
});

test('R6: an overflowing number ("1e400", bad input) shows Max in the fee and price fields', async () => {
  const E = await import('../../lib/editor.ts');
  assert.match(E.amountProblem(Infinity, 'INR', 'The fee'), /^Max ₹1,00,00,000$/);
  assert.match(read('app/items-editor.tsx'), /badNumber\(e\.target\) \? Infinity : parse\(e\.target\.value\)/);
  assert.match(read('app/workspace/editor.tsx'), /field\('fee',badNumber\(e\.target\)\?Infinity:e\.target\.valueAsNumber\)/);
  assert.match(read('app/account/page.tsx'), /<label htmlFor="tax-id" className="label-for">/);
});

// ---- Review D1–D12 (fix/cron-ci-routes) ---------------------------------------------------------------------
test('D2/D8: scope reminders honour notify_client; the per-recipient cap is a rolling 24 hours', () => {
  const s = read('scripts/send-reminders.mjs');
  assert.match(s, /p\.client_email IS NOT NULL\$\{live\}\$\{noticesOn\}`\)/);
  assert.match(s, /const since = new Date\(Date\.now\(\) - 86400_000\)\.toISOString\(\)/);
});

test('D4/D5/D9/D10: write scope on POSTs, no anonymous head previews, ledger failures logged, project-zone today', () => {
  assert.match(read('app/api/scopes/route.ts'), /export async function POST[\s\S]*?ownerAuth\(request\)[\s\S]*?auth\.scopes\.includes\('scopes:write'\)[\s\S]*?allowWrite/);
  assert.match(read('app/api/scopes/[id]/route.ts'), /export async function POST[\s\S]*?ownerAuth\(request\);if\(!auth\)[^\n]*auth\.scopes\.includes\('scopes:write'\)/);
  const heads = read('app/api/heads/[date]/route.ts');
  assert.match(heads, /if \(!stored && !adminAuthorized\(request\)\) return json\([^\n]*404\)/);
  const acc = read('app/api/scopes/[id]/acceptance/route.ts');
  assert.doesNotMatch(acc, /\.catch\(\(\) => null\)/);
  assert.match(acc, /console\.error\('Scopeflow delivery_accepted ledger write failed'/);
  assert.match(acc, /timeZone: zoneOrUtc\(p\.row\.timezone\)/);
  assert.doesNotMatch(acc, /Date\.now\(\) \+ 86400_000/);
});
