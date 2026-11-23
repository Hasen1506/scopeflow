import {formatMoney, itemsOf, type Scope} from './scope';
import {itemsTotal} from './money';

export type Severity = 'error' | 'warn' | 'info';
export type LintIssue = {rule: string; severity: Severity; field: string; item_id?: string; subfield?: 'title' | 'acceptance'; message: string; fix?: string; rewrite?: Rewrite};
export type LintResult = {score: number; grade: 'clear' | 'mostly clear' | 'risky' | 'vague'; issues: LintIssue[]};

// Phrases that let either side read the agreement their own way. `fix` says what to write instead;
// `rewrite`, where a safe wording exists, is the replacement offered as a one-click suggestion.
type Vague = {re: RegExp; why: string; fix: string; rewrite?: (hit: string, s: Scope) => string};
const vague: Vague[] = [
  {re: /,?\s*\betc\.?(?=\s|$|[,;)])/i, why: '“etc.” leaves the list open-ended', fix: 'List every item; anything not listed is outside the scope.', rewrite: () => ''},
  {re: /,?\s*\band (so on|more)\b/i, why: 'open-ended list', fix: 'Finish the list; anything not listed is outside the scope.', rewrite: () => ''},
  {re: /\bas (needed|required|necessary|appropriate)\b/i, why: 'no limit on how much', fix: 'Give a number, e.g. “up to 4 per month”.'},
  {re: /\b(minor|small|quick|light) (tweaks?|changes?|edits?|adjustments?)\b/i, why: '“minor” means different things to each side', fix: 'Tie changes to the revision rounds.', rewrite: (_, s) => s.revisions > 0 ? `changes within the ${s.revisions} included revision round${s.revisions === 1 ? '' : 's'}` : 'changes agreed through a change order'},
  {re: /\bunlimited (revisions?|rounds?|changes?)\b/i, why: 'unlimited work at a fixed fee', fix: 'Set a number of revision rounds.', rewrite: (_, s) => `${Math.max(1, s.revisions)} revision round${Math.max(1, s.revisions) === 1 ? '' : 's'}`},
  {re: /\bunlimited\b/i, why: 'unlimited work at a fixed fee', fix: 'Replace it with a number or a limit.'},
  {re: /\b(ongoing|continuous)\b/i, why: 'no end point', fix: 'Give an end date or a period, e.g. “for 3 months from approval”.'},
  {re: /\b(various|misc(ellaneous)?|assorted)\b/i, why: 'unspecified contents', fix: 'Name each item.'},
  {re: /\b(tbd|tbc|to be (decided|confirmed|agreed))\b/i, why: 'undecided term', fix: 'Decide it before sending, or list it as a client input with a due date.'},
  {re: /\b(approximately|around|roughly|about) (?=\d)/i, why: 'approximate quantity', fix: 'Commit to the number, or give a range with a maximum.', rewrite: () => 'up to '},
  {re: /\bagreed (pages|pieces|items|deliverables|content)\b/i, why: 'refers to a list that is not written down', fix: 'Write the list into the deliverables.'},
  {re: /\b(reasonable|sufficient|adequate)\b/i, why: 'subjective standard', fix: 'State the measurable standard (a number, format or test).'},
  {re: /\b(including but not limited to)\b/i, why: 'open-ended inclusion', fix: 'Make the list exhaustive.', rewrite: () => 'consisting of'},
  {re: /\b(all|any) (necessary|required|other)\b/i, why: 'open-ended obligation', fix: 'Name what is needed.'},
  {re: /\bat (?:the )?(?:landlord'?s|owner'?s|vendor'?s|contractor'?s|sole|our|their) discretion\b/i, why: 'one-sided discretion lets the other party decide deductions or timing unilaterally', fix: 'Replace discretion with written itemized bills and a fixed deadline.', rewrite: () => 'based on written itemized bills within 15 days'},
  {re: /\bas per actuals\b/i, why: 'uncapped pass-through costs cause surprise final bills', fix: 'Cap extra charges or require written pre-approval before spending.', rewrite: () => 'only with prior written approval and itemized receipts'},
  {re: /\bmarket rates?\b/i, why: 'undefined pricing after work starts', fix: 'Fix the exact unit rate in writing now.', rewrite: () => 'the agreed fixed unit rate listed above'},
  {re: /\bbest efforts?\b/i, why: 'no concrete delivery commitment', fix: 'State the measurable delivery date or backup plan.', rewrite: () => 'delivery on the agreed schedule with written notice of any delay'},
  {re: /\bpromptly\b/i, why: 'no enforceable deadline', fix: 'State an exact number of days (e.g. within 7 business days).', rewrite: () => 'within 7 business days'},
  {re: /\bmandatory (?:1[- ]month |one[- ]month )?painting\b/i, why: 'blanket painting deduction ignores actual wall condition', fix: 'Limit deductions to actual damage beyond normal wear with itemized bills.', rewrite: () => 'itemized bills only for damage beyond normal wear and tear'},
];

