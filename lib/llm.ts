// Optional language-model access for AI drafting (PR D) and the scope-creep radar (PR E).
//
// Off unless the operator sets OPENAI_API_KEY or ANTHROPIC_API_KEY (OpenAI wins when both are
// set; SCOPEFLOW_LLM_PROVIDER=openai|anthropic forces one). Models are configurable with
// SCOPEFLOW_OPENAI_MODEL / SCOPEFLOW_ANTHROPIC_MODEL. Every call asks for one JSON object,
// has a timeout, and never echoes the API key in an error. `fetchImpl` is injectable so tests
// never touch the network.

export type LlmProvider = 'openai' | 'anthropic';
/** fast: the cheap default for drafting and the radar. careful: a stronger model the owner can pick per request. */
export type LlmTier = 'fast' | 'careful';
export type LlmConfig = {provider: LlmProvider; apiKey: string; model: string; tier?: LlmTier; /** L11: tried in order when this model answers 404 or "deprecated". */ fallbacks?: LlmConfig[]};
type Env = Record<string, string | undefined>;

// Checked 2026-10-09 against the providers' model lists. Anthropic: claude-haiku-5-5 is the current
// Haiku (claude-haiku-4-5 is still served but is the previous generation), claude-sonnet-5-5 the current Sonnet.
export const DEFAULT_MODELS: Record<LlmProvider, string> = {openai: 'gpt-4o-mini', anthropic: 'claude-haiku-5-5'};
export const CAREFUL_MODELS: Record<LlmProvider, string> = {openai: 'gpt-4o', anthropic: 'claude-sonnet-5-5'};

// L11 (WS-06): model registry with ordered fallbacks per tier. SCOPEFLOW_MODELS overrides it, as
// "fast=openai:gpt-4o-mini,anthropic:claude-haiku-5-5;careful=openai:gpt-4o" or JSON
// {"fast": ["openai:gpt-4o-mini", ...], "careful": [...]}. Entries for a provider without an API
// key are skipped. The first usable entry is the primary; when a model answers 404 (retired or
// unknown) or a "deprecated" error, the next one is used and a readiness warning is recorded.
// Without SCOPEFLOW_MODELS the primary is SCOPEFLOW_OPENAI_MODEL / SCOPEFLOW_ANTHROPIC_MODEL (or the
// defaults above), followed by these same-provider fallbacks and then the other provider's chain.
// (The fallback ids follow the providers' published model lists as of the last check; the daily
// check-models job flags any that stop being served.)
export const FALLBACK_MODELS: Record<LlmTier, Record<LlmProvider, string[]>> = {
  fast: {openai: ['gpt-4.1-mini'], anthropic: ['claude-sonnet-5-5']},
  careful: {openai: ['gpt-4.1'], anthropic: ['claude-opus-4-7']},
};
type ModelRef = {provider: LlmProvider; model: string};
/** Parses SCOPEFLOW_MODELS; null when unset or unusable. */
export function parseModelRegistry(value: string | undefined | null): Partial<Record<LlmTier, ModelRef[]>> | null {
  const raw = value?.trim();
  if (!raw) return null;
  let pairs: [string, string[]][] = [];
  if (raw.startsWith('{')) {
    try { pairs = Object.entries(JSON.parse(raw) as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : String(v).split(',')]); } catch { return null; }
  } else pairs = raw.split(/[;\n]+/).map(part => { const i = part.indexOf('='); return [part.slice(0, i), part.slice(i + 1).split(/[,>\s]+/)] as [string, string[]]; });
  const out: Partial<Record<LlmTier, ModelRef[]>> = {};
  for (const [k, list] of pairs) {
    const tier = k.trim().toLowerCase() as LlmTier;
    if (tier !== 'fast' && tier !== 'careful') continue;
    const refs = list.map(x => x.trim()).filter(Boolean).map(x => { const [p, ...m] = x.split(':'); return {provider: p.trim().toLowerCase() as LlmProvider, model: m.join(':').trim()}; })
      .filter(r => (r.provider === 'openai' || r.provider === 'anthropic') && /^[A-Za-z0-9._:-]{2,80}$/.test(r.model));
    if (refs.length) out[tier] = refs;
  }
  return Object.keys(out).length ? out : null;
}

