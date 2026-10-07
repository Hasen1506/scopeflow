import {checkRequest, exclusionClauses, type CheckResult, type Verdict} from './check';
import {completeJson, type LlmConfig} from './llm';
import type {Agreement} from './ledger';
import type {Scope} from './scope';

// PR E: scope-creep radar. Paste a client request and get a verdict that cites the exact
// clause of the agreement it rests on. The keyword checker (lib/check.ts) is the explainable
// baseline and always runs; when an LLM key is configured, a model adjudicates against the same
// numbered clauses and must cite clause ids that exist, otherwise its answer is discarded and the
// keyword verdict stands. Nothing is sent to the client and nothing is recorded.

export type ClauseKind = 'deliverable' | 'exclusion' | 'term' | 'revisions';
export type Clause = {id: string; kind: ClauseKind; text: string; ref?: string};
export type Citation = Clause & {why: string};
export type RadarResult = CheckResult & {engine: 'keyword' | 'llm'; citations: Citation[]; covered: 'yes' | 'no' | 'revision' | 'unclear'; note: string | null};

type AgreementView = Pick<Agreement, 'items' | 'revisions_allowed' | 'revisions_used' | 'currency'>;

/** The agreement as numbered clauses: D = deliverables, X = exclusions, T = working terms, R = revision allowance. */
export function clausesOf(scope: Scope, agreement: AgreementView): Clause[] {
  const deliverables = agreement.items.map((i, n) => ({id: 'D' + (n + 1), kind: 'deliverable' as const, ref: i.id, text: `${i.title}${i.qty > 1 || i.unit ? ` × ${i.qty}${i.unit ? ' ' + i.unit : ''}` : ''}${i.acceptance ? ` (done when: ${i.acceptance})` : ''}`}));
  const exclusions = exclusionClauses(scope.exclusions).map((x, n) => ({id: 'X' + (n + 1), kind: 'exclusion' as const, ref: x.id, text: x.text}));
  const terms = scope.notes.split(/(?<=[.!?])\s+|\n+/).map(t => t.trim()).filter(t => t.length > 3).slice(0, 30).map((t, n) => ({id: 'T' + (n + 1), kind: 'term' as const, text: t}));
  const rounds = {id: 'R1', kind: 'revisions' as const, text: `${agreement.revisions_allowed} revision round${agreement.revisions_allowed === 1 ? '' : 's'} included; ${agreement.revisions_used} used.`};
  return [...deliverables, ...exclusions, ...terms, rounds];
}

const coveredOf = (v: Verdict): RadarResult['covered'] => ({in_scope: 'yes', out_of_scope: 'no', revision: 'revision', ambiguous: 'unclear'} as const)[v];

/** The keyword baseline with clause citations. */
export function keywordRadar(message: string, scope: Scope, agreement: AgreementView): RadarResult {
  const base = checkRequest(message, scope, agreement);
  const clauses = clausesOf(scope, agreement);
  const citations: Citation[] = [];
  const cite = (c: Clause | undefined, why: string) => { if (c && !citations.some(x => x.id === c.id)) citations.push({...c, why}); };
  if (base.verdict === 'out_of_scope' && base.reasons[0]?.startsWith('Matches the exclusion')) {
    for (const x of base.matched_exclusions) cite(clauses.find(c => c.kind === 'exclusion' && c.ref === x.id), 'The request matches this exclusion.');
  }
  for (const m of base.matched_items) cite(clauses.find(c => c.kind === 'deliverable' && c.ref === m.id), base.verdict === 'out_of_scope' ? 'Asks for more than this agreed deliverable.' : base.verdict === 'revision' ? 'Feedback on this deliverable.' : 'The request relates to this deliverable.');
  if (base.verdict === 'revision') cite(clauses.find(c => c.id === 'R1'), base.rounds_left ? 'Counts against the included revision rounds.' : 'All included revision rounds are used.');
  return {...base, engine: 'keyword', citations, covered: coveredOf(base.verdict), note: null};
}

