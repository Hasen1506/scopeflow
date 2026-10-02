import {newId, type Item, type Scope} from './scope';
import type {Agreement, ChangeOrder} from './ledger';

// A transparent keyword heuristic, not a language model. It cites what it matched so the
// creator (or their own agent, via MCP) can make the actual judgment.

export type Verdict = 'in_scope' | 'out_of_scope' | 'revision' | 'ambiguous';
export type ExclusionClause = {id: string; text: string};
export type CheckResult = {
  verdict: Verdict; confidence: 'low' | 'medium';
  reasons: string[];
  matched_items: {id: string; title: string}[];
  matched_exclusions: ExclusionClause[];
  rounds_left: number;
  reply: string;
  change_order: Partial<ChangeOrder> | null;
};

const stop = new Set('a an and are as at be but by can could do does for from get have i if in into is it its just me my need of on or our please so some than that the their them then there these this to too up us we what when will with would you your yes hi hello thanks thank also add another extra additional more new'.split(' '));
const synonyms: Record<string, string> = {
  instagram: 'social', facebook: 'social', tiktok: 'social', linkedin: 'social', twitter: 'social', socials: 'social',
  site: 'website', web: 'website', webpage: 'page', landing: 'page', homepage: 'page',
  colour: 'color', colours: 'color', reel: 'video', clip: 'video', film: 'video',
  copywriting: 'copy', wording: 'copy', text: 'copy', printing: 'print', printed: 'print', print: 'print',
  logotype: 'logo', wordmark: 'logo', mark: 'logo', icon: 'logo', guideline: 'guide', guidelines: 'guide', guidebook: 'guide',
  maintain: 'maintenance', maintaining: 'maintenance', host: 'hosting', domains: 'domain', ad: 'ads', advert: 'ads', advertising: 'ads',
};
function stem(w: string) {
  if (synonyms[w]) return synonyms[w];
  let s = w;
  if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.length > 4 && /(ches|shes|xes|sses)$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  else if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  return synonyms[s] ?? s;
}
export function tokens(text: string) {
  return new Set(text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter(w => w.length > 2 && !stop.has(w) && !/^\d+$/.test(w)).map(stem));
}
function overlap(a: Set<string>, b: Set<string>) { let n = 0; for (const x of a) if (b.has(x)) n++; return n; }

export function exclusionClauses(text: string): ExclusionClause[] {
  return text.split(/[\n;,]|\band\b/i).map(x => x.replace(/^\s*(and|or)\s+/i, '').replace(/[.\s]+$/, '').trim()).filter(x => x.length > 2)
    .map((t, n) => ({id: 'x' + (n + 1), text: t}));
}