// Readiness warnings (L11): kept in memory and handed to a sink the server registers
// (lib/readiness-warnings.ts persists them for /api/readiness).
export type ModelWarning = {key: string; message: string; at: string};
const warnings = new Map<string, ModelWarning>();
let warningSink: ((w: ModelWarning) => void | Promise<void>) | null = null;
export function setModelWarningSink(sink: typeof warningSink) { warningSink = sink; }
export function modelWarnings(): ModelWarning[] { return [...warnings.values()]; }
export function recordModelWarning(key: string, message: string) {
  const w = {key, message, at: new Date().toISOString()};
  warnings.set(key, w);
  try { void Promise.resolve(warningSink?.(w)).catch(() => undefined); } catch { /* the warning is still kept in memory */ }
  return w;
}

/**
 * Known retirement dates (YYYY-MM-DD; "not sooner than" dates count as the date) for models an
 * operator might still configure. The status warns 30 days ahead so the env var can be changed in time.
 */
export const MODEL_RETIREMENTS: Record<string, string> = {
  'claude-3-5-haiku-20241022': '2026-02-19', 'claude-3-5-haiku-latest': '2026-02-19', 'claude-3-haiku-20240307': '2026-04-20',
  'claude-3-7-sonnet-20250219': '2026-02-19', 'claude-sonnet-4-20250514': '2026-05-14', 'claude-opus-4-20250514': '2026-05-14',
  'claude-haiku-4-5': '2026-10-15', 'claude-haiku-4-5-20251001': '2026-10-15',
  'gpt-3.5-turbo': '2025-09-01', 'gpt-4-32k': '2025-06-06',
};
/** null, or a warning when `model` is retired or retires within `days` days of `today`. */
export function retirementWarning(model: string, today = new Date().toISOString().slice(0, 10), days = 30): string | null {
  const date = MODEL_RETIREMENTS[model];
  if (!date) return null;
  if (date <= today) return `The configured model ${model} was retired on ${date}; AI requests will fail until the model setting is changed.`;
  const left = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  return left <= days ? `The configured model ${model} is scheduled to retire on ${date} (in ${left} day${left === 1 ? '' : 's'}). Change the model setting before then.` : null;
}

export type ModelCheck = {provider: LlmProvider; tier: LlmTier; model: string; status: 'available' | 'missing' | 'unreachable'; warning: string | null};
/**
 * Model-lifecycle guard (scripts/check-models.mjs, run daily): asks the provider's Models API whether
 * each configured model is still served (404 means it is gone or was never valid) and adds the known
 * retirement warning `days` ahead. Never throws; an unreachable API is reported as such.
 */
export async function checkModels(env: Env = process.env, {today = new Date().toISOString().slice(0, 10), days = 45, fetchImpl = fetch, chain = false}: {today?: string; days?: number; fetchImpl?: typeof fetch; chain?: boolean} = {}): Promise<ModelCheck[]> {
  const out: ModelCheck[] = [];
  // L11: with `chain`, every model in each tier's chain (primary and fallbacks), so a fallback that is gone too is caught early.
  for (const tier of ['fast', 'careful'] as LlmTier[]) for (const c of chain ? modelChain(env, tier) : modelChain(env, tier).slice(0, 1)) {
    if (out.some(o => o.model === c.model && o.provider === c.provider)) continue;
    const base = env.SCOPEFLOW_MODELS_API_URL?.trim().replace(/\/+$/, '') || (c.provider === 'openai' ? 'https://api.openai.com' : 'https://api.anthropic.com');
    let status: ModelCheck['status'] = 'unreachable';
    try {
      const r = await fetchImpl(`${base}/v1/models/${encodeURIComponent(c.model)}`, {headers: c.provider === 'openai' ? {Authorization: `Bearer ${c.apiKey}`} : {'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01'}, signal: AbortSignal.timeout(10000)});
      status = r.ok ? 'available' : r.status === 404 ? 'missing' : 'unreachable';
    } catch { status = 'unreachable'; }
    const warning = status === 'missing' ? `The configured ${tier} model ${c.model} is not served by ${c.provider} any more (Models API 404). Set ${c.provider === 'openai' ? 'SCOPEFLOW_OPENAI_MODEL' : 'SCOPEFLOW_ANTHROPIC_MODEL'}${tier === 'careful' ? '_CAREFUL' : ''} to a current model (or update SCOPEFLOW_MODELS).` : retirementWarning(c.model, today, days);
    out.push({provider: c.provider, tier, model: c.model, status, warning});
  }
  return out;
}

