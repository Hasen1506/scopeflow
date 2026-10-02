import {formatMoney, itemsOf, type Scope} from './scope';

export type Severity = 'error' | 'warn' | 'info';
export type LintIssue = {rule: string; severity: Severity; field: string; item_id?: string; message: string; fix?: string};
export type LintResult = {score: number; grade: 'clear' | 'mostly clear' | 'risky' | 'vague'; issues: LintIssue[]};

// Phrases that let either side read the agreement their own way.
const vague: [RegExp, string][] = [
  [/\betc\.?(?=\s|$|[,;)])/i, '“etc.” leaves the list open-ended'],
  [/\band (so on|more)\b/i, 'open-ended list'],
  [/\bas (needed|required|necessary|appropriate)\b/i, 'no limit on how much'],
  [/\b(minor|small|quick|light) (tweaks?|changes?|edits?|adjustments?)\b/i, '“minor” means different things to each side'],
  [/\bunlimited\b/i, 'unlimited work at a fixed fee'],
  [/\b(ongoing|continuous)\b/i, 'no end point'],
  [/\b(various|misc(ellaneous)?|assorted)\b/i, 'unspecified contents'],
  [/\b(tbd|tbc|to be (decided|confirmed|agreed))\b/i, 'undecided term'],
  [/\b(approximately|around|roughly|about) \d/i, 'approximate quantity'],
  [/\bagreed (pages|pieces|items|deliverables|content)\b/i, 'refers to a list that is not written down'],
  [/\b(reasonable|sufficient|adequate)\b/i, 'subjective standard'],
  [/\b(including but not limited to)\b/i, 'open-ended inclusion'],
  [/\b(all|any) (necessary|required|other)\b/i, 'open-ended obligation'],
];

// Adjacent work clients commonly assume is included, by project type.
const categories: {name: string; detect: RegExp; expect: {term: RegExp; label: string}[]}[] = [
  {name: 'website', detect: /\b(website|web ?site|landing page|web ?app|wordpress|shopify|webflow|pages? implemented)\b/i, expect: [
    {term: /hosting|domain/i, label: 'hosting and domain costs'}, {term: /maintenance|support|updates/i, label: 'ongoing maintenance'},
    {term: /copy(writing)?|content (writing|creation)/i, label: 'copywriting'}, {term: /seo|search/i, label: 'SEO'}]},
  {name: 'brand', detect: /\b(logo|brand|identity|visual identity)\b/i, expect: [
    {term: /print/i, label: 'print production'}, {term: /website|web/i, label: 'website design'}, {term: /trademark|legal/i, label: 'trademark searches'}]},
  {name: 'content', detect: /\b(posts?|videos?|reels?|social|content|blog|articles?|newsletter)\b/i, expect: [
    {term: /paid|ads?|boost|distribution/i, label: 'paid promotion'}, {term: /community|replies|engagement/i, label: 'community management'}]},
  {name: 'app', detect: /\b(mobile app|ios|android|app store|react native|flutter)\b/i, expect: [
    {term: /store|developer account/i, label: 'app store fees'}, {term: /backend|server|api/i, label: 'backend or server work'}, {term: /maintenance|support/i, label: 'post-launch support'}]},
];

const weights: Record<Severity, number> = {error: 25, warn: 8, info: 3};

