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
export type LlmConfig = {provider: LlmProvider; apiKey: string; model: string; tier?: LlmTier};
type Env = Record<string, string | undefined>;

// Checked 2026-10-09 against the providers' model lists. Anthropic: claude-haiku-5-5 is the current
// Haiku (claude-haiku-4-5 is still served but is the previous generation), claude-sonnet-5-5 the current Sonnet.
export const DEFAULT_MODELS: Record<LlmProvider, string> = {openai: 'gpt-4o-mini', anthropic: 'claude-haiku-5-5'};
export const CAREFUL_MODELS: Record<LlmProvider, string> = {openai: 'gpt-4o', anthropic: 'claude-sonnet-5-5'};

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

function envModel(env: Env, provider: LlmProvider, tier: LlmTier) {
  const key = provider === 'openai' ? 'SCOPEFLOW_OPENAI_MODEL' : 'SCOPEFLOW_ANTHROPIC_MODEL';
  return tier === 'careful'
    ? env[key + '_CAREFUL']?.trim() || CAREFUL_MODELS[provider]
    : env[key]?.trim() || DEFAULT_MODELS[provider];
}
export function llmConfig(env: Env = process.env, tier: LlmTier = 'fast'): LlmConfig | null {
  const openai = env.OPENAI_API_KEY?.trim(), anthropic = env.ANTHROPIC_API_KEY?.trim();
  const forced = env.SCOPEFLOW_LLM_PROVIDER?.trim().toLowerCase();
  const pick = (provider: LlmProvider, apiKey: string): LlmConfig => ({provider, apiKey, model: envModel(env, provider, tier), ...(tier === 'careful' ? {tier} : {})});
  if (openai && forced !== 'anthropic') return pick('openai', openai);
  if (anthropic && forced !== 'openai') return pick('anthropic', anthropic);
  if (openai) return pick('openai', openai);
  return null;
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

/** One JSON-object completion. Throws LlmError with a safe message on any failure. */
export async function completeJson({system, user, maxTokens = 2000}: {system: string; user: string; maxTokens?: number}, {config = llmConfig(), fetchImpl = fetch, timeoutMs = 45000}: {config?: LlmConfig | null; fetchImpl?: typeof fetch; timeoutMs?: number} = {}): Promise<unknown> {
  if (!config) throw new LlmError('AI is not configured on this server.');
  const request: {url: string; headers: Record<string, string>; body: unknown} = config.provider === 'openai'
    ? {url: 'https://api.openai.com/v1/chat/completions', headers: {Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json'},
       body: {model: config.model, temperature: 0, max_tokens: maxTokens, response_format: {type: 'json_object'}, messages: [{role: 'system', content: system}, {role: 'user', content: user}]}}
    : {url: 'https://api.anthropic.com/v1/messages', headers: {'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'},
       body: anthropicBody(config, system, user, maxTokens)};
  let response: Response;
  try {
    response = await fetchImpl(request.url, {method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(timeoutMs)});
  } catch {
    throw new LlmError(`The ${config.provider === 'openai' ? 'OpenAI' : 'Anthropic'} API could not be reached.`);
  }
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !data) throw new LlmError(`The ${config.provider === 'openai' ? 'OpenAI' : 'Anthropic'} API refused the request (HTTP ${response.status}).`);
  if (data.stop_reason === 'refusal') throw new LlmError('The model declined this request.');
  const text = config.provider === 'openai'
    ? (data.choices as {message?: {content?: string}}[] | undefined)?.[0]?.message?.content
    : (data.content as {type?: string; text?: string}[] | undefined)?.find(part => part.type === 'text')?.text;
  if (typeof text !== 'string') throw new LlmError('The model returned no text.');
  return extractJson(text);
}