export function radarPrompt(message: string, clauses: Clause[]) {
  const system = [
    'You check whether a client\'s request is covered by a signed scope of work. Reply with ONE JSON object only.',
    'Shape: {"verdict": "in_scope" | "out_of_scope" | "revision" | "ambiguous", "citations": [clause ids], "reason": string (one or two sentences, quoting the clause), "reply": string (a short, friendly reply the freelancer could send)}.',
    'Use ONLY the numbered clauses given. "in_scope": an agreed deliverable (D) covers it. "out_of_scope": it is excluded (X) or not among the deliverables, or asks for more than an agreed quantity. "revision": feedback on an agreed deliverable (cite the D clause and R1). "ambiguous": you cannot tell.',
    'Every verdict except "ambiguous" must cite at least one clause id that appears in the list. Never invent clauses or ids.',
  ].join('\n');
  const user = `Clauses:\n${clauses.map(c => `${c.id} [${c.kind}] ${c.text}`).join('\n')}\n\nClient request:\n"""\n${message.slice(0, 4000)}\n"""`;
  return {system, user};
}

/** Validates model output against the clause list; returns null when it must be discarded. */
export function parseAdjudication(raw: unknown, clauses: Clause[]): {verdict: Verdict; citations: string[]; reason: string; reply: string} | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const verdicts: Verdict[] = ['in_scope', 'out_of_scope', 'revision', 'ambiguous'];
  if (!verdicts.includes(r.verdict as Verdict)) return null;
  const ids = new Set(clauses.map(c => c.id));
  const citations = Array.isArray(r.citations) ? [...new Set(r.citations.filter((x): x is string => typeof x === 'string').map(x => x.trim().toUpperCase()))] : [];
  if (citations.some(id => !ids.has(id))) return null;
  if (r.verdict !== 'ambiguous' && !citations.length) return null;
  const reason = typeof r.reason === 'string' ? r.reason.trim().slice(0, 600) : '';
  const reply = typeof r.reply === 'string' ? r.reply.trim().slice(0, 1200) : '';
  return {verdict: r.verdict as Verdict, citations, reason, reply};
}

/**
 * The radar: keyword baseline always; LLM adjudication when configured. A model answer that
 * cites unknown clauses or fails is discarded with a note, so the result is always explainable.
 */
export async function scopeRadar(message: string, scope: Scope, agreement: AgreementView, {config = null, fetchImpl}: {config?: LlmConfig | null; fetchImpl?: typeof fetch} = {}): Promise<RadarResult> {
  const keyword = keywordRadar(message, scope, agreement);
  if (!config) return keyword;
  const clauses = clausesOf(scope, agreement);
  let judged: ReturnType<typeof parseAdjudication> = null;
  try { judged = parseAdjudication(await completeJson(radarPrompt(message, clauses), {config, fetchImpl, timeoutMs: 20000}), clauses); }
  catch { return {...keyword, note: 'The AI check was unavailable, so this is the keyword check.'}; }
  if (!judged) return {...keyword, note: 'The AI answer did not cite the agreement correctly and was discarded; this is the keyword check.'};
  const citations = judged.citations.map(id => ({...clauses.find(c => c.id === id)!, why: judged.reason}));
  // The change order draft still comes from the keyword checker (it knows quantities and units);
  // if only the model says "out of scope", draft a one-item change order from the request.
  const changeOrder = judged.verdict === 'out_of_scope'
    ? keyword.change_order ?? keywordRadar(message.includes('also') ? message : 'also ' + message, scope, agreement).change_order
    : judged.verdict === 'revision' && !keyword.rounds_left ? {title: 'Additional revision round', request_quote: message.trim().slice(0, 2000), reason: 'All included revision rounds have been used.', revisions_delta: 1} : null;
  return {
    ...keyword, engine: 'llm', verdict: judged.verdict, covered: coveredOf(judged.verdict), confidence: 'medium',
    reasons: [judged.reason || keyword.reasons[0]], citations, reply: judged.reply || keyword.reply,
    change_order: changeOrder ? {...changeOrder, reason: judged.reason || changeOrder.reason} : null,
    note: judged.verdict !== keyword.verdict ? `The keyword check said “${keyword.verdict.replace('_', ' ')}”.` : null,
  };
}