function envModel(env: Env, provider: LlmProvider, tier: LlmTier) {
  const key = provider === 'openai' ? 'SCOPEFLOW_OPENAI_MODEL' : 'SCOPEFLOW_ANTHROPIC_MODEL';
  return tier === 'careful'
    ? env[key + '_CAREFUL']?.trim() || CAREFUL_MODELS[provider]
    : env[key]?.trim() || DEFAULT_MODELS[provider];
}
/** The ordered model chain for a tier (providers without a key are skipped). */
export function modelChain(env: Env = process.env, tier: LlmTier = 'fast'): LlmConfig[] {
  const keys: Record<LlmProvider, string | undefined> = {openai: env.OPENAI_API_KEY?.trim() || undefined, anthropic: env.ANTHROPIC_API_KEY?.trim() || undefined};
  const forced = env.SCOPEFLOW_LLM_PROVIDER?.trim().toLowerCase();
  const registry = parseModelRegistry(env.SCOPEFLOW_MODELS)?.[tier];
  let refs: ModelRef[];
  if (registry) refs = registry;
  else {
    const order: LlmProvider[] = forced === 'anthropic' ? ['anthropic', 'openai'] : ['openai', 'anthropic'];
    refs = order.flatMap(p => [{provider: p, model: envModel(env, p, tier)}, ...FALLBACK_MODELS[tier][p].map(model => ({provider: p, model}))]);
  }
  const seen = new Set<string>();
  return refs.filter(r => keys[r.provider] && !seen.has(r.provider + ':' + r.model) && seen.add(r.provider + ':' + r.model))
    .map(r => ({provider: r.provider, apiKey: keys[r.provider]!, model: r.model, ...(tier === 'careful' ? {tier} : {})}));
}
export function llmConfig(env: Env = process.env, tier: LlmTier = 'fast'): LlmConfig | null {
  const [primary, ...fallbacks] = modelChain(env, tier);
  return primary ? {...primary, ...(fallbacks.length ? {fallbacks} : {})} : null;
}
/** Public status for the UI: never includes the key. Lists both tiers' models and any retirement warning. */
export function llmStatus(env: Env = process.env, today?: string) {
  const c = llmConfig(env), careful = llmConfig(env, 'careful');
  if (!c || !careful) return {enabled: false as const, provider: null, model: null, careful_model: null, warning: null, reason: 'No OPENAI_API_KEY or ANTHROPIC_API_KEY is set on this server.'};
  const warning = retirementWarning(c.model, today) ?? retirementWarning(careful.model, today);
  return {enabled: true as const, provider: c.provider, model: c.model, careful_model: careful.model, warning};
}

// Current Claude models (the 5 family, Opus 4.7/4.8) reject a non-default temperature and take an
// effort level instead; thinking counts toward max_tokens there, so the cap is raised for them.
const MODERN_CLAUDE = /^claude-(?:(?:opus|sonnet|haiku|fable|mythos)-5|opus-4-[78])/;
export function anthropicBody(config: LlmConfig, system: string, user: string, maxTokens: number) {
  return MODERN_CLAUDE.test(config.model)
    ? {model: config.model, max_tokens: Math.max(maxTokens, 8000), output_config: {effort: config.tier === 'careful' ? 'medium' : 'low'}, system, messages: [{role: 'user', content: user}]}
    : {model: config.model, temperature: 0, max_tokens: maxTokens, system, messages: [{role: 'user', content: user}]};
}

export class LlmError extends Error {}

