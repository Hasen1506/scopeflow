import {blank, itemLine, type ClientInput, type Item, type Milestone, type Scope} from './scope';
import {formatMoney} from './currency';
import {jurisdictionById, type JurisdictionId, type ScenarioId, type ShieldCurrency} from './legal-shield';

/**
 * 30-Second Guided Quick-Fill Packs (pure, isomorphic).
 *
 * People are lazy about writing contracts from scratch — and existing blank 14-field forms create
 * massive drop-off. Each GuidedPack asks 4 concrete questions (who, what, how much, when) and
 * compiles a complete, scopeSchema-valid Scope with protective deliverables, exclusions,
 * milestones, and a ready-to-send WhatsApp soft-confirm message.
 *
 * Kept separate from lib/templates.ts so all existing verticalPacks stable-ID invariants stay 100%
 * intact while massively expanding real-world demand coverage (Rentals, Catering, Renovations,
 * Event Vendors, Websites, Retainers).
 */

export type GuidedPackId =
  | 'rental-deposit'
  | 'event-catering'
  | 'home-renovation'
  | 'event-vendor'
  | 'website-build'
  | 'monthly-retainer';

export type GuidedPack = {
  id: GuidedPackId;
  scenario: ScenarioId;
  title: string;
  subtitle: string;
  audience: string;
  partyLabel: string;
  partyPlaceholder: string;
  subjectLabel: string;
  subjectPlaceholder: string;
  amountLabel: string;
  defaultAmountINR: number;
  defaultAmountUSD: number;
  extraLabel: string;
  extraPlaceholder: string;
  defaultExtra: string;
  lowFrictionTip: string;
};

export type GuidedInputs = {
  packId: GuidedPackId;
  jurisdiction: JurisdictionId;
  subject: string;
  party: string;
  amount: number;
  date: string;
  extra?: string;
};

