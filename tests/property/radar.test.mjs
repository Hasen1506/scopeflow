// PR E: scope-creep radar. Pure (no server, no network): numbered clauses, keyword verdicts
// with clause citations, and LLM adjudication through a stubbed fetch that must cite clauses
// that exist (otherwise the keyword verdict stands).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const {scopeSchema} = await import('../../lib/scope.ts');
const {computeAgreement} = await import('../../lib/ledger.ts');
const {clausesOf, keywordRadar, scopeRadar, parseAdjudication, radarPrompt} = await import('../../lib/radar.ts');
const llmLib = await import('../../lib/llm.ts');

// Retired ids (Anthropic: claude-3-5-haiku-20241022 retired 2026-02-19, claude-3-haiku-20240307 retired
// 2026-04-20; https://docs.anthropic.com/en/docs/about-claude/model-deprecations). Requests to these fail.
const RETIRED_MODELS = ['claude-3-5-haiku-latest', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307', 'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-latest', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'gpt-3.5-turbo', 'gpt-4-32k'];
test('default models are current (checked 2026-10-07), never a retired id', () => {
  assert.deepEqual(llmLib.DEFAULT_MODELS, {openai: 'gpt-4o-mini', anthropic: 'claude-haiku-4-5'});
  for (const m of Object.values(llmLib.DEFAULT_MODELS)) assert.ok(!RETIRED_MODELS.includes(m), m);
  assert.equal(llmLib.llmConfig({ANTHROPIC_API_KEY: 'sk-ant'}).model, 'claude-haiku-4-5');
});

const scope = scopeSchema.parse({title: 'Website build', client: 'Acme', deliverables: '', items: [
  {id: 'i_design', title: 'Responsive page designs', qty: 5, unit: 'pages', acceptance: 'Approved in Figma'},
  {id: 'i_logo', title: 'Logo refresh', qty: 1, unit: '', acceptance: ''},
], client_inputs: [], exclusions: 'Hosting, SEO and printed business cards', fee: 1000, currency: 'USD', revisions: 2, due: '', notes: 'One round is one consolidated feedback list. Extra work needs a change order.'});
const agreement = computeAgreement(scope, 1, []);
const config = {provider: 'openai', apiKey: 'sk-test', model: 'm'};
const llm = content => async () => new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(content)}}]}), {status: 200});

test('clauses are numbered by kind and carry the agreement text', () => {
  const c = clausesOf(scope, agreement);
  assert.deepEqual(c.map(x => x.id), ['D1', 'D2', 'X1', 'X2', 'X3', 'T1', 'T2', 'R1']);
  assert.equal(c[0].text, 'Responsive page designs × 5 pages (done when: Approved in Figma)');
  assert.equal(c.find(x => x.id === 'X3').text, 'printed business cards');
  assert.equal(c.at(-1).text, '2 revision rounds included; 0 used.');
});

test('keyword radar: an excluded request is not covered and cites the exclusion clause', () => {
  const r = keywordRadar('Could you also print the business cards for the launch?', scope, agreement);
  assert.equal(r.engine, 'keyword'); assert.equal(r.verdict, 'out_of_scope'); assert.equal(r.covered, 'no');
  assert.deepEqual(r.citations.map(c => c.id), ['X3']);
  assert.ok(r.change_order && r.change_order.add_items.length === 1);
});

test('keyword radar: more than the agreed quantity is creep and cites the deliverable', () => {
  const r = keywordRadar('Can we get 8 page designs instead of five?', scope, agreement);
  assert.equal(r.verdict, 'out_of_scope');
  assert.deepEqual(r.citations.map(c => c.id), ['D1']);
  assert.equal(r.change_order.add_items[0].qty, 3);
});

test('keyword radar: feedback is a revision and cites the deliverable and the round allowance', () => {
  const r = keywordRadar('Please make the logo a bit darker', scope, agreement);
  assert.equal(r.verdict, 'revision'); assert.equal(r.covered, 'revision');
  assert.deepEqual(r.citations.map(c => c.id), ['D2', 'R1']);
});

test('every keyword citation is a real clause, for any request', () => {
  const ids = new Set(clausesOf(scope, agreement).map(c => c.id));
  fc.assert(fc.property(fc.string({maxLength: 200}), msg => { for (const c of keywordRadar(msg, scope, agreement).citations) assert.ok(ids.has(c.id)); }), {numRuns: 300});
});

test('LLM adjudication: valid citations win, with the clause text attached', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return llm({verdict: 'out_of_scope', citations: ['x1'], reason: 'Hosting is excluded (X1).', reply: 'Happy to quote hosting separately.'})(); };
  const r = await scopeRadar('Can you host the site for us?', scope, agreement, {config, fetchImpl});
  assert.equal(r.engine, 'llm'); assert.equal(r.verdict, 'out_of_scope');
  assert.deepEqual(r.citations.map(c => [c.id, c.text]), [['X1', 'Hosting']]);
  assert.equal(r.reply, 'Happy to quote hosting separately.');
  assert.ok(r.change_order, 'one-click change order draft');
  assert.match(sent.messages[1].content, /X1 \[exclusion\] Hosting/);
});

test('LLM answers citing unknown clauses, or failing, fall back to the keyword verdict', async () => {
  const bad = await scopeRadar('Could you also print the business cards?', scope, agreement, {config, fetchImpl: llm({verdict: 'in_scope', citations: ['D9'], reason: 'x'})});
  assert.equal(bad.engine, 'keyword'); assert.equal(bad.verdict, 'out_of_scope'); assert.match(bad.note, /discarded/);
  const down = await scopeRadar('Could you also print the business cards?', scope, agreement, {config, fetchImpl: async () => { throw new Error('offline'); }});
  assert.equal(down.engine, 'keyword'); assert.match(down.note, /unavailable/);
  const off = await scopeRadar('Could you also print the business cards?', scope, agreement, {config: null});
  assert.equal(off.engine, 'keyword'); assert.equal(off.note, null);
});

test('adjudication parsing: verdict enum, citations required except when ambiguous', () => {
  const clauses = clausesOf(scope, agreement);
  assert.equal(parseAdjudication({verdict: 'maybe', citations: ['D1']}, clauses), null);
  assert.equal(parseAdjudication({verdict: 'in_scope', citations: []}, clauses), null);
  assert.deepEqual(parseAdjudication({verdict: 'ambiguous', citations: []}, clauses), {verdict: 'ambiguous', citations: [], reason: '', reply: ''});
  assert.deepEqual(parseAdjudication({verdict: 'revision', citations: ['d2', 'R1', 'D2']}, clauses).citations, ['D2', 'R1']);
  assert.equal(parseAdjudication(null, clauses), null);
  assert.match(radarPrompt('hi', clauses).system, /Never invent clauses/);
});
