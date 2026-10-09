import {createHash} from 'node:crypto';

// Optional semantic matching for the radar: embeds the client's request and each clause of the
// agreement and ranks clauses by cosine similarity, so a request phrased differently from the
// clause (or written in Hindi or Tamil against an English scope) still finds the clause it is about.
// Off unless SCOPEFLOW_EMBEDDINGS names a provider whose key is set:
//   openai  OPENAI_API_KEY   model SCOPEFLOW_EMBEDDING_MODEL or text-embedding-3-small (multilingual)
//   voyage  VOYAGE_API_KEY   model SCOPEFLOW_EMBEDDING_MODEL or voyage-3.5 (multilingual)
// SCOPEFLOW_EMBEDDINGS_URL replaces the endpoint (the suites use a local stub). The request text and
// clauses go to that provider, like the AI radar; nothing is stored there by Scopeflow.

type Env = Record<string, string | undefined>;
export type EmbeddingConfig = {provider: 'openai' | 'voyage'; apiKey: string; model: string; url: string};
const DEFAULTS = {openai: {model: 'text-embedding-3-small', url: 'https://api.openai.com/v1/embeddings', key: 'OPENAI_API_KEY'}, voyage: {model: 'voyage-3.5', url: 'https://api.voyageai.com/v1/embeddings', key: 'VOYAGE_API_KEY'}} as const;

export function embeddingConfig(env: Env = process.env): EmbeddingConfig | null {
  const provider = env.SCOPEFLOW_EMBEDDINGS?.trim().toLowerCase();
  if (provider !== 'openai' && provider !== 'voyage') return null;
  const d = DEFAULTS[provider], apiKey = env[d.key]?.trim();
  if (!apiKey) return null;
  return {provider, apiKey, model: env.SCOPEFLOW_EMBEDDING_MODEL?.trim() || d.model, url: env.SCOPEFLOW_EMBEDDINGS_URL?.trim() || d.url};
}

export class EmbeddingError extends Error {}
const cache = new Map<string, number[]>();
const cacheKey = (c: EmbeddingConfig, text: string) => c.provider + ':' + c.model + ':' + createHash('sha256').update(text).digest('base64url');

/** One vector per text, in order. Clause vectors are cached in memory (bounded). */
export async function embed(texts: string[], config: EmbeddingConfig, fetchImpl: typeof fetch = fetch): Promise<number[][]> {
  const missing = [...new Set(texts.filter(t => !cache.has(cacheKey(config, t))))];
  if (missing.length) {
    let response: Response;
    try {
      response = await fetchImpl(config.url, {method: 'POST', headers: {Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({model: config.model, input: missing.map(t => t.slice(0, 4000)), ...(config.provider === 'voyage' ? {input_type: 'document'} : {})}), signal: AbortSignal.timeout(15000)});
    } catch { throw new EmbeddingError('The embedding service could not be reached.'); }
    const data = await response.json().catch(() => null) as {data?: {embedding?: unknown; index?: number}[]} | null;
    if (!response.ok || !Array.isArray(data?.data) || data.data.length !== missing.length) throw new EmbeddingError('The embedding service returned an error.');
    const rows = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    rows.forEach((row, i) => {
      const v = row.embedding;
      if (!Array.isArray(v) || !v.length || !v.every(x => typeof x === 'number' && Number.isFinite(x))) throw new EmbeddingError('The embedding service returned an invalid vector.');
      if (cache.size >= 5000) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey(config, missing[i]), v as number[]);
    });
  }
  return texts.map(t => cache.get(cacheKey(config, t))!);
}

export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export type SemanticMatch = {id: string; score: number};
/** Clauses ranked by similarity to the request, best first, rounded to 3 decimals. Pure. */
export function rankBySimilarity(query: number[], clauses: {id: string; vector: number[]}[]): SemanticMatch[] {
  return clauses.map(c => ({id: c.id, score: Math.round(cosine(query, c.vector) * 1000) / 1000})).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