export const GUIDED_PACKS: readonly GuidedPack[] = [
  {
    id: 'rental-deposit',
    scenario: 'rental',
    title: 'Apartment Move-In & Deposit Record',
    subtitle: 'Protect your security deposit with Day-1 condition photos, meter readings, and a fixed refund deadline.',
    audience: 'Renters & Tenants',
    partyLabel: 'Landlord / Owner name',
    partyPlaceholder: 'e.g. Rajesh Sharma',
    subjectLabel: 'Apartment / Property address',
    subjectPlaceholder: 'e.g. Flat 402, Palm Grove, Indiranagar',
    amountLabel: 'Security deposit amount',
    defaultAmountINR: 100000,
    defaultAmountUSD: 2500,
    extraLabel: 'Monthly rent & notice period',
    extraPlaceholder: 'e.g. ₹25,000/month, 1-month notice',
    defaultExtra: 'Monthly rent paid by 5th; 30 days written notice before vacating',
    lowFrictionTip: 'Framed as a friendly Move-In Condition & Deposit Record so landlords actually confirm it.',
  },
  {
    id: 'event-catering',
    scenario: 'catering',
    title: 'Event & Wedding Catering',
    subtitle: 'Lock menu items, guaranteed guest count, per-plate overage cap, service staff, and tiered cancellation.',
    audience: 'Event & Wedding Hosts',
    partyLabel: 'Caterer / Company name',
    partyPlaceholder: 'e.g. Saffron Kitchen Catering',
    subjectLabel: 'Event name & venue',
    subjectPlaceholder: 'e.g. Reception Dinner — 200 Guests',
    amountLabel: 'Total catering fee',
    defaultAmountINR: 180000,
    defaultAmountUSD: 6000,
    extraLabel: 'Guaranteed plates & per-plate rate',
    extraPlaceholder: 'e.g. 200 plates at ₹900/plate',
    defaultExtra: '200 guaranteed plates; up to 10% extra plates at the same per-plate rate',
    lowFrictionTip: 'Stops surprise event-day "extra plate" markups and last-minute menu swaps.',
  },
  {
    id: 'home-renovation',
    scenario: 'renovation',
    title: 'Home Interiors & Contractor BOQ',
    subtitle: 'Lock material brands, stage inspections, handover date, and written-only variations.',
    audience: 'Homeowners',
    partyLabel: 'Contractor / Studio name',
    partyPlaceholder: 'e.g. Studio Craft Interiors',
    subjectLabel: 'Home renovation scope',
    subjectPlaceholder: 'e.g. 2BHK Modular Kitchen & Wardrobes',
    amountLabel: 'Total agreed budget',
    defaultAmountINR: 450000,
    defaultAmountUSD: 18000,
    extraLabel: 'Key material / brand lock',
    extraPlaceholder: 'e.g. Century BWP 710 plywood, Hettich hardware',
    defaultExtra: 'BWP IS:710 plywood, branded soft-close hardware, Asian Paints Royale finish',
    lowFrictionTip: 'Holds back 15% until final handover inspection so work actually gets finished.',
  },
  {
    id: 'event-vendor',
    scenario: 'event-vendor',
    title: 'Event Photography / Decor / Venue',
    subtitle: 'Fix coverage hours, edited photo/video counts, overtime cap, backup gear, and delivery date.',
    audience: 'Weddings & Events',
    partyLabel: 'Vendor / Photographer name',
    partyPlaceholder: 'e.g. Frame & Light Studio',
    subjectLabel: 'Event & package name',
    subjectPlaceholder: 'e.g. Engagement & Sangeet Coverage',
    amountLabel: 'Package fee',
    defaultAmountINR: 85000,
    defaultAmountUSD: 3200,
    extraLabel: 'Overtime / add-on cap',
    extraPlaceholder: 'e.g. Extra hour capped at ₹4,000/hr',
    defaultExtra: 'Coverage up to 8 hours; extra hour billed only if approved in writing',
    lowFrictionTip: 'Prevents months-long photo delivery stalls and surprise overtime bills.',
  },
  {
    id: 'website-build',
    scenario: 'freelance',
    title: 'Website / App Design & Build',
    subtitle: 'Clear page count, browser/device acceptance criteria, revision cap, and hosting/SEO exclusions.',
    audience: 'Freelancers & Studios',
    partyLabel: 'Client name',
    partyPlaceholder: 'e.g. Northstar Dental Clinic',
    subjectLabel: 'Project title',
    subjectPlaceholder: 'e.g. 5-Page Website Redesign & Booking Form',
    amountLabel: 'Project fee',
    defaultAmountINR: 120000,
    defaultAmountUSD: 4500,
    extraLabel: 'Pages / key scope note',
    extraPlaceholder: 'e.g. 5 responsive pages + contact form',
    defaultExtra: '5 responsive pages, mobile-first, 2 consolidated revision rounds',
    lowFrictionTip: 'Eliminates "can you also add SEO and a blog?" scope creep from Day 1.',
  },
  {
    id: 'monthly-retainer',
    scenario: 'freelance',
    title: 'Monthly Retainer (Agency / CA / Advisory)',
    subtitle: 'Exact monthly deliverable quotas, no silent carry-over, client-input deadlines, and notice period.',
    audience: 'Agencies & Consultants',
    partyLabel: 'Client name',
    partyPlaceholder: 'e.g. Acme Consumer Brands',
    subjectLabel: 'Retainer title',
    subjectPlaceholder: 'e.g. Monthly Content & Performance Retainer',
    amountLabel: 'Monthly fee',
    defaultAmountINR: 60000,
    defaultAmountUSD: 2500,
    extraLabel: 'Notice period & billing day',
    extraPlaceholder: 'e.g. Billed 1st of month, 30 days notice',
    defaultExtra: 'Billed on the 1st of each month; 30 days written notice to pause or cancel',
    lowFrictionTip: 'Protects your calendar when clients send materials late and expect rush delivery.',
  },
];

export function guidedPackById(id: string): GuidedPack {
  return GUIDED_PACKS.find(p => p.id === id) ?? GUIDED_PACKS[0];
}

const mkItem = (id: string, title: string, qty = 1, unit = '', acceptance = ''): Item => ({
  id,
  title,
  qty,
  unit,
  price: null,
  acceptance,
});

