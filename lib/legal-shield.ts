import type {Currency} from './currency';
import {formatMoney} from './currency';

/**
 * Jurisdiction-aware Agreement & Deposit Shield (pure, isomorphic).
 *
 * Solves Scopeflow's core real-world power-asymmetry problem: landlords, caterers, local
 * contractors, and busy enterprise buyers routinely refuse to sign a brand-new contract from an
 * app. Instead of dead-ending when the other side won't sign, this module:
 *  1. Surfaces concrete statutory baselines for India (state-aware) and US (state-aware) agreements.
 *  2. Scans any pasted contract, WhatsApp quote, or draft for predatory or high-dispute traps.
 *  3. Generates a 3-Level Friction Ladder:
 *     - Level 1: Polite WhatsApp / SMS Soft Confirm (lowest friction; a simple "Yes/OK" reply
 *       creates an admissible written record under India BSA 2023 s.63 / US ESIGN).
 *     - Level 2: 1-Tap Scopeflow Summary Link (structured approval without needing an account).
 *     - Level 3: Unilateral Timestamped Evidence & Move-In/Notice Record (when they refuse to reply).
 *
 * Every legal point is practical information, not legal advice.
 */

export type ScenarioId = 'rental' | 'catering' | 'renovation' | 'event-vendor' | 'freelance';

export type JurisdictionId =
  | 'IN-KA'
  | 'IN-MH'
  | 'IN-TN'
  | 'IN-DL'
  | 'IN-GEN'
  | 'US-CA'
  | 'US-NY'
  | 'US-TX'
  | 'US-GEN';

export type ScenarioMeta = {
  id: ScenarioId;
  label: string;
  parties: string;
  tagline: string;
  sampleClause: string;
};

export type JurisdictionRule = {
  id: JurisdictionId;
  country: 'IN' | 'US';
  label: string;
  currency: Currency;
  depositCapNote: string;
  returnWindowDays: number;
  returnWindowNote: string;
  electronicEvidenceLaw: string;
  disputeForum: string;
  keyRights: {title: string; detail: string; citation: string}[];
};

export type TrapSeverity = 'high' | 'medium' | 'info';

export type TrapFinding = {
  id: string;
  severity: TrapSeverity;
  title: string;
  excerpt: string;
  whyItHurts: string;
  legalContext: string;
  safeClause: string;
};

export type EscalationInput = {
  scenario: ScenarioId;
  jurisdiction: JurisdictionId;
  partyName: string;
  yourName: string;
  subject: string;
  amount: number;
  date: string;
  notes?: string;
};

export type EscalationLadder = {
  level1WhatsApp: {
    title: string;
    whyItWorks: string;
    message: string;
    waHref: string;
  };
  level2Link: {
    title: string;
    whyItWorks: string;
    actionLabel: string;
  };
  level3Unilateral: {
    title: string;
    whyItWorks: string;
    checklist: string[];
    noticeTemplate: string;
  };
};

export type ShieldReport = {
  scenario: ScenarioMeta;
  jurisdiction: JurisdictionRule;
  riskLevel: 'high' | 'moderate' | 'protected';
  score: number;
  findings: TrapFinding[];
  missingProtections: {id: string; title: string; safeClause: string}[];
};

export const SCENARIOS: readonly ScenarioMeta[] = [
  {
    id: 'rental',
    label: 'Apartment rental & security deposit',
    parties: 'Tenant ↔ Landlord / Broker',
    tagline: 'Stop arbitrary painting deductions and silent deposit withholding when you move out.',
    sampleClause:
      'Tenant pays 6 months security deposit (₹1,50,000). One month rent will be automatically deducted for painting and deep cleaning on vacating regardless of condition. Security deposit is non-refundable if vacated during lock-in and balance will be returned at landlord’s discretion after inspection.',
  },
  {
    id: 'catering',
    label: 'Event & wedding catering',
    parties: 'Host ↔ Caterer',
    tagline: 'Lock the menu, guaranteed plate count, extra-plate cap, and service staff before paying the advance.',
    sampleClause:
      'Advance 50% non-refundable upon booking. Approximate 250 guests, standard buffet menu with veg and non-veg items etc. Extra guests charged as applicable on event day. Balance cash before service starts.',
  },
  {
    id: 'renovation',
    label: 'Home interiors & local contractor',
    parties: 'Homeowner ↔ Contractor / Interior Designer',
    tagline: 'Prevent surprise material swaps, mid-job price jumps, and stalled handovers.',
    sampleClause:
      'Full 2BHK modular kitchen, wardrobes and false ceiling using good quality plywood and branded hardware as needed. 60% upfront, 30% during work, 10% on completion. Any extra civil or electrical changes billed as actuals at the end.',
  },
  {
    id: 'event-vendor',
    label: 'Event venue, decor & photography',
    parties: 'Host ↔ Venue / Photographer / Decorator',
    tagline: 'Nail down overtime rates, delivery timelines, raw/edited counts, and rain or cancellation terms.',
    sampleClause:
      'Wedding decor and full-day photography package. Unlimited photos delivered roughly 2 months after the event. Advance is strictly non-refundable for any reason including venue changes or weather.',
  },
  {
    id: 'freelance',
    label: 'Freelance, agency & software scope',
    parties: 'Creator / Studio ↔ Client',
    tagline: 'End unlimited revisions, open-ended deliverables, and late-payment stalls.',
    sampleClause:
      'Design and build company website with all necessary pages, SEO, integrations etc. Includes unlimited minor tweaks until launch. Payment will be released after client is fully satisfied with launch.',
  },
];