export function lintScope(s: Scope, today = new Date().toISOString().slice(0, 10)): LintResult {
  const issues: LintIssue[] = [];
  const add = (i: LintIssue) => issues.push(i);
  const items = itemsOf(s);
  const scanVague = (text: string, field: string, item_id?: string) => {
    for (const [pattern, why] of vague) {
      const hit = text.match(pattern);
      if (hit) add({rule: 'vague-language', severity: /unlimited/i.test(hit[0]) ? 'error' : 'warn', field, item_id, message: `“${hit[0]}”: ${why}.`, fix: 'Replace it with an exact list, number or limit.'});
    }
  };

  items.forEach(i => {
    scanVague(i.title, 'items', i.id);
    scanVague(i.acceptance, 'items', i.id);
    if (i.qty === 1 && !i.unit && /[a-z]{3,}s$/i.test(i.title.trim()) && !/\d/.test(i.title) && !/(guidelines|graphics|assets|analytics|basics|materials|sessions?)$/i.test(i.title.trim()))
      add({rule: 'missing-quantity', severity: 'info', field: 'items', item_id: i.id, message: `“${i.title}” sounds plural but has quantity 1.`, fix: 'Set the exact number and a unit.'});
  });
  scanVague(s.notes, 'notes');

  const titles = items.map(i => i.title.trim().toLowerCase());
  if (new Set(titles).size !== titles.length) add({rule: 'duplicate-item', severity: 'warn', field: 'items', message: 'Two deliverables have the same name.', fix: 'Merge them or make the difference explicit.'});
  const noAcceptance = items.filter(i => !i.acceptance);
  if (items.length && noAcceptance.length === items.length) add({rule: 'no-acceptance', severity: 'warn', field: 'items', message: 'No deliverable says when it counts as done.', fix: 'Add “Done when” criteria, e.g. file formats or approval in a specific tool.'});
  else if (noAcceptance.length) add({rule: 'some-acceptance', severity: 'info', field: 'items', message: `${noAcceptance.length} of ${items.length} deliverables have no “Done when” criteria.`});

  const priced = items.filter(i => i.price != null);
  const total = priced.reduce((sum, i) => sum + (i.price ?? 0), 0);
  if (priced.length && priced.length === items.length && Math.abs(total - s.fee) > 0.005)
    add({rule: 'fee-mismatch', severity: 'warn', field: 'fee', message: `Item prices add up to ${formatMoney(total, s.currency)} but the fee is ${formatMoney(s.fee, s.currency)}.`, fix: s.fee < total ? 'If this is a discount, say so in the working terms.' : 'Price every deliverable or explain the difference.'});
  else if (priced.length && total > s.fee + 0.005)
    add({rule: 'fee-mismatch', severity: 'warn', field: 'fee', message: `Priced items already exceed the fee (${formatMoney(total, s.currency)} > ${formatMoney(s.fee, s.currency)}).`});
  if (s.fee === 0) add({rule: 'no-fee', severity: 'warn', field: 'fee', message: 'The fee is zero.', fix: 'Record the agreed fee, even if it is paid elsewhere.'});

  if (!s.exclusions.trim()) add({rule: 'no-exclusions', severity: 'warn', field: 'exclusions', message: 'Nothing is listed as outside this scope.', fix: 'Name the adjacent work the client might assume is included.'});
  const corpus = [s.title, ...items.map(i => i.title)].join(' ');
  for (const c of categories) {
    if (!c.detect.test(corpus)) continue;
    const missing = c.expect.filter(e => !e.term.test(s.exclusions) && !e.term.test(s.notes) && !e.term.test(corpus));
    if (missing.length) add({rule: 'category-exclusions', severity: 'info', field: 'exclusions', message: `For ${c.name} projects, clients often assume ${missing.map(m => m.label).join(', ')} ${missing.length > 1 ? 'are' : 'is'} included.`, fix: 'Exclude them explicitly or add them as deliverables.'});
  }

  if (s.revisions === 0) add({rule: 'no-revisions', severity: 'info', field: 'revisions', message: 'No revision rounds are included; any feedback will need a change order.'});
  if (s.revisions > 5) add({rule: 'many-revisions', severity: 'info', field: 'revisions', message: `${s.revisions} revision rounds is high for a fixed fee.`});
  if (!/round|consolidat|feedback/i.test(s.notes) && s.revisions > 0) add({rule: 'round-definition', severity: 'info', field: 'notes', message: 'The terms do not say what counts as one revision round.', fix: 'For example: “One round is one consolidated list of feedback.”'});
  if (!/pay|deposit|invoice|upfront|up-front|%|net ?\d+/i.test(s.notes)) add({rule: 'payment-terms', severity: 'info', field: 'notes', message: 'No payment terms are mentioned.', fix: 'State the deposit, milestones and invoice timing.'});

  if (s.due && s.due < today) add({rule: 'past-due', severity: 'warn', field: 'due', message: 'The delivery date is in the past.'});
  const inputs = s.client_inputs ?? [];
  if (!inputs.length) add({rule: 'no-client-inputs', severity: 'info', field: 'client_inputs', message: 'Nothing is listed as coming from the client.', fix: 'List copy, assets, access or feedback you depend on, so delays are on the record.'});
  else if (s.due && inputs.some(i => !i.due)) add({rule: 'client-input-dates', severity: 'info', field: 'client_inputs', message: 'Some client inputs have no due date, so a late input cannot move the delivery date.'});
  for (const i of inputs) if (s.due && i.due && i.due > s.due) add({rule: 'client-input-after-due', severity: 'warn', field: 'client_inputs', message: `“${i.title}” is due after the delivery date.`});

  const order: Severity[] = ['error', 'warn', 'info'];
  issues.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  const score = Math.max(0, 100 - issues.reduce((sum, i) => sum + weights[i.severity], 0));
  const grade = score >= 85 ? 'clear' : score >= 65 ? 'mostly clear' : score >= 40 ? 'risky' : 'vague';
  return {score, grade, issues};
}