function buildScope(
  base: {
    title: string;
    client: string;
    fee: number;
    currency: ShieldCurrency;
    due: string;
    revisions: number;
    items: Item[];
    client_inputs: ClientInput[];
    exclusions: string;
    notes: string;
    payment_terms: string;
    milestones?: Milestone[];
    deposit_pct?: number;
    tax_label?: string;
    tax_pct?: number;
  },
): Scope {
  const scope: Scope = {
    ...blank,
    title: base.title.trim().slice(0, 160),
    client: base.client.trim().slice(0, 120),
    deliverables: base.items.map(itemLine).join('\n'),
    items: base.items,
    client_inputs: base.client_inputs,
    exclusions: base.exclusions,
    fee: Math.max(0, Math.min(10000000, Number.isFinite(base.fee) ? Math.round(base.fee * 100) / 100 : 0)),
    currency: base.currency,
    revisions: base.revisions,
    due: /^\d{4}-\d{2}-\d{2}$/.test(base.due) ? base.due : '',
    notes: base.notes,
    payment_terms: base.payment_terms,
    ...(base.milestones ? {milestones: base.milestones} : {}),
    ...(base.deposit_pct && !base.milestones ? {deposit_pct: base.deposit_pct} : {}),
    ...(base.tax_label ? {tax_label: base.tax_label} : {}),
    ...(base.tax_pct !== undefined ? {tax_pct: base.tax_pct} : {}),
  };
  return scope;
}