/** Where an issue's suggested rewrite applies and what it becomes. */
export type Rewrite = {find: string; replace: string};

// Adjacent work or protections parties commonly assume are included, by agreement type.
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
  {name: 'rental & deposit', detect: /\b(apartment|flat\b|move[\s-]?in|security deposit|landlord|tenant|lease|rental)\b/i, expect: [
    {term: /refund|return.*\d+\s*days?|\d+\s*days?.*return/i, label: 'a fixed deposit refund deadline (e.g. 15 days)'},
    {term: /itemi[sz]ed|bill|receipt|normal wear/i, label: 'itemized bills only (no blanket deductions)'},
    {term: /photo|meter|handover|video/i, label: 'Day-1 condition photos & meter readings'}]},
  {name: 'event & wedding catering', detect: /\b(catering|per[\s-]?plate|buffet|banquet|wedding.*food|reception dinner)\b/i, expect: [
    {term: /buffer|extra plate|overage|additional plate/i, label: 'an extra-plate overage rate cap'},
    {term: /cancel|reschedul|postpone/i, label: 'tiered cancellation or reschedule terms'},
    {term: /staff|crockery|clean/i, label: 'service staff, crockery & cleanup responsibility'}]},
  {name: 'home renovation & interiors', detect: /\b(renovation|interiors?|modular kitchen|wardrobes?|contractor|boq\b)\b/i, expect: [
    {term: /brand|plywood|bwp|hettich|asian paints|finolex|grade|material/i, label: 'exact material brands & grades'},
    {term: /variation|written|change order/i, label: 'written-only variation approval before extra billing'},
    {term: /retention|snag|handover/i, label: 'a final retention holdback until snag handover'}]},
  {name: 'event vendor (photo/decor/venue)', detect: /\b(photography|videography|candid|mandap|decor|florals|dj\b|sound system)\b/i, expect: [
    {term: /overtime|extra hour|curfew/i, label: 'an overtime hourly cap'},
    {term: /backup|spare|generator|power/i, label: 'backup equipment or power responsibility'},
    {term: /cancel|reschedul/i, label: 'cancellation or date-change terms'}]},
];

/** INR fee from which the clarity check suggests checking stamp duty. */
export const STAMP_DUTY_THRESHOLD_INR = 100000;

const weights: Record<Severity, number> = {error: 25, warn: 8, info: 3};