export const JURISDICTIONS: readonly JurisdictionRule[] = [
  {
    id: 'IN-KA',
    country: 'IN',
    label: 'India — Karnataka (Bengaluru)',
    currency: 'INR',
    depositCapNote: 'Customary deposits in Bengaluru run 4–10 months, though Model Tenancy norms benchmark 2 months; put the exact amount and return date in writing.',
    returnWindowDays: 15,
    returnWindowNote: 'No automatic statutory grace period after key handover — specify 7 to 15 days in writing with itemized bills for any deduction.',
    electronicEvidenceLaw: 'Bharatiya Sakshya Adhiniyam (BSA), 2023 s.63 (electronic records) & IT Act s.10A (contracts formed by electronic messages).',
    disputeForum: 'District Consumer Commission (e-Daakhil for service/vendor disputes up to ₹50 lakh) or Civil / Small Causes Court (rental deposits).',
    keyRights: [
      {
        title: 'No arbitrary penalty or blanket deduction without actual loss',
        detail: 'Under Indian contract principles, a party cannot enforce a punitive forfeit without proving reasonable actual loss. Blanket "1 month mandatory painting" clauses are heavily contested when normal wear and tear is documented.',
        citation: 'Indian Contract Act, 1872 s.74',
      },
      {
        title: 'WhatsApp & email confirmations count as written records',
        detail: 'A clear WhatsApp summary that the landlord or vendor confirms ("OK" / "Confirmed") plus UPI/bank UTR proofs can be adduced as electronic evidence with a BSA s.63 certificate.',
        citation: 'BSA 2023 s.63 & IT Act s.10A',
      },
      {
        title: 'Move-in photo & meter baseline shifts the burden of proof',
        detail: 'Sending dated move-in photos, wall condition notes, and electricity/water meter readings on Day 1 stops false damage claims at move-out.',
        citation: 'Practical evidentiary baseline',
      },
    ],
  },
  {
    id: 'IN-MH',
    country: 'IN',
    label: 'India — Maharashtra (Mumbai / Pune)',
    currency: 'INR',
    depositCapNote: 'Leave & License agreements in Maharashtra require registration under s.55 of the Maharashtra Rent Control Act; state the deposit, interest-free status, and refund trigger explicitly.',
    returnWindowDays: 15,
    returnWindowNote: 'Deposit should be refunded simultaneously at key handover or within an agreed 7–15 day window with itemized receipts.',
    electronicEvidenceLaw: 'BSA 2023 s.63 & IT Act s.10A (electronic records and message confirmations).',
    disputeForum: 'Competent Authority (Maharashtra Rent Control Act) or e-Daakhil Consumer Commission for vendors/caterers.',
    keyRights: [
      {
        title: 'Written & registered Leave & License protects both sides',
        detail: 'Section 55 of the Maharashtra Rent Control Act places the responsibility of registration on the landlord; an unregistered agreement weakens the landlord’s own claims.',
        citation: 'Maharashtra Rent Control Act, 1999 s.55',
      },
      {
        title: 'Deductions require itemized proof, not flat penalties',
        detail: 'Arbitrary forfeiture or unexplained deductions beyond actual damage or unpaid utility bills violate the principle of reasonable compensation.',
        citation: 'Indian Contract Act, 1872 s.74',
      },
      {
        title: 'Timestamped WhatsApp / email inventory creates an audit trail',
        detail: 'Attach a room-by-room condition list and UPI/NEFT references so move-out inspection compares against Day 1 facts.',
        citation: 'BSA 2023 s.63',
      },
    ],
  },
  {
    id: 'IN-TN',
    country: 'IN',
    label: 'India — Tamil Nadu (Chennai)',
    currency: 'INR',
    depositCapNote: 'TNRRRLT Act 2017 requires a written tenancy agreement registered with the Rent Authority; state the exact deposit and bank refund details.',
    returnWindowDays: 15,
    returnWindowNote: 'Under TNRRRLT norms, security deposit must be refunded at vacation after legitimate deductions with proper bills.',
    electronicEvidenceLaw: 'BSA 2023 s.63 & IT Act s.10A.',
    disputeForum: 'Tamil Nadu Rent Authority / Rent Court (tenancy) or e-Daakhil (catering/renovation/services).',
    keyRights: [
      {
        title: 'Written agreement & registration required under TNRRRLT',
        detail: 'Tamil Nadu’s Tenancy Act mandates written agreements registered on the state portal and provides a dedicated Rent Authority for deposit and eviction disputes.',
        citation: 'TNRRRLT Act, 2017',
      },
      {
        title: 'Only actual damage beyond normal wear & tear is deductible',
        detail: 'Standard wear from ordinary living is not damage; require actual vendor invoices before any amount is withheld.',
        citation: 'Indian Contract Act s.74 & TNRRRLT principles',
      },
      {
        title: 'Electronic messages & bank UTRs form admissible proof',
        detail: 'Preserve WhatsApp replies, handover photos, and UPI/IMPS receipts together in one chronological pack.',
        citation: 'BSA 2023 s.63',
      },
    ],
  },
  {
    id: 'IN-DL',
    country: 'IN',
    label: 'India — Delhi NCR',
    currency: 'INR',
    depositCapNote: 'Residential deposits in Delhi NCR typically range 1–2 months (matching Model Tenancy benchmarks); lock exact notice, wear-and-tear, and utility clearance rules.',
    returnWindowDays: 15,
    returnWindowNote: 'Specify simultaneous refund at key handover or within 7–15 days via bank transfer after final meter reading.',
    electronicEvidenceLaw: 'BSA 2023 s.63 & IT Act s.10A.',
    disputeForum: 'Civil Court / Consumer Commission (e-Daakhil for home services, catering, renovation).',
    keyRights: [
      {
        title: 'Reasonable compensation only — no windfall forfeiture',
        detail: 'Blanket forfeiture clauses are enforceable only to the extent of actual proven loss or unpaid dues.',
        citation: 'Indian Contract Act, 1872 s.74',
      },
      {
        title: 'Consumer services disputes can be filed online on e-Daakhil',
        detail: 'For catering, interiors, photography, or event vendors, written scope + payment UTRs + refusal messages support an e-Daakhil complaint up to ₹50 lakh at the District Commission.',
        citation: 'Consumer Protection Act, 2019',
      },
      {
        title: 'MSME suppliers have statutory 45-day payment & interest protection',
        detail: 'Udyam-registered micro and small freelancers/agencies can claim 3× RBI Bank Rate compound interest on delayed B2B invoices.',
        citation: 'MSMED Act, 2006 s.15–16',
      },
    ],
  },
  {
    id: 'IN-GEN',
    country: 'IN',
    label: 'India — All other states',
    currency: 'INR',
    depositCapNote: 'Model Tenancy Act 2021 recommends a 2-month cap for residential leases (adoption varies by state). Put exact refund days and itemized-bill rules in writing.',
    returnWindowDays: 15,
    returnWindowNote: 'Specify refund within 7–15 days of handing over keys and final utility meter clearance.',
    electronicEvidenceLaw: 'BSA 2023 s.63 & IT Act s.10A.',
    disputeForum: 'District Consumer Commission (e-Daakhil), MSME Samadhaan (B2B), or local Rent/Civil Court.',
    keyRights: [
      {
        title: 'Penalty clauses cannot exceed reasonable actual loss',
        detail: 'Even if a contract says "100% forfeited", courts examine whether actual damage or mitigation occurred.',
        citation: 'Indian Contract Act, 1872 s.74',
      },
      {
        title: 'Written WhatsApp / email confirmations are legally valid',
        detail: 'Under IT Act s.10A, an agreement is not invalid merely because it was formed through electronic messages.',
        citation: 'IT Act, 2000 s.10A & BSA 2023 s.63',
      },
      {
        title: 'Keep payment UTRs linked to milestones or move-in records',
        detail: 'Never pay large deposits or catering advances in unreceipted cash; pair every UPI/NEFT UTR with a dated confirmation message.',
        citation: 'Practical evidentiary baseline',
      },
    ],
  },
  {
    id: 'US-CA',
    country: 'US',
    label: 'United States — California',
    currency: 'USD',
    depositCapNote: 'Under AB 12 (effective July 2024), most residential landlords cannot charge more than 1 month’s rent as a security deposit.',
    returnWindowDays: 21,
    returnWindowNote: 'Landlord MUST return the deposit or send an itemized statement with receipts for deductions over $125 within 21 calendar days.',
    electronicEvidenceLaw: 'Federal ESIGN Act (15 U.S.C. § 7001) & California UETA (Cal. Civ. Code § 1633.7).',
    disputeForum: 'California Small Claims Court (up to $12,500 for individuals; no lawyers required).',
    keyRights: [
      {
        title: 'Strict 21-day return + receipts required over $125',
        detail: 'Landlords cannot make "non-refundable" security deposits or charge for ordinary wear and tear. Starting 2025 (AB 2801), landlords must also take move-in and move-out photos to claim deductions.',
        citation: 'Cal. Civ. Code § 1950.5 (AB 12 / AB 2801)',
      },
      {
        title: 'Up to 2× statutory damages for bad-faith retention',
        detail: 'If a landlord withholds a deposit in bad faith, a tenant can claim the withheld amount PLUS up to twice the deposit in statutory damages in Small Claims Court.',
        citation: 'Cal. Civ. Code § 1950.5(l)',
      },
      {
        title: 'Text and email confirmations are enforceable written records',
        detail: 'Electronic confirmations and dated move-in walkthrough photos sent by email/SMS create a timestamped baseline judges immediately understand.',
        citation: 'ESIGN Act & Cal. UETA',
      },
    ],
  },
  {
    id: 'US-NY',
    country: 'US',
    label: 'United States — New York',
    currency: 'USD',
    depositCapNote: 'Under NY HSTPA, residential security deposits are capped at 1 month’s rent.',
    returnWindowDays: 14,
    returnWindowNote: 'Landlord MUST return the deposit and an itemized list of any deductions within 14 calendar days, or they forfeit the right to retain ANY portion.',
    electronicEvidenceLaw: 'Federal ESIGN Act & NY Electronic Signatures and Records Act (ESRA).',
    disputeForum: 'New York Small Claims Court (up to $10,000 in NYC) or NY Attorney General mediation.',
    keyRights: [
      {
        title: 'Strict 14-day deadline — miss it and they owe 100% back',
        detail: 'If the landlord fails to provide an itemized statement and remaining deposit within 14 days of vacating, they legally forfeit any right to keep any part of the deposit.',
        citation: 'NY Gen. Oblig. Law § 7-108(1-a)(e)',
      },
      {
        title: 'Right to a pre-move-out walkthrough inspection',
        detail: 'Tenants have the right to request an inspection 1–2 weeks before vacating so they can cure itemized issues before move-out.',
        citation: 'NY Gen. Oblig. Law § 7-108(1-a)(d)',
      },
      {
        title: 'Up to 2× punitive damages for willful noncompliance',
        detail: 'Willful violation exposes the landlord to punitive damages up to twice the actual deposit.',
        citation: 'NY Gen. Oblig. Law § 7-108(1-a)(g)',
      },
    ],
  },
  {
    id: 'US-TX',
    country: 'US',
    label: 'United States — Texas',
    currency: 'USD',
    depositCapNote: 'Texas has no statutory deposit cap, so documenting the exact deposit and providing your written forwarding address on move-out is critical.',
    returnWindowDays: 30,
    returnWindowNote: 'Landlord has 30 days after surrender (and receipt of your written forwarding address) to refund or send a written itemized list.',
    electronicEvidenceLaw: 'Federal ESIGN Act & Texas UETA (Tex. Bus. & Com. Code Ch. 322).',
    disputeForum: 'Texas Justice Court (Small Claims up to $20,000).',
    keyRights: [
      {
        title: 'Always send your forwarding address in writing on move-out',
        detail: 'In Texas, the landlord’s 30-day statutory clock and bad-faith penalties depend on having your written forwarding address.',
        citation: 'Tex. Prop. Code § 92.107',
      },
      {
        title: 'Bad-faith withholding triggers $100 + 3× damages + attorney fees',
        detail: 'If a landlord retains a deposit in bad faith past 30 days, Texas law presumes bad faith and allows recovery of $100 plus triple the wrongfully withheld sum.',
        citation: 'Tex. Prop. Code § 92.109',
      },
      {
        title: 'Normal wear and tear cannot be deducted',
        detail: 'Landlords may not deduct for ordinary deterioration from intended use without negligence or abuse.',
        citation: 'Tex. Prop. Code § 92.104(b)',
      },
    ],
  },
  {
    id: 'US-GEN',
    country: 'US',
    label: 'United States — Other states',
    currency: 'USD',
    depositCapNote: 'Most US states cap deposits at 1–2 months and forbid deducting for ordinary wear and tear; check your state statute for exact day limits.',
    returnWindowDays: 30,
    returnWindowNote: 'Most US states mandate return + itemized deductions within 14 to 30 days of move-out and forwarding address notice.',
    electronicEvidenceLaw: 'Federal ESIGN Act (15 U.S.C. § 7001) & state UETA.',
    disputeForum: 'Local Small Claims Court (typically $5,000–$15,000, self-represented).',
    keyRights: [
      {
        title: 'Itemized deductions & ordinary wear-and-tear protection',
        detail: 'Across US states, security deposits cover actual unpaid rent or damage beyond normal wear and tear — never routine repainting between tenants.',
        citation: 'Standard US residential landlord-tenant rule',
      },
      {
        title: 'Email/SMS confirmations carry full written weight',
        detail: 'Under ESIGN/UETA, a clear email or text recap that the other party acknowledges is an enforceable written record.',
        citation: '15 U.S.C. § 7001 (ESIGN)',
      },
      {
        title: 'Move-in photos + written forwarding address win Small Claims',
        detail: 'Small Claims judges decide deposit cases on two things: Day-1 vs Day-last photos and a dated written return demand.',
        citation: 'Small Claims evidentiary standard',
      },
    ],
  },
];