/** Compiles 4 quick answers into a complete, protective, scopeSchema-valid Scope + WhatsApp summary. */
export function buildGuidedScope(inputs: GuidedInputs): {scope: Scope; whatsappRecap: string} {
  const pack = guidedPackById(inputs.packId);
  const j = jurisdictionById(inputs.jurisdiction);
  const currency: ShieldCurrency = j.currency;
  const amount = inputs.amount > 0 ? inputs.amount : currency === 'INR' ? pack.defaultAmountINR : pack.defaultAmountUSD;
  const party = inputs.party.trim() || (pack.id === 'rental-deposit' ? 'Property Owner' : 'Counterparty');
  const subject = inputs.subject.trim() || pack.title;
  const extra = inputs.extra?.trim() || pack.defaultExtra;
  const due = /^\d{4}-\d{2}-\d{2}$/.test(inputs.date) ? inputs.date : '';

  let scope: Scope;

  switch (pack.id) {
    case 'rental-deposit': {
      scope = buildScope({
        title: `Move-In & Security Deposit Record — ${subject}`,
        client: party,
        fee: amount,
        currency,
        due,
        revisions: 1,
        items: [
          mkItem('r_deposit', 'Refundable security deposit held during tenancy', 1, 'deposit', `Paid via bank transfer/UPI with UTR reference; refundable within ${j.returnWindowDays} calendar days of key handover`),
          mkItem('r_inventory', 'Day-1 room-by-room condition photos & fixture inventory', 1, 'walkthrough', 'Dated photos of walls, paint, flooring, plumbing, and appliances shared at move-in'),
          mkItem('r_meters', 'Utility meter readings (electricity, water, gas) at handover', 1, 'record', 'Opening meter photos logged on move-in day; tenant pays only usage from move-in to move-out'),
          mkItem('r_return', 'Move-out joint inspection & itemized settlement', 1, 'inspection', 'Walkthrough conducted at key handover; any deduction supported by actual vendor bills only'),
        ],
        client_inputs: [
          {id: 'ci_keys', title: 'Keys, access cards, and working appliances handed over at move-in', due},
          {id: 'ci_receipt', title: 'Written confirmation of security deposit receipt & bank refund commitment', due},
        ],
        exclusions:
          'Normal wear and tear from ordinary residential living (minor paint scuffs, nail holes, routine ageing of fixtures), mandatory blanket painting deductions without actual documented damage, and pre-existing defects logged at move-in.',
        payment_terms: `Full refundable deposit (${formatMoney(amount, currency)}) returned via bank transfer within ${j.returnWindowDays} calendar days of vacating and returning keys.`,
        notes: `${extra}. Jurisdiction reference (${j.label}): ${j.returnWindowNote} Any deduction beyond normal wear and tear requires itemized third-party bills. One revision round equals one consolidated list of corrections before confirmation.`,
      });
      break;
    }

    case 'event-catering': {
      scope = buildScope({
        title: `Catering Agreement — ${subject}`,
        client: party,
        fee: amount,
        currency,
        due,
        revisions: 2,
        items: [
          mkItem('c_menu', 'Confirmed event menu & pre-event tasting lock', 1, 'menu', 'Itemized starters, mains, breads, desserts, and beverages locked in writing after tasting'),
          mkItem('c_plates', 'Guaranteed guest catering service', 1, 'event', `${extra}; counted by agreed plate/coupon tally`),
          mkItem('c_staff', 'Uniformed service staff, crockery, cutlery & drinking water', 1, 'setup', 'Buffet and live counters fully operational 60 minutes before event start'),
          mkItem('c_cleanup', 'Food hygiene, leftover packing & post-event kitchen clearance', 1, 'service', 'Food-grade containers for host leftovers; venue kitchen cleared within 2 hours of event close'),
        ],
        client_inputs: [
          {id: 'ci_count', title: 'Final guaranteed guest count (72 hours before event)', due: ''},
          {id: 'ci_venue', title: 'Venue kitchen access, water, and power point permissions', due: ''},
        ],
        exclusions:
          'Alcohol service/bar licensing, venue rental, stage lighting/decor, and unapproved guest counts above the 10% buffer unless signed off as a written change order.',
        milestones: [
          {id: 'm_book', title: 'Booking advance after menu lock', pct: 25, due: ''},
          {id: 'm_lock', title: 'On final headcount confirmation (72 hrs prior)', pct: 50, due: ''},
          {id: 'm_done', title: 'After event service completion & plate tally', pct: 25, due},
        ],
        payment_terms: '25% booking advance, 50% at 72-hour headcount lock, 25% upon satisfactory event completion.',
        notes: `${extra}. Tiered cancellation: full refund if cancelled >30 days out; 50% refund 15–30 days out; documented actual raw-material costs only within 14 days. Extra charges require written host approval beforehand. One revision round is one consolidated menu update.`,
        ...(currency === 'INR' ? {tax_label: 'GST', tax_pct: 5} : {}),
      });
      break;
    }

    case 'home-renovation': {
      scope = buildScope({
        title: `Home Renovation BOQ — ${subject}`,
        client: party,
        fee: amount,
        currency,
        due,
        revisions: 2,
        items: [
          mkItem('h_design', '2D working drawings, 3D renders & material finish schedule', 1, 'pack', 'Approved in writing with exact brands, laminate codes, and measurements'),
          mkItem('h_material', 'Supply & installation as per approved BOQ', 1, 'package', extra),
          mkItem('h_inspect', 'Mid-stage civil, electrical & carpentry quality inspection', 1, 'inspection', 'Joint walkthrough signed off before painting and final fittings'),
          mkItem('h_handover', 'Deep clean, snag-list closure & final handover', 1, 'handover', 'All hinges, drawers, lighting, and finishes tested and signed off'),
        ],
        client_inputs: [
          {id: 'ci_soc', title: 'Society / building work permissions and site access hours', due: ''},
          {id: 'ci_fin', title: 'Final laminate, paint shade, and hardware selections', due: ''},
        ],
        exclusions:
          'Structural wall modifications, loose furniture, white goods/appliances, and any item outside this BOQ unless approved in writing as a priced variation first.',
        milestones: [
          {id: 'm_d1', title: 'Booking & design sign-off', pct: 15, due: ''},
          {id: 'm_d2', title: 'Material delivery & brand verification on site', pct: 35, due: ''},
          {id: 'm_d3', title: 'Carpentry & electrical inspection sign-off', pct: 35, due: ''},
          {id: 'm_d4', title: 'Final snag closure & handover', pct: 15, due},
        ],
        payment_terms: 'Stage payments released only after verified inspection of each milestone.',
        notes: `Materials locked: ${extra}. No verbal variations: any extra work or brand change requires a written change order with fixed price and timeline impact beforehand. One revision round equals one consolidated feedback list.`,
        ...(currency === 'INR' ? {tax_label: 'GST', tax_pct: 18} : {}),
      });
      break;
    }

    case 'event-vendor': {
      scope = buildScope({
        title: `Event Vendor Agreement — ${subject}`,
        client: party,
        fee: amount,
        currency,
        due,
        revisions: 2,
        items: [
          mkItem('e_service', 'Event-day coverage / setup as specified', 1, 'event', `${extra}; vendor arrives 60 mins prior with backup equipment`),
          mkItem('e_deliv', 'Final edited deliverables / teardown completion', 1, 'delivery', 'Delivered within agreed turnaround window in agreed high-resolution format'),
        ],
        client_inputs: [
          {id: 'ci_sched', title: 'Confirmed event schedule, venue point of contact, and must-capture list', due: ''},
        ],
        exclusions:
          'Outstation travel/stay, extra coverage hours beyond agreed limit, paid venue permissions, and rush edits unless approved as a written change order.',
        milestones: [
          {id: 'm_ev1', title: 'Date booking advance', pct: 30, due: ''},
          {id: 'm_ev2', title: 'On event day completion', pct: 50, due},
          {id: 'm_ev3', title: 'On final delivery sign-off', pct: 20, due: ''},
        ],
        payment_terms: '30% on booking, 50% on event completion, 20% on final delivery.',
        notes: `${extra}. Rescheduling due to force majeure allows date transfer within 6 months subject to availability. One revision round equals one consolidated edit list.`,
      });
      break;
    }

    case 'monthly-retainer': {
      scope = buildScope({
        title: `Monthly Retainer — ${subject}`,
        client: party,
        fee: amount,
        currency,
        due,
        revisions: 2,
        items: [
          mkItem('m_plan', 'Monthly roadmap & deliverable calendar', 1, 'plan per month', 'Approved before the month begins'),
          mkItem('m_core', 'Core monthly deliverables execution', 1, 'monthly quota', 'Completed to agreed specification within the calendar month'),
          mkItem('m_rep', 'Monthly progress & outcomes report', 1, 'report per month', 'Delivered by the 3rd working day of the following month'),
        ],
        client_inputs: [
          {id: 'ci_brief', title: 'Monthly inputs, assets, and approvals by the 25th of prior month', due: ''},
        ],
        exclusions:
          'Paid media spend, third-party software subscriptions, emergency weekend requests, and items beyond the monthly quota unless approved as a change order.',
        deposit_pct: 100,
        payment_terms: `${extra}. Unused monthly quota does not roll over.`,
        notes: `${extra}. Late client inputs shift delivery timelines day-for-day. One revision round equals one consolidated feedback list per deliverable.`,
        ...(currency === 'INR' ? {tax_label: 'GST', tax_pct: 18} : {}),
      });
      break;
    }

    case 'website-build':
    default: {
      scope = buildScope({
        title: subject,
        client: party,
        fee: amount,
        currency,
        due,
        revisions: 2,
        items: [
          mkItem('w_ux', 'Wireframes & responsive UI design', 5, 'pages', 'Desktop & mobile layouts approved before engineering starts'),
          mkItem('w_dev', 'Production frontend & form implementation', 5, 'pages', 'Tested across current Chrome, Safari, Firefox, and mobile viewports'),
          mkItem('w_launch', 'Launch, QA checklist & handover guide', 1, 'handover', 'Deployed live with source/admin handover'),
        ],
        client_inputs: [
          {id: 'ci_copy', title: 'Final page copy, brand logo, and images', due: ''},
          {id: 'ci_host', title: 'Domain DNS and hosting credentials', due: ''},
        ],
        exclusions:
          'Domain & hosting renewals, paid stock/font licenses, copywriting, ongoing SEO/ads, and post-launch maintenance unless added via change order.',
        milestones: [
          {id: 'm_w1', title: 'Kickoff & design start', pct: 40, due: ''},
          {id: 'm_w2', title: 'Design sign-off & build start', pct: 30, due: ''},
          {id: 'm_w3', title: 'Pre-launch approval & handover', pct: 30, due},
        ],
        payment_terms: '40% on approval, 30% on design sign-off, 30% before live handover.',
        notes: `${extra}. Feedback is consolidated into one list per revision round. Requests beyond the listed pages are priced via a written change order.`,
        ...(currency === 'INR' ? {tax_label: 'GST', tax_pct: 18} : {}),
      });
      break;
    }
  }

  const whatsappRecap = [
    `Hi ${party}, sharing a quick summary of "${scope.title}" so we’re both on the same page:`,
    `• Agreed amount: ${formatMoney(scope.fee, scope.currency)}${scope.tax_pct ? ` (+ ${scope.tax_pct}% ${scope.tax_label})` : ''}`,
    ...scope.items!.slice(0, 3).map(i => `• ${i.title}${i.acceptance ? ` — ${i.acceptance}` : ''}`),
    `• Outside scope: ${scope.exclusions.slice(0, 140)}${scope.exclusions.length > 140 ? '…' : ''}`,
    `Please reply "Confirmed" if this matches what we agreed!`,
  ].join('\n');

  return {scope, whatsappRecap};
}

/** Session storage key used to pass a guided/shield draft straight into the workspace editor. */
export const GUIDED_STASH_KEY = 'scopeflow:guided-draft';
