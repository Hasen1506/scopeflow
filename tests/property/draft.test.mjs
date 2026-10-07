// PR D: templates library and AI drafting. Pure (no server, no network): provider selection,
// JSON extraction, request shapes for OpenAI and Anthropic through a stubbed fetch, safe
// errors, normalisation of model output into valid scope content, and the starter templates.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const llm = await import('../../lib/llm.ts');
const {normalizeDraft, draftFromBrief, draftPrompt} = await import('../../lib/draft.ts');
const {templates} = await import('../../lib/templates.ts');
const {scopeSchema} = await import('../../lib/scope.ts');
const {templateContent, builtinTemplates} = await import('../../lib/template-store.ts');

test('provider selection: off without keys, OpenAI preferred, override and models from env', () => {
  assert.equal(llm.llmConfig({}), null);
  assert.deepEqual(llm.llmStatus({}), {enabled: false, provider: null, model: null, reason: 'No OPENAI_API_KEY or ANTHROPIC_API_KEY is set on this server.'});
  assert.deepEqual(llm.llmConfig({ANTHROPIC_API_KEY: 'sk-ant'}), {provider: 'anthropic', apiKey: 'sk-ant', model: llm.DEFAULT_MODELS.anthropic});
  assert.equal(llm.llmConfig({OPENAI_API_KEY: 'sk-o', ANTHROPIC_API_KEY: 'sk-a'}).provider, 'openai');
  assert.equal(llm.llmConfig({OPENAI_API_KEY: 'sk-o', ANTHROPIC_API_KEY: 'sk-a', SCOPEFLOW_LLM_PROVIDER: 'anthropic'}).provider, 'anthropic');
  assert.equal(llm.llmConfig({OPENAI_API_KEY: 'sk-o', SCOPEFLOW_OPENAI_MODEL: 'gpt-x'}).model, 'gpt-x');
  assert.ok(!JSON.stringify(llm.llmStatus({OPENAI_API_KEY: 'sk-secret'})).includes('sk-secret'));
});

// Retired ids (Anthropic: claude-3-5-haiku-20241022 retired 2026-02-19, claude-3-haiku-20240307 retired
// 2026-04-20; https://docs.anthropic.com/en/docs/about-claude/model-deprecations). Requests to these fail.
const RETIRED_MODELS = ['claude-3-5-haiku-latest', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307', 'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-latest', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'gpt-3.5-turbo', 'gpt-4-32k'];
test('default models are current (checked 2026-10-07), never a retired id', () => {
  assert.deepEqual(llm.DEFAULT_MODELS, {openai: 'gpt-4o-mini', anthropic: 'claude-haiku-4-5'});
  for (const m of Object.values(llm.DEFAULT_MODELS)) assert.ok(!RETIRED_MODELS.includes(m), m);
  assert.equal(llm.llmConfig({ANTHROPIC_API_KEY: 'sk-ant'}).model, 'claude-haiku-4-5');
});

test('extractJson finds the object inside prose and code fences, and rejects junk', () => {
  assert.deepEqual(llm.extractJson('Here you go:\n```json\n{"a": {"b": "}"}}\n```'), {a: {b: '}'}});
  assert.deepEqual(llm.extractJson('{"q":"say \\"hi\\" {"}'), {q: 'say "hi" {'});
  for (const bad of ['no json', '{"a": 1', '{bad json}']) assert.throws(() => llm.extractJson(bad), llm.LlmError);
});

const sampleOutput = {title: 'Clinic website', client: 'Smile Dental', items: [{title: 'Page designs', qty: 5, unit: 'pages', price: null, acceptance: 'Approved in Figma'}, {title: 'x'}, {title: 'Booking form', qty: 0.4, unit: '', price: -3}], client_inputs: [{title: 'Clinic photos', due: 'soon'}], exclusions: 'Hosting, SEO', fee: 150000, currency: 'INR', revisions: 99, due: '2026-12-01', notes: 'One round = one consolidated list.'};

test('model output is coerced into valid scope content with server-assigned ids', () => {
  const d = normalizeDraft(sampleOutput, 'USD');
  assert.equal(scopeSchema.safeParse(d).success, true);
  assert.deepEqual(d.items.map(i => [i.id, i.title, i.qty, i.price]), [['ai_1', 'Page designs', 5, null], ['ai_3', 'Booking form', 1, null]]);
  assert.equal(d.revisions, 50); assert.equal(d.currency, 'INR'); assert.equal(d.client_inputs[0].due, '');
  assert.equal(normalizeDraft({...sampleOutput, currency: 'DOGE'}, 'GBP').currency, 'GBP');
  assert.throws(() => normalizeDraft({title: 'Nothing'}, 'USD'), /did not match the scope format/);
  fc.assert(fc.property(fc.anything(), raw => { try { assert.equal(scopeSchema.safeParse(normalizeDraft(raw, 'USD')).success, true); } catch (e) { assert.match(String(e.message), /did not match/); } }), {numRuns: 300});
});

function stub(responseBody, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({url, init, body: JSON.parse(init.body)}); return new Response(JSON.stringify(responseBody), {status}); };
  return {calls, fetchImpl};
}