export function scenarioById(id: string): ScenarioMeta {
  return SCENARIOS.find(s => s.id === id) ?? SCENARIOS[0];
}

export function jurisdictionById(id: string): JurisdictionRule {
  return JURISDICTIONS.find(j => j.id === id) ?? JURISDICTIONS[0];
}

type TrapRule = {
  id: string;
  scenarios: ScenarioId[] | 'all';
  severity: TrapSeverity;
  pattern: RegExp;
  title: string;
  whyItHurts: string;
  legalNote: (j: JurisdictionRule) => string;
  safeClause: (j: JurisdictionRule) => string;
};

const TRAP_RULES: TrapRule[] = [
  {
    id: 'painting-deduction',
    scenarios: ['rental'],
    severity: 'high',
    pattern: /(?:1|one)\s*month[^.\n]{0,50}(?:paint|clean|deduct|mainten)|(?:automatically|mandatory|compulsory)[^.\n]{0,40}(?:paint|clean|deduct)|(?:paint(?:ing)?|deep\s*clean(?:ing)?)\s*(?:charge|deduction)[^.\n]{0,40}(?:regardless|mandatory|fixed|flat)/i,
    title: 'Blanket painting / cleaning deduction regardless of condition',
    whyItHurts: 'Costs you an automatic month of rent even if you leave the home spotless and walls clean.',
    legalNote: j =>
      j.country === 'US'
        ? `${j.label}: Landlords generally cannot charge for ordinary wear and tear or routine repainting between tenants; deductions must be itemized actual damage.`
        : `${j.label}: Under Indian Contract Act s.74, a flat deduction disconnected from actual damage beyond normal wear and tear is challengeable unless supported by itemized bills.`,
    safeClause: () =>
      'Normal wear and tear is not deductible. Painting or repair costs may be deducted only for documented damage beyond normal wear and tear, supported by actual itemized vendor bills.',
  },
  {
    id: 'non-refundable-deposit',
    scenarios: ['rental', 'catering', 'event-vendor', 'renovation'],
    severity: 'high',
    pattern: /non[\s-]*refundable\s*(?:security\s*)?(?:deposit|advance|booking)|(?:strictly\s*)?non[\s-]*refundable|forfeit(?:ed|ure)?\s*(?:of\s*)?(?:full|entire|100%|the)?\s*(?:security\s*)?(?:deposit|advance)/i,
    title: 'Blanket "non-refundable" or 100% forfeiture clause',
    whyItHurts: 'Lets the other side keep your entire advance or security deposit even if they re-rent the flat or re-book the date with zero actual loss.',
    legalNote: j =>
      j.country === 'US'
        ? `${j.label}: Residential security deposits can NEVER be labelled "non-refundable" in California/New York and most US states; vendor cancellation fees must reflect reasonable liquidated damages.`
        : `${j.label}: Under Indian Contract Act s.74, courts restrict forfeiture to reasonable compensation for actual loss proved, not a punitive windfall.`,
    safeClause: j =>
      j.country === 'US'
        ? 'Security deposit is fully refundable within ' + j.returnWindowDays + ' days of move-out, less only itemized actual damage beyond ordinary wear and tear or unpaid rent.'
        : 'Advance/deposit is refundable subject only to documented actual costs incurred or agreed tiered cancellation notice (e.g., 100% refund >30 days out, 50% refund 15–30 days out).',
  },
  {
    id: 'discretionary-refund',
    scenarios: ['rental', 'catering', 'renovation', 'event-vendor', 'freelance'],
    severity: 'high',
    pattern: /(?:landlord|owner|vendor|client|company)['’]?s\s*(?:sole\s*)?(?:discretion|satisfaction)|fully\s*satisfied|after\s*inspection\s*(?:only|as\s*decided)|as\s*and\s*when/i,
    title: 'Subjective or "at discretion" refund / payment trigger',
    whyItHurts: 'Gives the paying party an unlimited excuse to stall your refund or final payment indefinitely.',
    legalNote: j =>
      `Replace subjective triggers with an objective calendar deadline (${j.returnWindowDays} days for deposits in ${j.label}; fixed acceptance window for deliverables).`,
    safeClause: j =>
      `Refund/payment will be settled via bank transfer within ${j.returnWindowDays} calendar days of handover or delivery, with any objection stated in writing within 5 working days.`,
  },
  {
    id: 'uncapped-overage',
    scenarios: ['catering', 'event-vendor'],
    severity: 'high',
    pattern: /extra\s*(?:guests?|plates?|hours?)[^.\n]{0,45}(?:as\s*applicable|actuals?|decided|extra\s*cost)|(?:approximate|around|roughly)\s*\d+\s*(?:guests?|plates?)/i,
    title: 'Uncapped extra-plate or overtime pricing ("as applicable")',
    whyItHurts: 'The #1 wedding and event billing shock: caterers or venues charge 1.5×–2× on the day for every extra guest or hour when no rate cap is written.',
    legalNote: () =>
      'Lock a guaranteed minimum count, a complimentary buffer (e.g., 5–10%), and an exact fixed per-plate or per-hour overage rate signed before the event.',
    safeClause: () =>
      'Guaranteed minimum headcount is locked 72 hours prior. Up to 10% extra plates are supplied at the same per-plate rate; any count beyond 10% requires host sign-off at the fixed rate card.',
  },
  {
    id: 'cash-only',
    scenarios: 'all',
    severity: 'high',
    pattern: /\bcash\s*(?:only|before|payment|advance)\b|in\s*cash\b/i,
    title: 'Unreceipted cash payment demand',
    whyItHurts: 'Cash with no signed receipt or UTR makes it almost impossible to prove you paid if a dispute reaches court or e-Daakhil.',
    legalNote: j =>
      `${j.electronicEvidenceLaw} Bank transfers (UPI/NEFT/ACH/Zelle) create automatic third-party proof of payment.`,
    safeClause: () =>
      'All deposits, advances, and stage payments are made via bank transfer / UPI with transaction reference (UTR) recorded on the agreement, or against an immediately signed receipt.',
  },
  {
    id: 'vague-materials-or-menu',
    scenarios: ['renovation', 'catering'],
    severity: 'medium',
    pattern: /(?:good|best|standard|branded)\s*(?:quality|materials?|plywood|hardware|buffet|menu|items?)|billed\s*as\s*actuals/i,
    title: 'Unspecified material brands, grades, or menu items',
    whyItHurts: '"Good quality plywood" or "standard buffet" lets the vendor swap in cheap substitutes while charging premium prices.',
    legalNote: () =>
      'Name exact brands, grades (e.g., BWP IS:710 plywood, Hettich hinges), or exact dish counts in the itemized deliverables list.',
    safeClause: () =>
      'All materials/menu items must match the exact brand, grade, and count listed in the attached schedule. Any substitution or extra work requires written approval and price sign-off beforehand.',
  },
  {
    id: 'open-ended-scope',
    scenarios: 'all',
    severity: 'high',
    pattern: /\bunlimited\b|\betc\.?\b|\band\s*(?:so\s*on|more)\b|\bas\s*(?:needed|required)\b|\ball\s*necessary\b/i,
    title: 'Open-ended or "unlimited" obligation',
    whyItHurts: 'Leaves the boundary wide open so either side can argue unlimited extra work or zero accountability.',
    legalNote: () =>
      'Replace open-ended words with exact numbers, units, and a written change-order rule.',
    safeClause: () =>
      'Only the numbered items and exact quantities listed are included. Any additional item or revision round requires a written change order with agreed price and timeline.',
  },
  {
    id: 'heavy-upfront',
    scenarios: ['renovation', 'catering', 'event-vendor'],
    severity: 'medium',
    pattern: /(?:60|70|75|80|90|100)\s*%\s*(?:upfront|advance|before\s*start)/i,
    title: 'Excessive upfront payment before work or delivery',
    whyItHurts: 'Once a contractor or vendor holds 60–100% upfront, you lose all leverage if work stalls or quality drops.',
    legalNote: () =>
      'Tie payments to measurable stage inspections (e.g., 10–20% booking, 30–40% on material/stage sign-off, final 15–20% strictly at handover).',
    safeClause: () =>
      'Payments are split across verified milestones: booking advance capped at 20–30%, middle stages released only after signed inspection, and final 15–20% payable upon complete handover.',
  },
];

type MissingCheck = {
  id: string;
  scenarios: ScenarioId[];
  present: RegExp;
  title: string;
  safeClause: (j: JurisdictionRule) => string;
};

const MISSING_CHECKS: MissingCheck[] = [
  {
    id: 'missing-return-window',
    scenarios: ['rental'],
    present: /\b\d+\s*(?:calendar\s*|working\s*)?days?\b[^.\n]{0,40}(?:refund|return)|(?:refund|return)[^.\n]{0,40}\b\d+\s*(?:calendar\s*|working\s*)?days?\b|at\s*(?:the\s*time\s*of\s*)?(?:key\s*)?handover/i,
    title: 'No fixed deadline for returning the security deposit',
    safeClause: j =>
      `The security deposit will be refunded via bank transfer within ${j.returnWindowDays} calendar days of key handover, accompanied by itemized bills for any lawful deduction.`,
  },
  {
    id: 'missing-inventory',
    scenarios: ['rental'],
    present: /inventory|move[\s-]*in\s*(?:photo|video|checklist|condition)|meter\s*reading|wear\s*and\s*tear/i,
    title: 'No move-in condition photo/inventory baseline or normal wear-and-tear clause',
    safeClause: () =>
      'Both parties acknowledge the dated move-in photo checklist and electricity/water meter readings. Ordinary wear and tear from normal residential use is excluded from deductions.',
  },
  {
    id: 'missing-catering-staff',
    scenarios: ['catering'],
    present: /staff|server|waiter|crockery|setup\s*time|tasting/i,
    title: 'No service staff count, crockery, or setup deadline listed',
    safeClause: () =>
      'Caterer provides uniformed service staff (1 per 20 guests), chafing dishes, crockery, cutlery, and drinking water, with full buffet setup completed 60 minutes before event start.',
  },
  {
    id: 'missing-change-order',
    scenarios: ['renovation', 'freelance', 'event-vendor'],
    present: /change\s*order|written\s*(?:approval|variation|consent)|prior\s*approval/i,
    title: 'No written change-order rule for extra charges',
    safeClause: () =>
      'No extra charge or variation is valid unless approved in writing with its fixed price and delivery impact before the extra work starts.',
  },
];

/** Pure clause & risk analyzer for any scenario and jurisdiction. */
export function analyzeAgreementText(
  text: string,
  scenarioId: ScenarioId,
  jurisdictionId: JurisdictionId,
): ShieldReport {
  const scenario = scenarioById(scenarioId);
  const jurisdiction = jurisdictionById(jurisdictionId);
  const cleaned = text.trim();

  const findings: TrapFinding[] = [];
  for (const rule of TRAP_RULES) {
    if (rule.scenarios !== 'all' && !rule.scenarios.includes(scenarioId)) continue;
    const match = cleaned.match(rule.pattern);
    if (!match) continue;
    findings.push({
      id: rule.id,
      severity: rule.severity,
      title: rule.title,
      excerpt: match[0].trim(),
      whyItHurts: rule.whyItHurts,
      legalContext: rule.legalNote(jurisdiction),
      safeClause: rule.safeClause(jurisdiction),
    });
  }

  const missingProtections: ShieldReport['missingProtections'] = [];
  if (cleaned.length >= 20) {
    for (const check of MISSING_CHECKS) {
      if (!check.scenarios.includes(scenarioId)) continue;
      if (!check.present.test(cleaned)) {
        missingProtections.push({
          id: check.id,
          title: check.title,
          safeClause: check.safeClause(jurisdiction),
        });
      }
    }
  }

  const sevRank: Record<TrapSeverity, number> = {high: 0, medium: 1, info: 2};
  findings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

  const penalty =
    findings.reduce((sum, f) => sum + (f.severity === 'high' ? 28 : f.severity === 'medium' ? 14 : 6), 0) +
    missingProtections.length * 10;
  const score = cleaned.length < 20 ? 100 : Math.max(0, 100 - penalty);
  const riskLevel: ShieldReport['riskLevel'] =
    findings.some(f => f.severity === 'high') || score < 55
      ? 'high'
      : findings.length > 0 || missingProtections.length > 0
        ? 'moderate'
        : 'protected';

  return {scenario, jurisdiction, riskLevel, score, findings, missingProtections};
}

/**
 * Generates the 3-Level Friction Ladder so users are NEVER stuck when the other side
 * (landlord, caterer, contractor, or busy client) refuses to sign a formal contract.
 */
export function buildEscalationLadder(input: EscalationInput): EscalationLadder {
  const j = jurisdictionById(input.jurisdiction);
  const party = input.partyName.trim() || (input.scenario === 'rental' ? 'Landlord' : input.scenario === 'catering' ? 'Caterer' : 'Vendor');
  const you = input.yourName.trim() || 'Tenant / Host';
  const subject = input.subject.trim() || scenarioById(input.scenario).label;
  const amtText = input.amount > 0 ? formatMoney(input.amount, j.currency) : '[amount]';
  const dateText = input.date.trim() || '[date]';

  let waBody: string;
  let noticeBody: string;
  let checklist: string[];

  if (input.scenario === 'rental') {
    waBody = [
      `Hi ${party}, thanks for handing over ${subject}!`,
      `Just putting our key move-in details in one message so both of us have it handy:`,
      `• Security deposit paid: ${amtText} (bank/UPI reference attached)`,
      `• Move-in date & photos: ${dateText} (sharing wall, appliance & meter photos right below)`,
      `• Deposit return: within ${j.returnWindowDays} days of key handover, less only actual itemized bills for damage beyond normal wear and tear`,
      `Please reply "Confirmed" if this looks right to you. Thank you!`,
    ].join('\n');

    checklist = [
      'Walk through every room on Day 1 and record a continuous video + photos of walls, switches, plumbing, geysers/AC, and paint.',
      'Photograph electricity, water, and gas meter readings on move-in day and send them in the same WhatsApp/email thread.',
      'Pay the security deposit ONLY via UPI / NEFT / bank transfer (write "Security Deposit — [Flat Address]" in the remark) and save the UTR.',
      'On move-out, repeat the photo walkthrough and send your written bank/forwarding details the same day you return the keys.',
    ];

    noticeBody = [
      `RECORD OF MOVE-IN & SECURITY DEPOSIT TERMS`,
      `Date: ${dateText} | Jurisdiction: ${j.label}`,
      `Property: ${subject}`,
      `Tenant: ${you} | Owner/Landlord: ${party}`,
      `Security Deposit: ${amtText} (paid via traceable bank transfer / UTR)`,
      ``,
      `1. Condition baseline: Dated move-in photographs, fixture inventory, and utility meter readings were recorded and shared with ${party} on ${dateText}.`,
      `2. Return terms: The security deposit is refundable upon key handover within ${j.returnWindowDays} calendar days (${j.returnWindowNote}).`,
      `3. Deductions: Normal wear and tear is excluded. Any deduction must be supported by actual itemized repair bills or unpaid utility statements.`,
      `4. Statutory note: ${j.keyRights[0]?.title} (${j.keyRights[0]?.citation}).`,
      input.notes?.trim() ? `5. Notes: ${input.notes.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  } else if (input.scenario === 'catering') {
    waBody = [
      `Hi ${party}, excited to confirm catering for ${subject} on ${dateText}!`,
      `Quick recap of what we agreed so there’s zero confusion on the day:`,
      `• Total agreed budget / advance: ${amtText}`,
      `• Final menu, tasting & guaranteed plate count locked 72 hrs prior`,
      `• Extra plates (up to 10% buffer) billed at the same per-plate rate; any extra charges only with written OK`,
      `• Full setup & uniformed service staff ready 60 mins before event start`,
      `Please reply "Confirmed" so I can transfer the booking advance. Thanks!`,
    ].join('\n');

    checklist = [
      'Screenshot or save the exact itemized dish list (starters, mains, desserts, live counters, water) before paying the advance.',
      'Lock the guaranteed plate count, per-plate overage rate, and headcount counting method (plate count vs coupon) in writing.',
      'Transfer the advance via UPI/bank with event date in the remark and keep the final 20% payable only upon service completion.',
    ];

    noticeBody = [
      `CATERING AGREEMENT SUMMARY RECORD`,
      `Event: ${subject} | Date: ${dateText}`,
      `Host: ${you} | Caterer: ${party}`,
      `Agreed Value: ${amtText} | Jurisdiction: ${j.label}`,
      ``,
      `1. Menu & quality: Confirmed itemized dish list and tasting standard attached.`,
      `2. Headcount & overage: Guaranteed count locked 72 hours prior; extra plates billed strictly at agreed per-plate rate.`,
      `3. Logistics: Uniformed service staff, crockery, and setup completed 60 minutes before start.`,
      `4. Payment & cancellation: Traceable bank/UPI payments with UTRs; cancellation refunds follow agreed notice tiers.`,
    ].join('\n');
  } else {
    waBody = [
      `Hi ${party}, putting our agreed terms for ${subject} (${dateText}) in one quick message so we’re both aligned:`,
      `• Agreed total: ${amtText}`,
      `• Exact deliverables, timeline & material/acceptance standard as discussed`,
      `• Any extra work or price change only after written OK from both sides`,
      `Please reply "Confirmed" and we’re good to go!`,
    ].join('\n');

    checklist = [
      'Save the itemized scope / BOQ with exact quantities, brands, or acceptance criteria before paying the first milestone.',
      'Log every variation or extra request as a written change order with price + date impact before work starts.',
      'Pair every milestone transfer with a dated photo/delivery sign-off and bank UTR.',
    ];

    noticeBody = [
      `AGREEMENT & SCOPE SUMMARY RECORD`,
      `Project: ${subject} | Target Date: ${dateText}`,
      `Party A: ${you} | Party B: ${party}`,
      `Agreed Amount: ${amtText} | Jurisdiction: ${j.label}`,
      ``,
      `1. Scope: Itemized deliverables and acceptance standards as recorded.`,
      `2. Variations: No extra cost is valid without prior written approval.`,
      `3. Evidence: Electronic confirmations and payment UTRs preserved under ${j.electronicEvidenceLaw}`,
    ].join('\n');
  }

  return {
    level1WhatsApp: {
      title: 'Level 1 · The 10-second WhatsApp soft confirm (best when they hate formal apps)',
      whyItWorks:
        'A landlord or caterer who refuses a 6-page PDF will almost always reply "Yes / Confirmed" to a polite 5-line WhatsApp recap — and that reply + your bank UTR is valid written proof.',
      message: waBody,
      waHref: 'https://wa.me/?text=' + encodeURIComponent(waBody),
    },
    level2Link: {
      title: 'Level 2 · 1-Tap Scopeflow review link (no account needed for them)',
      whyItWorks:
        'Turn this into a clean, version-locked Scopeflow agreement. They read it on their phone in 20 seconds and tap Approve — sealed with a verifiable SHA-256 fingerprint.',
      actionLabel: 'Open pre-filled in Scopeflow editor',
    },
    level3Unilateral: {
      title: 'Level 3 · Unilateral timestamped record (if they still refuse to sign or reply)',
      whyItWorks:
        'Even if a landlord or vendor refuses to sign anything, a dated Day-1 photo inventory + bank UTR + timestamped notice shifts the burden of proof in Small Claims, Rent Court, or e-Daakhil.',
      checklist,
      noticeTemplate: noticeBody,
    },
  };
}
