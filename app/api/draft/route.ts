import {z} from 'zod';
import {limits} from '@/lib/plans';
import {json, ownerAuth, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {llmConfig, llmStatus, LlmError} from '@/lib/llm';
import {BRIEF_MAX, BRIEF_MIN, draftFromBrief, modeDefaultCurrency, resolveDraftCurrency} from '@/lib/draft';
import {currentMode} from '@/lib/mode';
import '@/lib/readiness-warnings';
import {currencies} from '@/lib/scope';
import {ownerDefaults} from '@/lib/owner-defaults';
const input = z.object({brief: z.string().trim().min(BRIEF_MIN).max(BRIEF_MAX), currency: z.enum(currencies).optional(), quality: z.enum(['fast', 'careful']).default('fast')}).strict();
// PR D: AI drafting from a brief. Returns an unsaved, linted draft; never saves or sends anything.
// Disabled (503, code ai_disabled) unless OPENAI_API_KEY or ANTHROPIC_API_KEY is set.
export async function POST(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in to draft with AI.'}, 401);
    const status = llmStatus();
    if (!status.enabled) return json({error: 'AI drafting is turned off on this server: ' + status.reason + ' Start from a template instead.', code: 'ai_disabled'}, 503);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return json({error: `Describe the project in ${BRIEF_MIN}–${BRIEF_MAX} characters.`}, 400);
    const careful = parsed.data.quality === 'careful';
    if (!await allowWrite((careful ? 'ai-careful:' : 'ai:') + auth.user, careful ? limits().ai_careful_per_minute : limits().ai_per_minute)) return json({error: 'AI drafting limit reached. Try again in a minute.'}, 429);
    try {
      const [defaults, mode] = await Promise.all([ownerDefaults(auth.user), currentMode(auth.user)]);
      // M11: request > owner default > mode default.
      const currency = resolveDraftCurrency({request: parsed.data.currency, owner: defaults.currency, mode: modeDefaultCurrency(mode)});
      const result = await draftFromBrief(parsed.data.brief, currency.currency, {config: llmConfig(process.env, parsed.data.quality), defaults, forceCurrency: currency.forced});
      return json({draft: result.draft, lint: result.lint, provider: status.provider, model: careful ? status.careful_model : status.model, quality: parsed.data.quality, saved: false, owner_defaults: result.applied, currency_source: currency.source});
    } catch (e) {
      if (e instanceof LlmError) return json({error: e.message + ' Try again, or start from a template.', code: 'ai_failed'}, 502);
      if (e instanceof Error && e.message.startsWith('The draft did not match')) return json({error: 'The AI draft was not usable. Try a more specific brief.', code: 'ai_invalid'}, 502);
      throw e;
    }
  } catch (e) { return failure(e); }
}