test('OpenAI request: JSON mode, system + user messages, bearer key; draft is linted', async () => {
  const s = stub({choices: [{message: {content: JSON.stringify(sampleOutput)}}]});
  const r = await draftFromBrief('A five page website for a dental clinic in Chennai', 'INR', {config: {provider: 'openai', apiKey: 'sk-test', model: 'm1'}, fetchImpl: s.fetchImpl, today: '2026-10-07'});
  assert.equal(s.calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(s.calls[0].init.headers.Authorization, 'Bearer sk-test');
  assert.deepEqual(s.calls[0].body.response_format, {type: 'json_object'});
  assert.equal(s.calls[0].body.model, 'm1');
  assert.deepEqual(s.calls[0].body.messages.map(m => m.role), ['system', 'user']);
  assert.ok(s.calls[0].body.messages[1].content.includes('dental clinic'));
  assert.equal(r.draft.title, 'Clinic website');
  assert.ok(typeof r.lint.score === 'number');
});

test('Anthropic request: messages API with x-api-key and version header', async () => {
  const s = stub({content: [{type: 'text', text: 'Sure! ' + JSON.stringify(sampleOutput)}]});
  const r = await draftFromBrief('A five page website for a dental clinic in Chennai', 'INR', {config: {provider: 'anthropic', apiKey: 'sk-ant-test', model: 'c1'}, fetchImpl: s.fetchImpl});
  assert.equal(s.calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(s.calls[0].init.headers['x-api-key'], 'sk-ant-test');
  assert.equal(s.calls[0].init.headers['anthropic-version'], '2023-06-01');
  assert.equal(typeof s.calls[0].body.system, 'string');
  assert.equal(r.draft.client, 'Smile Dental');
});

test('provider failures become safe LlmErrors that never echo the key', async () => {
  const config = {provider: 'openai', apiKey: 'sk-very-secret', model: 'm'};
  for (const fetchImpl of [stub({error: {message: 'bad key sk-very-secret'}}, 401).fetchImpl, async () => { throw new Error('ECONNRESET sk-very-secret'); }, stub({choices: []}).fetchImpl, stub({choices: [{message: {content: 'not json'}}]}).fetchImpl]) {
    await assert.rejects(llm.completeJson({system: 's', user: 'u'}, {config, fetchImpl}), e => e instanceof llm.LlmError && !e.message.includes('sk-very-secret'));
  }
  await assert.rejects(llm.completeJson({system: 's', user: 'u'}, {config: null}), /not configured/);
});

test('prompt carries the brief, the allowed currencies and the no-vague-words rule', () => {
  const p = draftPrompt('Logo for a bakery'.padEnd(30, '.'), 'INR');
  assert.ok(p.user.includes('Logo for a bakery'));
  assert.match(p.system, /Allowed currencies: .*INR/);
  assert.match(p.system, /Never use vague words/);
  assert.ok(draftPrompt('x'.repeat(10000), 'USD').user.length < 4100);
});

test('starter templates: several, unique ids, all valid scope content', () => {
  assert.ok(templates.length >= 8);
  assert.equal(new Set(templates.map(t => t.id)).size, templates.length);
  for (const t of templates) assert.deepEqual(templateContent(t.content), {content: t.content}, t.id);
  assert.equal(templateContent({...templates[0].content, client: 'Acme Co'}).content.client, 'Acme Co');
  assert.ok(builtinTemplates().every(t => t.builtin && t.id.startsWith('builtin:')));
  assert.ok('error' in templateContent({title: 'x'}));
  assert.ok('content' in templateContent(templates[0].content));
});
