// WS-06: AI drafting and the model registry. Pure (no server, no network; providers are stubbed):
// the draft currency precedence (M11) and model fallbacks with a readiness warning (L11).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, freezeClock} from '../support/property.mjs';

freezeClock();
const llm = await import('../../lib/llm.ts');
const draft = await import('../../lib/draft.ts');

const output = {title: 'Clinic website', client: 'Smile Dental', items: [{title: 'Page designs', qty: 5, unit: 'pages', price: null, acceptance: 'Approved in Figma'}], client_inputs: [], exclusions: 'Hosting', fee: 150000, currency: 'INR', revisions: 2, due: '', notes: ''};
const openaiOk = body => new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(body)}}]}), {status: 200});

// @covers M11
test('M11: request > owner default > mode default; an explicit request is final', async () => {
  assert.deepEqual(draft.resolveDraftCurrency({request: 'USD', owner: 'INR', mode: 'INR'}), {currency: 'USD', forced: true, source: 'request'});
  assert.deepEqual(draft.resolveDraftCurrency({request: undefined, owner: 'INR', mode: 'USD'}), {currency: 'INR', forced: false, source: 'owner_default'});
  assert.deepEqual(draft.resolveDraftCurrency({request: null, owner: null, mode: 'INR'}), {currency: 'INR', forced: false, source: 'mode_default'});
  assert.equal(draft.resolveDraftCurrency({request: 'DOGE', owner: 'XXX', mode: null}).currency, 'USD');
  assert.equal(draft.modeDefaultCurrency('consumer'), 'INR');
  assert.equal(draft.modeDefaultCurrency('freelancer'), 'USD');
  fc.assert(fc.property(fc.constantFrom('USD', 'INR', 'EUR', 'GBP', undefined), fc.constantFrom('USD', 'INR', 'EUR', null), fc.constantFrom('USD', 'INR'), (request, owner, mode) => {
    const r = draft.resolveDraftCurrency({request, owner, mode});
    assert.equal(r.currency, request ?? owner ?? mode);
  }));
  // Owner default INR, request USD: the model answers INR (the brief says rupees) but the draft is USD.
  const c = draft.resolveDraftCurrency({request: 'USD', owner: 'INR', mode: 'INR'});
  const r = await draft.draftFromBrief('A five page website for a dental clinic, budget 1.5 lakh rupees', c.currency, {config: {provider: 'openai', apiKey: 'k', model: 'm'}, fetchImpl: async () => openaiOk(output), defaults: {currency: 'INR'}, forceCurrency: c.forced});
  assert.equal(r.draft.currency, 'USD');
  // Without a request, a currency stated in the brief still wins over the owner's default (unchanged).
  const r2 = await draft.draftFromBrief('A five page website for a dental clinic, budget 1.5 lakh rupees', 'USD', {config: {provider: 'openai', apiKey: 'k', model: 'm'}, fetchImpl: async () => openaiOk(output)});
  assert.equal(r2.draft.currency, 'INR');
});

// @covers L11
test('L11: a model that answers 404 falls back to the next in the registry and records a readiness warning', async () => {
  const seen = [];
  const sink = [];
  llm.setModelWarningSink(w => { sink.push(w); });
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body.model);
    if (body.model === 'gone-model') return new Response(JSON.stringify({error: {message: 'The model `gone-model` does not exist', code: 'model_not_found'}}), {status: 404});
    return openaiOk({ok: true});
  };
  const config = {provider: 'openai', apiKey: 'k', model: 'gone-model', fallbacks: [{provider: 'openai', apiKey: 'k', model: 'backup-model'}]};
  assert.deepEqual(await llm.completeJson({system: 's', user: 'u'}, {config, fetchImpl}), {ok: true});
  assert.deepEqual(seen, ['gone-model', 'backup-model']);
  assert.equal(sink.length, 1);
  assert.match(sink[0].message, /gone-model .*not served any more.*fell back to backup-model/);
  assert.ok(llm.modelWarnings().some(w => w.key === 'model:openai:gone-model'));
  // A 400 that names the model as deprecated also falls back; other refusals do not.
  seen.length = 0;
  const deprecated = async (url, init) => { const b = JSON.parse(init.body); seen.push(b.model); return b.model === 'old' ? new Response(JSON.stringify({error: {message: 'This model has been deprecated'}}), {status: 400}) : openaiOk({ok: 2}); };
  assert.deepEqual(await llm.completeJson({system: 's', user: 'u'}, {config: {provider: 'openai', apiKey: 'k', model: 'old', fallbacks: [{provider: 'openai', apiKey: 'k', model: 'new'}]}, fetchImpl: deprecated}), {ok: 2});
  assert.deepEqual(seen, ['old', 'new']);
  seen.length = 0;
  const refused = async (url, init) => { seen.push(JSON.parse(init.body).model); return new Response('{}', {status: 401}); };
  await assert.rejects(llm.completeJson({system: 's', user: 'u'}, {config: {provider: 'openai', apiKey: 'k', model: 'a', fallbacks: [{provider: 'openai', apiKey: 'k', model: 'b'}]}, fetchImpl: refused}), /refused the request \(HTTP 401\)/);
  assert.deepEqual(seen, ['a'], 'an auth refusal is not a retired model');
  // Every model gone: a safe error, no key echoed.
  await assert.rejects(llm.completeJson({system: 's', user: 'u'}, {config: {provider: 'openai', apiKey: 'sk-secret', model: 'a', fallbacks: [{provider: 'openai', apiKey: 'sk-secret', model: 'b'}]}, fetchImpl: async () => new Response('{}', {status: 404})}), e => !String(e.message).includes('sk-secret'));
  llm.setModelWarningSink(null);
});

// @covers L11
test('L11: the registry comes from SCOPEFLOW_MODELS or the env models plus ordered fallbacks', () => {
  assert.deepEqual(llm.parseModelRegistry('fast=openai:gpt-a,anthropic:claude-b;careful=openai:gpt-c'), {fast: [{provider: 'openai', model: 'gpt-a'}, {provider: 'anthropic', model: 'claude-b'}], careful: [{provider: 'openai', model: 'gpt-c'}]});
  assert.deepEqual(llm.parseModelRegistry('{"fast": ["anthropic:claude-x"]}'), {fast: [{provider: 'anthropic', model: 'claude-x'}]});
  assert.equal(llm.parseModelRegistry('nonsense'), null);
  const env = {OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a', SCOPEFLOW_MODELS: 'fast=openai:gpt-a,anthropic:claude-b,bogus:x'};
  assert.deepEqual(llm.modelChain(env).map(c => `${c.provider}:${c.model}`), ['openai:gpt-a', 'anthropic:claude-b']);
  assert.deepEqual(llm.modelChain({ANTHROPIC_API_KEY: 'a', SCOPEFLOW_MODELS: 'fast=openai:gpt-a,anthropic:claude-b'}).map(c => c.model), ['claude-b'], 'providers without a key are skipped');
  const chain = llm.modelChain({OPENAI_API_KEY: 'o'});
  assert.deepEqual(chain.map(c => c.model), [llm.DEFAULT_MODELS.openai, ...llm.FALLBACK_MODELS.fast.openai]);
  assert.equal(llm.llmConfig({OPENAI_API_KEY: 'o'}).fallbacks.length, llm.FALLBACK_MODELS.fast.openai.length);
  assert.equal(llm.llmConfig({}), null);
});