/** The first complete top-level JSON object in `text` (models sometimes wrap it in prose or fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new LlmError('The model did not return JSON.');
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { throw new LlmError('The model returned malformed JSON.'); }
    }
  }
  throw new LlmError('The model returned incomplete JSON.');
}

/** A model the provider no longer serves: 404, or a 400/410 whose error names the model as gone. */
export class ModelGone extends LlmError {}
const GONE = /model[_ ]not[_ ]found|not_found_error|does not exist|deprecat|decommission|retired|no longer (?:available|supported)/i;

/**
 * One JSON-object completion with the model registry's fallbacks (L11): a model that is gone is
 * replaced by the next one in the chain, and a readiness warning names it. Throws LlmError with a
 * safe message on any other failure.
 */
export async function completeJson(prompt: {system: string; user: string; maxTokens?: number}, options: {config?: LlmConfig | null; fetchImpl?: typeof fetch; timeoutMs?: number} = {}): Promise<unknown> {
  const config = options.config === undefined ? llmConfig() : options.config;
  if (!config) throw new LlmError('AI is not configured on this server.');
  const chain = [config, ...(config.fallbacks ?? [])];
  for (let i = 0; i < chain.length; i++) {
    try { return await completeOnce(prompt, {...options, config: chain[i]}); }
    catch (e) {
      if (!(e instanceof ModelGone) || i === chain.length - 1) throw e instanceof ModelGone ? new LlmError(e.message) : e;
      recordModelWarning(`model:${chain[i].provider}:${chain[i].model}`, `The ${chain[i].tier ?? 'fast'} model ${chain[i].model} (${chain[i].provider}) is not served any more; ScopeFlow fell back to ${chain[i + 1].model} (${chain[i + 1].provider}). Update SCOPEFLOW_MODELS.`);
    }
  }
  throw new LlmError('AI is not configured on this server.');
}

async function completeOnce({system, user, maxTokens = 2000}: {system: string; user: string; maxTokens?: number}, {config = llmConfig(), fetchImpl = fetch, timeoutMs = 45000}: {config?: LlmConfig | null; fetchImpl?: typeof fetch; timeoutMs?: number} = {}): Promise<unknown> {
  if (!config) throw new LlmError('AI is not configured on this server.');
  const request: {url: string; headers: Record<string, string>; body: unknown} = config.provider === 'openai'
    ? {url: (process.env.SCOPEFLOW_OPENAI_URL?.trim().replace(/\/+$/, '') || 'https://api.openai.com') + '/v1/chat/completions', headers: {Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json'},
       body: {model: config.model, temperature: 0, max_tokens: maxTokens, response_format: {type: 'json_object'}, messages: [{role: 'system', content: system}, {role: 'user', content: user}]}}
    : {url: (process.env.SCOPEFLOW_ANTHROPIC_URL?.trim().replace(/\/+$/, '') || 'https://api.anthropic.com') + '/v1/messages', headers: {'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'},
       body: anthropicBody(config, system, user, maxTokens)};
  let response: Response;
  try {
    response = await fetchImpl(request.url, {method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(timeoutMs)});
  } catch {
    throw new LlmError(`The ${config.provider === 'openai' ? 'OpenAI' : 'Anthropic'} API could not be reached.`);
  }
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (response.status === 404 || ((response.status === 400 || response.status === 410) && GONE.test(JSON.stringify(data ?? {}).slice(0, 2000)))) throw new ModelGone(`The configured model ${config.model} is not available (HTTP ${response.status}).`);
  if (!response.ok || !data) throw new LlmError(`The ${config.provider === 'openai' ? 'OpenAI' : 'Anthropic'} API refused the request (HTTP ${response.status}).`);
  if (data.stop_reason === 'refusal') throw new LlmError('The model declined this request.');
  const text = config.provider === 'openai'
    ? (data.choices as {message?: {content?: string}}[] | undefined)?.[0]?.message?.content
    : (data.content as {type?: string; text?: string}[] | undefined)?.find(part => part.type === 'text')?.text;
  if (typeof text !== 'string') throw new LlmError('The model returned no text.');
  return extractJson(text);
}