const addition = /\b(also|add|adding|another|extra|additional|one more|two more|a few more|as well|on top|plus|new|could you (also )?(do|make|create|design|build)|can you (also )?(do|make|create|design|build)|while you'?re at it|throw in)\b/i;
const revision = /\b(change|changes|tweak|tweaks|adjust|revise|revision|edit|edits|update|instead|different|try|swap|move|bigger|smaller|darker|lighter|bolder|feedback|fix|rework|redo)\b/i;
const numberWords: Record<string, number> = {two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20};
function quantities(message: string) {
  const found = [...message.matchAll(/\b(\d{1,4})\b/g)].map(m => Number(m[1]));
  for (const [w, n] of Object.entries(numberWords)) if (new RegExp(`\\b${w}\\b`, 'i').test(message)) found.push(n);
  return found;
}
/** The sentence that carries the request (skipping greetings and pleasantries), as a short title. */
function shortTitle(message: string) {
  const sentences = message.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(x => x.replace(/[^a-z]/gi, '').length > 3);
  const ask = sentences.find(x => addition.test(x) || revision.test(x)) ?? sentences.find(x => x.endsWith('?')) ?? sentences.sort((a, b) => b.length - a.length)[0] ?? '';
  const cleaned = ask.replace(/^(hi|hey|hello)\b[^,!]*[,!]\s*/i, '').replace(/^(so|also|and|but|oh),?\s+/i, '')
    .replace(/^(could|can|would|will) (you|we) (please )?(also )?/i, '').replace(/^(please )?(also )?(do|make|get|have|send|provide|add|include)\s+(us\s+|me\s+)?/i, '').replace(/[?.!]+$/, '').trim();
  const t = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return (t.length > 70 ? t.slice(0, 67).trimEnd() + '…' : t) || 'Additional request';
}

export function checkRequest(message: string, scope: Scope, agreement: Pick<Agreement, 'items' | 'revisions_allowed' | 'revisions_used' | 'currency'>): CheckResult {
  const words = tokens(message);
  const clauses = exclusionClauses(scope.exclusions);
  const items: Item[] = agreement.items;
  const rounds_left = Math.max(0, agreement.revisions_allowed - agreement.revisions_used);

  const itemHits = items.map(i => ({i, n: overlap(words, tokens(i.title + ' ' + i.unit))})).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  const exclusionHits = clauses.map(c => ({c, n: overlap(words, tokens(c.text))})).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  const wantsMore = addition.test(message);
  const wantsChange = revision.test(message);
  const nums = quantities(message);
  const top = itemHits[0]?.i;
  const overQty = top && nums.some(n => n > top.qty) && top.qty > 1;

  const reasons: string[] = [];
  let verdict: Verdict;
  if (exclusionHits.length && (!itemHits.length || exclusionHits[0].n >= itemHits[0].n)) {
    verdict = 'out_of_scope';
    reasons.push(`Matches the exclusion “${exclusionHits[0].c.text}”.`);
  } else if (top && (overQty || (wantsMore && /\b(another|extra|additional|more)\b/i.test(message)))) {
    verdict = 'out_of_scope';
    reasons.push(overQty ? `Asks for more than the ${top.qty}${top.unit ? ' ' + top.unit : ''} agreed for “${top.title}”.` : `Asks for more of “${top.title}” than the agreed quantity.`);
  } else if (wantsMore && !top) {
    verdict = 'out_of_scope';
    reasons.push('Asks for something that is not one of the agreed deliverables.');
  } else if (top && wantsChange) {
    verdict = 'revision';
    reasons.push(`Feedback on “${top.title}”, which counts as a revision round.`);
    if (!rounds_left) reasons.push('All included revision rounds are used, so this round is extra work.');
  } else if (top) {
    verdict = 'in_scope';
    reasons.push(`Relates to the agreed deliverable “${top.title}”.`);
  } else {
    verdict = 'ambiguous';
    reasons.push('Does not clearly match a deliverable or an exclusion.');
  }
  if (itemHits.length > 1 && verdict !== 'out_of_scope') reasons.push(`Also mentions: ${itemHits.slice(1, 3).map(x => '“' + x.i.title + '”').join(', ')}.`);
  const confidence = (verdict === 'ambiguous' || (itemHits[0]?.n ?? 0) + (exclusionHits[0]?.n ?? 0) < 2) ? 'low' : 'medium';

  const extraRound = verdict === 'revision' && !rounds_left;
  // More of an existing deliverable is drafted as the extra quantity; anything else as one new item.
  const extra = top && verdict === 'out_of_scope' && !reasons[0].startsWith('Matches') ? Math.max(1, overQty ? Math.max(...nums) - top.qty : 1) : 0;
  const added: Item = extra && top
    ? {id: newId(), title: `Additional ${top.title.charAt(0).toLowerCase()}${top.title.slice(1)}`.slice(0, 200), qty: extra, unit: top.unit, price: null, acceptance: top.acceptance}
    : {id: newId(), title: shortTitle(message).replace(/…$/, '').slice(0, 200), qty: 1, unit: '', price: null, acceptance: ''};
  const change_order: Partial<ChangeOrder> | null = verdict === 'out_of_scope'
    ? {title: shortTitle(message), request_quote: message.trim().slice(0, 2000), reason: reasons[0], add_items: [added]}
    : extraRound ? {title: 'Additional revision round', request_quote: message.trim().slice(0, 2000), reason: 'All included revision rounds have been used.', revisions_delta: 1} : null;

  const reply = {
    in_scope: `Thanks! That’s part of what we agreed${top ? ` (“${top.title}”)` : ''}, so I’ll take care of it.`,
    revision: rounds_left
      ? `Thanks for the feedback. I’ll treat this as revision round ${agreement.revisions_used + 1} of ${agreement.revisions_allowed}. Is there anything else you’d like included in this round? Then I’ll make all the changes together.`
      : `Thanks for the feedback. We’ve used the ${agreement.revisions_allowed} revision round${agreement.revisions_allowed === 1 ? '' : 's'} included in our agreement, so I’ve sent a short change order for an additional round. Once you approve it, I’ll get started.`,
    out_of_scope: `Happy to help with this! It’s outside what we agreed${exclusionHits[0] && verdict === 'out_of_scope' && reasons[0].startsWith('Matches') ? ` (our scope lists “${exclusionHits[0].c.text}” as excluded)` : ''}, so I’ve sent a change order with the cost and timing. Once you approve it, I’ll add it to the plan.`,
    ambiguous: 'Thanks! Could you tell me a bit more about what you have in mind? Then I can confirm whether it’s covered by our current agreement.',
  }[verdict];

  return {
    verdict, confidence, reasons,
    matched_items: itemHits.slice(0, 3).map(x => ({id: x.i.id, title: x.i.title})),
    matched_exclusions: exclusionHits.slice(0, 3).map(x => x.c),
    rounds_left, reply, change_order,
  };
}
