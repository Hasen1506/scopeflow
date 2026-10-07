// Optional language-model access for AI drafting (PR D) and the scope-creep radar (PR E).
//
// Off unless the operator sets OPENAI_API_KEY or ANTHROPIC_API_KEY (OpenAI wins when both are
// set; SCOPEFLOW_LLM_PROVIDER=openai|anthropic forces one). Models are configurable with
// SCOPEFLOW_OPENAI_MODEL / SCOPEFLOW_ANTHROPIC_MODEL. Every call asks for one JSON object,
// has a timeout, and never echoes the API key in an error. `fetchImpl` is injectable so tests
// never touch the network.

export type LlmProvider = 'openai' | 'anthropic';
export type LlmConfig = {provider: LlmProvider; apiKey: string; model: string};
type Env = Record<string, string | undefined>;

export const DEFAULT_MODELS: Record<LlmProvider, string> = {openai: 'gpt-4o-mini', anthropic: 'claude-haiku-4-5'};

export function llmConfig(env: Env = process.env): LlmConfig | null {
  const openai = env.OPENAI_API_KEY?.trim(), anthropic = env.ANTHROPIC_API_KEY?.trim();
  const forced = env.SCOPEFLOW_LLM_PROVIDER?.trim().toLowerCase();
  if (openai && forced !== 'anthropic') return {provider: 'openai', apiKey: openai, model: env.SCOPEFLOW_OPENAI_MODEL?.trim() || DEFAULT_MODELS.openai};
  if (anthropic && forced !== 'openai') return {provider: 'anthropic', apiKey: anthropic, model: env.SCOPEFLOW_ANTHROPIC_MODEL?.trim() || DEFAULT_MODELS.anthropic};
  if (openai) return {provider: 'openai', apiKey: openai, model: env.SCOPEFLOW_OPENAI_MODEL?.trim() || DEFAULT_MODELS.openai};
  return null;
}
/** Public status for the UI: never includes the key. */
export function llmStatus(env: Env = process.env) {
  const c = llmConfig(env);
  return c ? {enabled: true as const, provider: c.provider, model: c.model} : {enabled: false as const, provider: null, model: null, reason: 'No OPENAI_API_KEY or ANTHROPIC_API_KEY is set on this server.'};
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
export async function completeJson({system, user, maxTokens = 2000}: {system: string; user: string; maxTokens?: number}, {config = llmConfig(), fetchImpl = fetch, timeoutMs = 25000}: {config?: LlmConfig | null; fetchImpl?: typeof fetch; timeoutMs?: number} = {}): Promise<unknown> {
  if (!config) throw new LlmError('AI is not configured on this server.');
  const request: {url: string; headers: Record<string, string>; body: unknown} = config.provider === 'openai'
    ? {url: 'https://api.openai.com/v1/chat/completions', headers: {Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json'},
       body: {model: config.model, temperature: 0, max_tokens: maxTokens, response_format: {type: 'json_object'}, messages: [{role: 'system', content: system}, {role: 'user', content: user}]}}
    : {url: 'https://api.anthropic.com/v1/messages', headers: {'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'},
       body: {model: config.model, temperature: 0, max_tokens: maxTokens, system, messages: [{role: 'user', content: user}]}};
  let response: Response;
  try {
    response = await fetchImpl(request.url, {method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(timeoutMs)});
  } catch {
    throw new LlmError(`The ${config.provider === 'openai' ? 'OpenAI' : 'Anthropic'} API could not be reached.`);
  }
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !data) throw new LlmError(`The ${config.provider === 'openai' ? 'OpenAI' : 'Anthropic'} API refused the request (HTTP ${response.status}).`);
  const text = config.provider === 'openai'
    ? (data.choices as {message?: {content?: string}}[] | undefined)?.[0]?.message?.content
    : (data.content as {type?: string; text?: string}[] | undefined)?.find(part => part.type === 'text')?.text;
  if (typeof text !== 'string') throw new LlmError('The model returned no text.');
  return extractJson(text);
}
