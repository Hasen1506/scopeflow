// WS-07 integration (auto-discovered by tests/run-local.mjs): the client page's server-rendered
// first paint is already in the reader's language, and the privacy notice carries the client data
// section the page links to. Localhost only.
// @covers SF-09 M32 LT-13
import assert from 'node:assert/strict';

const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'The suite cannot run against production.');
let checks = 0;
const page = async (path, headers = {}) => { const r = await fetch(base + path, {headers}); return {status: r.status, text: await r.text(), headers: r.headers}; };
const token = 'ef'.repeat(32);

// @covers SF-09
{
  const ta = await page(`/review/${token}?lang=ta`);
  assert.equal(ta.status, 200); checks++;
  assert.ok(ta.text.includes('உங்கள் வேலை வரம்பு ஏற்றப்படுகிறது'), 'Tamil loading text on first paint'); checks++;
  assert.ok(ta.text.includes('lang="ta"'), 'main carries lang=ta'); checks++;
  const hi = await page(`/review/${token}`, {'Accept-Language': 'hi-IN,hi;q=0.9,en;q=0.5'});
  assert.ok(hi.text.includes('आपका स्कोप लोड हो रहा है'), 'Accept-Language hi → Hindi first paint'); checks++;
  const en = await page(`/review/${token}`, {'Accept-Language': 'de-DE,fr;q=0.8'});
  assert.ok(en.text.includes('Loading your scope…'), 'unsupported languages fall back to English'); checks++;
  const query = await page(`/review/${token}?lang=hi`, {'Accept-Language': 'ta'});
  assert.ok(query.text.includes('आपका स्कोप लोड हो रहा है') && !query.text.includes('உங்கள் வேலை வரம்பு ஏற்றப்படுகிறது'), '?lang wins over Accept-Language'); checks++;
  assert.equal(en.headers.get('referrer-policy'), 'no-referrer', 'review links still never leak via Referer'); checks++;
}
// @covers LT-13
{
  const r = await page(`/review/${token}`);
  const main = r.text.slice(r.text.indexOf('<main'), r.text.indexOf('</main>'));
  assert.ok(main.length > 0); checks++;
  assert.doesNotMatch(main, /EARLY BETA/); checks++;
  assert.ok(!/<span class="beta">/.test(r.text), 'no beta badge in the client header'); checks++;
}
// @covers M32
{
  const r = await page('/privacy');
  assert.equal(r.status, 200); checks++;
  assert.ok(r.text.includes('id="client-data"') && r.text.includes('If you received a review link'), 'privacy notice has the client data section'); checks++;
}
console.log(`ws-07-client-page: ${checks} checks passed`);