export function lintScope(s: Scope, today = new Date().toISOString().slice(0, 10)): LintResult {
  const issues: LintIssue[] = [];
  const add = (i: LintIssue) => issues.push(i);
  const items = itemsOf(s);
  const scanVague = (text: string, field: string, item_id?: string, subfield?: 'title' | 'acceptance') => {
    let seenUnlimited = false;
    for (const v of vague) {
      const hit = text.match(v.re);
      if (!hit) continue;
      if (/unlimited/i.test(hit[0])) { if (seenUnlimited) continue; seenUnlimited = true; }
      const isError = /unlimited|discretion|mandatory (?:1[- ]month |one[- ]month )?painting/i.test(hit[0]);
      add({rule: 'vague-language', severity: isError ? 'error' : 'warn', field, item_id, ...(subfield ? {subfield} : {}), message: `“${hit[0].replace(/^,?\s*/, '')}”: ${v.why}.`, fix: v.fix, ...(v.rewrite ? {rewrite: {find: hit[0], replace: v.rewrite(hit[0], s)}} : {})});
    }
  };

  items.forEach(i => {
    scanVague(i.title, 'items', i.id, 'title');
    scanVague(i.acceptance, 'items', i.id, 'acceptance');
    if (i.qty === 1 && !i.unit && /[a-z]{3,}s$/i.test(i.title.trim()) && !/\d/.test(i.title) && !/(guidelines|graphics|assets|analytics|basics|materials|sessions?)$/i.test(i.title.trim()))
      add({rule: 'missing-quantity', severity: 'info', field: 'items', item_id: i.id, message: `“${i.title}” sounds plural but has quantity 1.`, fix: 'Set the exact number and a unit.'});
  });
  scanVague(s.notes, 'notes');
  scanVague(s.exclusions, 'exclusions');

  const titles = items.map(i => i.title.trim().toLowerCase());
  if (new Set(titles).size !== titles.length) add({rule: 'duplicate-item', severity: 'warn', field: 'items', message: 'Two deliverables have the same name.', fix: 'Merge them or make the difference explicit.'});
  const noAcceptance = items.filter(i => !i.acceptance);
  if (items.length && noAcceptance.length === items.length) add({rule: 'no-acceptance', severity: 'warn', field: 'items', message: 'No deliverable says when it counts as done.', fix: 'Add “Done when” criteria, e.g. file formats or approval in a specific tool.'});
  else if (noAcceptance.length) add({rule: 'some-acceptance', severity: 'info', field: 'items', message: `${noAcceptance.length} of ${items.length} deliverables have no “Done when” criteria.`});

  // R4-02: line totals as the client sees them (qty × unit_price when a unit price is set).
  const {total, priced} = itemsTotal(items, s.currency);
  if (priced && priced === items.length && Math.abs(total - s.fee) > 0.005)
    add({rule: 'fee-mismatch', severity: 'warn', field: 'fee', message: `Item prices add up to ${formatMoney(total, s.currency)} but the fee is ${formatMoney(s.fee, s.currency)}.`, fix: s.fee < total ? 'If this is a discount, say so in the working terms.' : 'Price every deliverable or explain the difference.'});
  else if (priced && total > s.fee + 0.005)
    add({rule: 'fee-mismatch', severity: 'warn', field: 'fee', message: `Priced items already exceed the fee (${formatMoney(total, s.currency)} > ${formatMoney(s.fee, s.currency)}).`});
  // PR C: payment terms that need each other.
  if ((s.deposit_pct ?? 0) > 0 && !s.payment_terms) add({rule: 'deposit-no-terms', severity: 'info', field: 'payment_terms', message: `A ${s.deposit_pct}% deposit is set but no payment terms say when the balance is due.`, fix: 'Add payment terms, e.g. “Balance due within 15 days of delivery”.'});
  if (s.tax_pct !== undefined && s.tax_pct > 0 && !s.tax_label) add({rule: 'tax-no-label', severity: 'info', field: 'tax_label', message: 'A tax rate is set without a name.', fix: 'Name the tax (GST, VAT, sales tax) so the client knows what it is.'});
  // Stamp duty: Indian agreements may need it (rates differ by state). Advisory only, for high-value scopes.
  if (s.currency === 'INR' && s.fee >= STAMP_DUTY_THRESHOLD_INR && !/stamp/i.test(s.notes))
    add({rule: 'stamp-duty', severity: 'info', field: 'notes', message: `A ${formatMoney(s.fee, 'INR')} agreement in India may need stamp duty paid; the amount depends on the state.`, fix: 'If it applies, buy an e-stamp through SHCIL (shcilestamp.com) or your state portal and note its certificate number in the working terms. This is not legal advice.'});
  if (s.fee === 0) add({rule: 'no-fee', severity: 'warn', field: 'fee', message: 'The fee is zero.', fix: 'Record the agreed fee, even if it is paid elsewhere.'});

  if (!s.exclusions.trim()) add({rule: 'no-exclusions', severity: 'warn', field: 'exclusions', message: 'Nothing is listed as outside this scope.', fix: 'Name the adjacent work the client might assume is included.'});
  const corpus = [s.title, ...items.map(i => i.title)].join(' ');
  for (const c of categories) {
    if (!c.detect.test(corpus)) continue;
    const missing = c.expect.filter(e => !e.term.test(s.exclusions) && !e.term.test(s.notes) && !e.term.test(corpus));
    if (missing.length) add({rule: 'category-exclusions', severity: 'info', field: 'exclusions', message: `For ${c.name} agreements, parties often dispute ${missing.map(m => m.label).join(', ')}.`, fix: 'State it explicitly in the terms or exclusions.'});
  }

  if (s.revisions === 0) add({rule: 'no-revisions', severity: 'info', field: 'revisions', message: 'No revision rounds are included; any feedback will need a change order.'});
  if (s.revisions > 5) add({rule: 'many-revisions', severity: 'info', field: 'revisions', message: `${s.revisions} revision rounds is high for a fixed fee.`});
  if (!/round|consolidat|feedback/i.test(s.notes) && s.revisions > 0) add({rule: 'round-definition', severity: 'info', field: 'notes', message: 'The terms do not say what counts as one revision round.', fix: 'For example: “One round is one consolidated list of feedback.”'});
  if (!/pay|deposit|invoice|upfront|up-front|%|net ?\d+|refund/i.test(s.notes)) add({rule: 'payment-terms', severity: 'info', field: 'notes', message: 'No payment terms are mentioned.', fix: 'State the deposit, milestones and invoice timing.'});

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

/** The scope with one issue's suggested rewrite applied (first occurrence, in the field it was found in). Pure. */
export function applyRewrite(s: Scope, issue: LintIssue): Scope {
  const r = issue.rewrite;
  if (!r) return s;
  const fix = (text: string) => text.replace(r.find, r.replace).replace(/\s{2,}/g, ' ').replace(/\s+([,.;)])/g, '$1').trim();
  if (issue.field === 'items' && issue.item_id && issue.subfield) {
    const items = itemsOf(s).map(i => i.id === issue.item_id ? {...i, [issue.subfield!]: fix(i[issue.subfield!])} : i);
    return {...s, items};
  }
  if (issue.field === 'notes') return {...s, notes: fix(s.notes)};
  if (issue.field === 'exclusions') return {...s, exclusions: fix(s.exclusions)};
  return s;
}
