import {completeJson, type LlmConfig} from './llm';
import {lintScope} from './lint';
import {currencies, scopeSchema, type Scope} from './scope';
import {applyOwnerDefaults, type OwnerDefaults} from './profile';

// PR D: AI drafting from a brief. The model fills Scopeflow's own scope schema; the result is
// validated, linted and returned as an unsaved draft. Nothing is saved, shared or sent.

export const BRIEF_MIN = 20, BRIEF_MAX = 4000;

export function draftPrompt(brief: string, currency: string, defaults: OwnerDefaults = {}) {
  const system = [
    'You turn a freelancer\'s project brief into a precise scope of work. Reply with ONE JSON object and nothing else.',
    'Shape: {"title": string (3-160 chars), "client": string (2-120 chars; "Client" if unknown), "items": [{"title": string, "qty": integer >= 1, "unit": string, "price": number or null, "acceptance": string}], "client_inputs": [{"title": string, "due": ""}], "exclusions": string, "fee": number, "currency": string, "revisions": integer 0-50, "due": "" or "YYYY-MM-DD", "notes": string}.',
    'Rules: list every concrete deliverable with an exact quantity and unit; give each a short "acceptance" criterion (formats, approval step). Never use vague words like "etc.", "as needed", "minor tweaks" or "unlimited".',
    'Put adjacent work the client might assume is included into "exclusions" (comma separated). Put what the client must supply into "client_inputs".',
    '"notes" holds working terms: what one revision round is, feedback turnaround, and how extra work is handled.',
    `Use the fee and currency from the brief if stated, otherwise fee 0 and currency ${currency}. Allowed currencies: ${currencies.join(', ')}. Set price per item only if the brief gives prices. Use due "" unless the brief gives a date.`,
    ...(defaults.exclusions ? [`The freelancer always excludes: "${defaults.exclusions.slice(0, 600)}". These are added for you; list only further exclusions specific to this project.`] : []),
    ...(defaults.notes ? [`The freelancer's standard working terms are added for you: "${defaults.notes.slice(0, 600)}". Put only project-specific terms in "notes".`] : []),
  ].join('\n');
  return {system, user: `Brief:\n"""\n${brief.slice(0, BRIEF_MAX)}\n"""`};
}

const str = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);
const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** Coerces model output into valid scope content (ids assigned here, never by the model). */
export function normalizeDraft(raw: unknown, currency: string): Scope {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 60).map((x, n) => {
    const i = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    return {id: 'ai_' + (n + 1), title: str(i.title, 200), qty: Math.round(num(i.qty, 1, 10000, 1)), unit: str(i.unit, 40), price: typeof i.price === 'number' && Number.isFinite(i.price) && i.price >= 0 ? Math.min(10000000, i.price) : null, acceptance: str(i.acceptance, 1000)};
  }).filter(i => i.title.length >= 2);
  const inputs = (Array.isArray(r.client_inputs) ? r.client_inputs : []).slice(0, 20).map((x, n) => {
    const c = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const due = str(c.due, 10);
    return {id: 'ai_c' + (n + 1), title: str(c.title, 200), due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : ''};
  }).filter(c => c.title.length >= 2);
  const cur = typeof r.currency === 'string' && (currencies as readonly string[]).includes(r.currency) ? r.currency : currency;
  const due = str(r.due, 10);
  const candidate = {
    title: str(r.title, 160) || 'Untitled scope', client: str(r.client, 120) || 'Client',
    deliverables: '', items, client_inputs: inputs,
    exclusions: str(r.exclusions, 3000), fee: num(r.fee, 0, 10000000, 0), currency: cur,
    revisions: Math.round(num(r.revisions, 0, 50, 2)), due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '', notes: str(r.notes, 3000),
  };
  const parsed = scopeSchema.safeParse(candidate);
  if (!parsed.success) throw new Error('The draft did not match the scope format: ' + parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return parsed.data;
}

export async function draftFromBrief(brief: string, currency: string, options: {config?: LlmConfig | null; fetchImpl?: typeof fetch; today?: string; defaults?: OwnerDefaults} = {}) {
  const defaults = options.defaults ?? {};
  const prompt = draftPrompt(brief, currency, defaults);
  const raw = await completeJson(prompt, {config: options.config, fetchImpl: options.fetchImpl});
  // The owner's standard clauses and commercial defaults always apply, whatever the model returned;
  // a currency stated in the brief wins over the default currency.
  const {currency: _default, ...rest} = defaults;
  const draft = scopeSchema.parse(applyOwnerDefaults(normalizeDraft(raw, currency), rest));
  const applied = Object.entries(defaults).filter(([, v]) => v !== undefined && v !== '').map(([k]) => k);
  return {draft, applied, lint: lintScope(draft, options.today ?? new Date().toISOString().slice(0, 10))};
}
