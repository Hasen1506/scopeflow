import { z } from 'zod';
import { formatMoney } from './currency';
import { jurisdictionById, type JurisdictionId, type ShieldCurrency } from './legal-shield';
import { blank, itemLine, type Item, type Scope } from './scope';

export type CollectionKind =
  | 'marriage'
  | 'intimate-wedding'
  | 'home-renovation'
  | 'apartment-move'
  | 'custom';

export type SubEventStatus = 'planning' | 'locked' | 'completed';

export type VendorCategory =
  | 'catering'
  | 'venue'
  | 'photography'
  | 'decor'
  | 'makeup'
  | 'music-dj'
  | 'transport'
  | 'priest-officiant'
  | 'contractor'
  | 'landlord'
  | 'other';

export type VendorAgreementStatus = 'draft' | 'whatsapp-sent' | 'confirmed' | 'disputed';

export interface SubEvent {
  id: string;
  collectionId: string;
  sortOrder: number;
  title: string;
  eventDate: string;
  timeSlot: string;
  venueName: string;
  venueAddress: string;
  guestCount: number;
  coordinatorName: string;
  coordinatorPhone: string;
  status: SubEventStatus;
  notes: string;
}

export interface EventVendor {
  id: string;
  collectionId: string;
  subEventId: string | null;
  category: VendorCategory;
  vendorName: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  whatsappNumber: string;
  agreedFee: number;
  advancePaid: number;
  paymentDueDate: string;
  utrReference: string;
  agreementStatus: VendorAgreementStatus;
  clauseSummary: string;
  deliverables: string;
}

export interface EventCollection {
  id: string;
  kind: CollectionKind;
  title: string;
  jurisdiction: JurisdictionId;
  currency: ShieldCurrency;
  startDate: string;
  endDate: string;
  city: string;
  primaryContactName: string;
  primaryContactPhone: string;
  notes: string;
  subEvents: SubEvent[];
  vendors: EventVendor[];
}

export const VENDOR_CATEGORY_META: Record<VendorCategory, { label: string; checkScenario: string }> = {
  catering: { label: 'Catering & Food', checkScenario: 'catering' },
  venue: { label: 'Venue / Banquet Hall', checkScenario: 'event-vendor' },
  photography: { label: 'Photo & Video', checkScenario: 'event-vendor' },
  decor: { label: 'Decor & Florals', checkScenario: 'event-vendor' },
  makeup: { label: 'Bridal Makeup & Hair', checkScenario: 'event-vendor' },
  'music-dj': { label: 'DJ, Band & Sound', checkScenario: 'event-vendor' },
  transport: { label: 'Travel, Baraat & Valet', checkScenario: 'event-vendor' },
  'priest-officiant': { label: 'Priest / Officiant', checkScenario: 'event-vendor' },
  contractor: { label: 'Contractor / Interiors', checkScenario: 'renovation' },
  landlord: { label: 'Landlord / Broker', checkScenario: 'rental' },
  other: { label: 'Other Vendor', checkScenario: 'freelance' },
};

export const VENDOR_STATUS_LABEL: Record<VendorAgreementStatus, string> = {
  draft: 'Draft / Unprotected',
  'whatsapp-sent': 'WhatsApp Sent',
  confirmed: 'Terms Locked',
  disputed: 'Needs Attention',
};

export const SUB_EVENT_STATUS_LABEL: Record<SubEventStatus, string> = {
  planning: 'Planning',
  locked: 'Vendors Locked',
  completed: 'Completed',
};

export interface CollectionBlueprint {
  kind: CollectionKind;
  name: string;
  badge: string;
  description: string;
  defaultTitle: string;
  defaultCity: string;
  subEventPresets: Omit<SubEvent, 'id' | 'collectionId' | 'sortOrder'>[];
  vendorPresets: (Omit<EventVendor, 'id' | 'collectionId' | 'subEventId'> & { subEventIndex: number | null })[];
}

export const COLLECTION_BLUEPRINTS: readonly CollectionBlueprint[] = [
  {
    kind: 'marriage',
    name: 'Marriage Event (Full 6-Sub-Event Chain)',
    badge: 'Most Popular · 6 Sub-Events',
    description:
      'One hub for Engagement, Mehendi, Haldi, Sangeet, Wedding Ceremony, and Reception — with every vendor phone, contact person, venue, guest count, advance paid, and WhatsApp lock tracked together.',
    defaultTitle: 'Mehta–Kapoor Wedding',
    defaultCity: 'Bengaluru',
    subEventPresets: [
      {
        title: 'Engagement & Ring Ceremony',
        eventDate: '',
        timeSlot: '6:30 PM – 10:30 PM',
        venueName: 'The Courtyard Lawn',
        venueAddress: 'Indiranagar, Bengaluru',
        guestCount: 150,
        coordinatorName: 'Rohan Mehta',
        coordinatorPhone: '+91 98450 11223',
        status: 'planning',
        notes: 'Ring exchange at 7:30 PM; cocktail starters start at 6:45 PM.',
      },
      {
        title: 'Mehendi Afternoon',
        eventDate: '',
        timeSlot: '1:00 PM – 5:30 PM',
        venueName: 'Poolside Veranda',
        venueAddress: 'Indiranagar, Bengaluru',
        guestCount: 90,
        coordinatorName: 'Neha Kapoor',
        coordinatorPhone: '+91 98450 22334',
        status: 'planning',
        notes: 'Organic Rajasthani henna only; chilled mocktails and chaat counter.',
      },
      {
        title: 'Haldi Morning',
        eventDate: '',
        timeSlot: '10:00 AM – 1:30 PM',
        venueName: 'Garden Pavilion',
        venueAddress: 'Whitefield, Bengaluru',
        guestCount: 120,
        coordinatorName: 'Neha Kapoor',
        coordinatorPhone: '+91 98450 22334',
        status: 'planning',
        notes: 'Marigold backdrop + water-resistant seating covers; traditional brunch.',
      },
      {
        title: 'Sangeet & Cocktail Night',
        eventDate: '',
        timeSlot: '7:00 PM – 11:30 PM',
        venueName: 'Grand Ballroom',
        venueAddress: 'Whitefield, Bengaluru',
        guestCount: 250,
        coordinatorName: 'Rohan Mehta',
        coordinatorPhone: '+91 98450 11223',
        status: 'planning',
        notes: 'Sound check by 5:00 PM; DJ curfew at 11:30 PM sharp.',
      },
      {
        title: 'Wedding Ceremony (Muhurtham / Pheras)',
        eventDate: '',
        timeSlot: '8:30 AM – 1:00 PM',
        venueName: 'Heritage Mandap Hall',
        venueAddress: 'Whitefield, Bengaluru',
        guestCount: 350,
        coordinatorName: 'Arvind Mehta',
        coordinatorPhone: '+91 98450 33445',
        status: 'planning',
        notes: 'Baraat arrival 8:30 AM; Muhurtham 10:15 AM; banana-leaf / sit-down lunch.',
      },
      {
        title: 'Reception Dinner',
        eventDate: '',
        timeSlot: '7:00 PM – 11:00 PM',
        venueName: 'Royal Banquet & Lawn',
        venueAddress: 'Whitefield, Bengaluru',
        guestCount: 400,
        coordinatorName: 'Arvind Mehta',
        coordinatorPhone: '+91 98450 33445',
        status: 'planning',
        notes: '14-dish buffet + 3 live counters; strict plate coupon count.',
      },
    ],
    vendorPresets: [
      {
        subEventIndex: 5,
        category: 'catering',
        vendorName: 'Saffron Kitchen Catering',
        contactPerson: 'Vikram Shetty',
        contactPhone: '+91 98801 44556',
        contactEmail: 'vikram@saffronkitchen.example',
        whatsappNumber: '+91 98801 44556',
        agreedFee: 340000,
        advancePaid: 85000,
        paymentDueDate: '',
        utrReference: 'UTR42901847261',
        agreementStatus: 'confirmed',
        clauseSummary: '400 guaranteed plates @ ₹850/plate; +10% buffer at same rate; no surprise service charge.',
        deliverables: '14-dish dinner buffet, 3 live counters, uniformed service staff, crockery & kitchen cleanup',
      },
      {
        subEventIndex: 3,
        category: 'music-dj',
        vendorName: 'Pulse Live Sound & DJ',
        contactPerson: 'Kabir Malhotra',
        contactPhone: '+91 98802 55667',
        contactEmail: 'kabir@pulselive.example',
        whatsappNumber: '+91 98802 55667',
        agreedFee: 75000,
        advancePaid: 25000,
        paymentDueDate: '',
        utrReference: '',
        agreementStatus: 'whatsapp-sent',
        clauseSummary: 'Sound check by 5 PM, backup mixer/mics included, overtime capped at ₹5,000/hr only if approved.',
        deliverables: 'DJ console, 12kW line-array audio, dancefloor lighting truss & 4 wireless mics',
      },
      {
        subEventIndex: 4,
        category: 'decor',
        vendorName: 'Marigold & Loom Decor',
        contactPerson: 'Priya Menon',
        contactPhone: '+91 98803 66778',
        contactEmail: 'priya@marigoldloom.example',
        whatsappNumber: '+91 98803 66778',
        agreedFee: 210000,
        advancePaid: 60000,
        paymentDueDate: '',
        utrReference: '',
        agreementStatus: 'draft',
        clauseSummary: 'Fresh florals per moodboard; setup finished 2 hours before Muhurtham; no hidden generator fee.',
        deliverables: 'Mandap floral architecture, Haldi marigold wall, Sangeet stage backdrop & entrance walkway',
      },
      {
        subEventIndex: null,
        category: 'photography',
        vendorName: 'Frame & Light Collective',
        contactPerson: 'Ananya Deshmukh',
        contactPhone: '+91 98804 77889',
        contactEmail: 'ananya@framelight.example',
        whatsappNumber: '+91 98804 77889',
        agreedFee: 185000,
        advancePaid: 55000,
        paymentDueDate: '',
        utrReference: '',
        agreementStatus: 'draft',
        clauseSummary: 'Full 6-event coverage (2 candid + 2 cine), 500 edited photos within 30 days, backup camera bodies.',
        deliverables: '6-event candid photo & cinema team, 5-min teaser in 7 days, full gallery & wedding film in 30 days',
      },
    ],
  },
  {
    kind: 'intimate-wedding',
    name: 'Intimate Wedding (2-Day / 3 Sub-Events)',
    badge: '3 Sub-Events',
    description:
      'Streamlined Haldi, Wedding Ceremony, and Reception Dinner pack for 80–150 guests with catering, decor, and photography contracts linked in one place.',
    defaultTitle: 'Intimate Family Wedding',
    defaultCity: 'Mumbai',
    subEventPresets: [
      {
        title: 'Haldi & Mehendi Brunch',
        eventDate: '',
        timeSlot: '10:30 AM – 2:30 PM',
        venueName: 'Terrace Garden',
        venueAddress: 'Bandra West, Mumbai',
        guestCount: 80,
        coordinatorName: 'Family Coordinator',
        coordinatorPhone: '+91 98200 10101',
        status: 'planning',
        notes: 'Daytime floral setup and light brunch buffet.',
      },
      {
        title: 'Wedding Ceremony',
        eventDate: '',
        timeSlot: '5:00 PM – 8:00 PM',
        venueName: 'Sea-View Courtyard',
        venueAddress: 'Juhu, Mumbai',
        guestCount: 120,
        coordinatorName: 'Family Coordinator',
        coordinatorPhone: '+91 98200 10101',
        status: 'planning',
        notes: 'Sunset ceremony; acoustic shehnai and mandap seating.',
      },
      {
        title: 'Reception Dinner',
        eventDate: '',
        timeSlot: '8:00 PM – 11:30 PM',
        venueName: 'Sea-View Courtyard',
        venueAddress: 'Juhu, Mumbai',
        guestCount: 150,
        coordinatorName: 'Family Coordinator',
        coordinatorPhone: '+91 98200 10101',
        status: 'planning',
        notes: 'Sit-down dinner with fixed per-plate cap.',
      },
    ],
    vendorPresets: [
      {
        subEventIndex: 2,
        category: 'catering',
        vendorName: 'Coastal Spice Caterers',
        contactPerson: 'Suresh Kulkarni',
        contactPhone: '+91 98201 20202',
        contactEmail: '',
        whatsappNumber: '+91 98201 20202',
        agreedFee: 165000,
        advancePaid: 40000,
        paymentDueDate: '',
        utrReference: '',
        agreementStatus: 'draft',
        clauseSummary: '150 guaranteed plates; extra plates billed at identical per-plate rate.',
        deliverables: 'Brunch + reception buffet, service staff, crockery, drinking water & cleanup',
      },
      {
        subEventIndex: null,
        category: 'photography',
        vendorName: 'Golden Hour Studios',
        contactPerson: 'Meera Joshi',
        contactPhone: '+91 98202 30303',
        contactEmail: '',
        whatsappNumber: '+91 98202 30303',
        agreedFee: 95000,
        advancePaid: 30000,
        paymentDueDate: '',
        utrReference: '',
        agreementStatus: 'draft',
        clauseSummary: '2-day coverage, edited gallery in 21 days, 20% held until final delivery.',
        deliverables: '2 photographers + 1 videographer across 3 sub-events, 350 edited photos & highlight film',
      },
    ],
  },
  {
    kind: 'home-renovation',
    name: 'Home Renovation & Interiors Chain',
    badge: '4 Work Stages',
    description:
      'Track Civil/Electrical, Modular Kitchen, Wardrobes, and Painting contractors in one hub with brand locks, site supervisor phone numbers, and stage payments.',
    defaultTitle: '2BHK Home Renovation',
    defaultCity: 'Bengaluru',
    subEventPresets: [
      {
        title: 'Stage 1: Civil, Plumbing & Electrical',
        eventDate: '',
        timeSlot: 'Week 1–2',
        venueName: 'Site Flat 402',
        venueAddress: 'HSR Layout, Bengaluru',
        guestCount: 0,
        coordinatorName: 'Site Supervisor',
        coordinatorPhone: '+91 99001 11223',
        status: 'planning',
        notes: 'Concealed wiring (Finolex/Polycab) and pressure-tested plumbing before plaster.',
      },
      {
        title: 'Stage 2: Modular Kitchen & Carpentry',
        eventDate: '',
        timeSlot: 'Week 3–5',
        venueName: 'Site Flat 402',
        venueAddress: 'HSR Layout, Bengaluru',
        guestCount: 0,
        coordinatorName: 'Site Supervisor',
        coordinatorPhone: '+91 99001 11223',
        status: 'planning',
        notes: 'BWP IS:710 plywood & Hettich soft-close channels verified on site before cutting.',
      },
      {
        title: 'Stage 3: Painting, Deep Clean & Snag Handover',
        eventDate: '',
        timeSlot: 'Week 6',
        venueName: 'Site Flat 402',
        venueAddress: 'HSR Layout, Bengaluru',
        guestCount: 0,
        coordinatorName: 'Homeowner',
        coordinatorPhone: '+91 99001 11223',
        status: 'planning',
        notes: '15% final retention released only after snag-list sign-off.',
      },
    ],
    vendorPresets: [
      {
        subEventIndex: 1,
        category: 'contractor',
        vendorName: 'Studio Craft Interiors',
        contactPerson: 'Deepak Verma',
        contactPhone: '+91 99002 44556',
        contactEmail: '',
        whatsappNumber: '+91 99002 44556',
        agreedFee: 450000,
        advancePaid: 67500,
        paymentDueDate: '',
        utrReference: '',
        agreementStatus: 'draft',
        clauseSummary: 'Written-only variations; brand inspection before installation; 15% held until final handover.',
        deliverables: 'Modular kitchen, 2 wardrobes, TV unit, false ceiling & final deep clean',
      },
    ],
  },
  {
    kind: 'apartment-move',
    name: 'Apartment Move-In & Deposit Hub',
    badge: 'Deposit Shield',
    description:
      'Keep your Landlord, Broker, Movers, and Day-1 inspection milestones linked with phone numbers, UPI UTR references, and refund deadlines.',
    defaultTitle: 'Flat 402 Move-In & Deposit Record',
    defaultCity: 'Bengaluru',
    subEventPresets: [
      {
        title: 'Deposit Transfer & Lease Baseline',
        eventDate: '',
        timeSlot: 'Before Move-In',
        venueName: 'Flat 402, Palm Grove',
        venueAddress: 'Indiranagar, Bengaluru',
        guestCount: 0,
        coordinatorName: 'Tenant',
        coordinatorPhone: '',
        status: 'planning',
        notes: 'Log bank/UPI UTR and confirm 15-day refund window after key handover.',
      },
      {
        title: 'Day-1 Photos, Keys & Meter Readings',
        eventDate: '',
        timeSlot: 'Move-In Day',
        venueName: 'Flat 402, Palm Grove',
        venueAddress: 'Indiranagar, Bengaluru',
        guestCount: 0,
        coordinatorName: 'Tenant',
        coordinatorPhone: '',
        status: 'planning',
        notes: 'Timestamp wall, flooring, appliance, electricity & water meter photos on WhatsApp.',
      },
    ],
    vendorPresets: [
      {
        subEventIndex: 0,
        category: 'landlord',
        vendorName: 'Rajesh Sharma (Property Owner)',
        contactPerson: 'Rajesh Sharma',
        contactPhone: '+91 98451 99887',
        contactEmail: '',
        whatsappNumber: '+91 98451 99887',
        agreedFee: 150000,
        advancePaid: 150000,
        paymentDueDate: '',
        utrReference: '',
        agreementStatus: 'draft',
        clauseSummary: 'Refundable deposit returned within 15 days; no blanket painting deduction; itemized bills only.',
        deliverables: 'Working appliances, 2 key sets, parking slot & written deposit refund commitment',
      },
    ],
  },
  {
    kind: 'custom',
    name: 'Custom Multi-Event Collection',
    badge: 'Start Blank',
    description:
      'Corporate offsite, festival, family milestone, or multi-vendor project — add your own sub-events and vendors from scratch.',
    defaultTitle: 'New Event Collection',
    defaultCity: '',
    subEventPresets: [
      {
        title: 'Event Day 1',
        eventDate: '',
        timeSlot: '',
        venueName: '',
        venueAddress: '',
        guestCount: 50,
        coordinatorName: '',
        coordinatorPhone: '',
        status: 'planning',
        notes: '',
      },
    ],
    vendorPresets: [],
  },
];

export function makeId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${rand}`;
}

export function createCollectionFromBlueprint(
  kind: CollectionKind,
  opts?: { title?: string; city?: string; jurisdiction?: JurisdictionId },
): EventCollection {
  const bp = COLLECTION_BLUEPRINTS.find((b) => b.kind === kind) ?? COLLECTION_BLUEPRINTS[0];
  const jurisdiction: JurisdictionId = opts?.jurisdiction ?? 'IN-KA';
  const j = jurisdictionById(jurisdiction);
  const collectionId = makeId('evc');

  const subEvents: SubEvent[] = bp.subEventPresets.map((preset, idx) => ({
    ...preset,
    id: makeId('sub'),
    collectionId,
    sortOrder: idx,
  }));

  const vendors: EventVendor[] = bp.vendorPresets.map((preset) => {
    const { subEventIndex, ...rest } = preset;
    return {
      ...rest,
      id: makeId('vnd'),
      collectionId,
      subEventId:
        subEventIndex !== null && subEvents[subEventIndex] ? subEvents[subEventIndex].id : null,
    };
  });

  return {
    id: collectionId,
    kind: bp.kind,
    title: opts?.title?.trim() || bp.defaultTitle,
    jurisdiction,
    currency: j.currency,
    startDate: '',
    endDate: '',
    city: opts?.city?.trim() ?? bp.defaultCity,
    primaryContactName: '',
    primaryContactPhone: '',
    notes: '',
    subEvents,
    vendors,
  };
}

export interface CollectionTotals {
  totalBudget: number;
  totalAdvancePaid: number;
  totalBalanceDue: number;
  vendorCount: number;
  confirmedCount: number;
  unprotectedCount: number;
  subEventCount: number;
  totalGuestsPeak: number;
}

export function computeCollectionTotals(col: EventCollection): CollectionTotals {
  let totalBudget = 0;
  let totalAdvancePaid = 0;
  let confirmedCount = 0;

  for (const v of col.vendors) {
    const fee = Math.max(0, Number(v.agreedFee) || 0);
    const adv = Math.max(0, Number(v.advancePaid) || 0);
    totalBudget += fee;
    totalAdvancePaid += adv;
    if (v.agreementStatus === 'confirmed') confirmedCount += 1;
  }

  const totalGuestsPeak = col.subEvents.reduce(
    (max, s) => Math.max(max, Math.max(0, Number(s.guestCount) || 0)),
    0,
  );

  return {
    totalBudget,
    totalAdvancePaid,
    totalBalanceDue: Math.max(0, totalBudget - totalAdvancePaid),
    vendorCount: col.vendors.length,
    confirmedCount,
    unprotectedCount: col.vendors.length - confirmedCount,
    subEventCount: col.subEvents.length,
    totalGuestsPeak,
  };
}

export function sanitizePhoneDigits(phone: string): string {
  return (phone || '').replace(/[^\d]/g, '');
}

export function buildVendorWhatsAppConfirm(col: EventCollection, vendor: EventVendor): {
  message: string;
  waHref: string;
} {
  const sub = col.subEvents.find((s) => s.id === vendor.subEventId);
  const balance = Math.max(0, (Number(vendor.agreedFee) || 0) - (Number(vendor.advancePaid) || 0));
  const greetingName = vendor.contactPerson.trim() || vendor.vendorName.trim();
  const lines = [
    `Hi ${greetingName}, sharing a quick written recap for *${col.title}*${sub ? ` — ${sub.title}` : ''} so we are 100% aligned:`,
    `• Vendor: ${vendor.vendorName} (${VENDOR_CATEGORY_META[vendor.category]?.label ?? vendor.category})`,
    ...(sub?.eventDate || sub?.timeSlot
      ? [`• Date & time: ${[sub.eventDate, sub.timeSlot].filter(Boolean).join(' · ')}`]
      : []),
    ...(sub?.venueName
      ? [`• Venue: ${[sub.venueName, sub.venueAddress].filter(Boolean).join(', ')}`]
      : []),
    ...(sub?.guestCount ? [`• Expected guests: ${sub.guestCount}`] : []),
    `• Agreed total: ${formatMoney(vendor.agreedFee, col.currency)} | Advance paid: ${formatMoney(vendor.advancePaid, col.currency)}${vendor.utrReference ? ` (Ref: ${vendor.utrReference})` : ''} | Balance: ${formatMoney(balance, col.currency)}`,
    ...(vendor.deliverables ? [`• Scope included: ${vendor.deliverables}`] : []),
    ...(vendor.clauseSummary ? [`• Key terms: ${vendor.clauseSummary}`] : []),
    ...(sub?.coordinatorName || col.primaryContactName
      ? [
          `• Event point of contact: ${sub?.coordinatorName || col.primaryContactName}${
            sub?.coordinatorPhone || col.primaryContactPhone
              ? ` (${sub?.coordinatorPhone || col.primaryContactPhone})`
              : ''
          }`,
        ]
      : []),
    `Please reply "Confirmed" if all details above match what we agreed. Thank you!`,
  ];
  const message = lines.join('\n');
  const digits = sanitizePhoneDigits(vendor.whatsappNumber || vendor.contactPhone);
  const base = digits.length >= 10 ? `https://wa.me/${digits}` : 'https://wa.me/';
  return {
    message,
    waHref: `${base}?text=${encodeURIComponent(message)}`,
  };
}

export function buildScopeFromEventVendor(col: EventCollection, vendor: EventVendor): Scope {
  const sub = col.subEvents.find((s) => s.id === vendor.subEventId);
  const fee = Math.max(0, Math.min(10000000, Number(vendor.agreedFee) || 0));
  const adv = Math.max(0, Math.min(fee, Number(vendor.advancePaid) || 0));
  const advPct = fee > 0 && adv > 0 ? Math.min(100, Math.max(1, Math.round((adv / fee) * 100))) : 0;

  const delivLines = (vendor.deliverables || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const items: Item[] =
    delivLines.length > 0
      ? delivLines.map((line, i) => ({
          id: `ev_i_${i + 1}`,
          title: line.slice(0, 140),
          qty: 1,
          unit: '',
          price: null,
          acceptance: i === 0 && vendor.clauseSummary ? vendor.clauseSummary.slice(0, 160) : '',
        }))
      : [
          {
            id: 'ev_i_1',
            title: `${VENDOR_CATEGORY_META[vendor.category]?.label ?? vendor.category} for ${sub?.title ?? col.title}`,
            qty: 1,
            unit: 'event',
            price: null,
            acceptance: vendor.clauseSummary.slice(0, 160),
          },
        ];

  const contactBits = [
    vendor.contactPerson ? `Contact: ${vendor.contactPerson}` : '',
    vendor.contactPhone ? `Phone: ${vendor.contactPhone}` : '',
    vendor.contactEmail ? `Email: ${vendor.contactEmail}` : '',
    sub?.venueName ? `Venue: ${[sub.venueName, sub.venueAddress].filter(Boolean).join(', ')}` : '',
    sub?.guestCount ? `Guests: ${sub.guestCount}` : '',
    vendor.utrReference ? `Advance UTR/Ref: ${vendor.utrReference}` : '',
    sub?.coordinatorName
      ? `Host coordinator: ${sub.coordinatorName}${sub.coordinatorPhone ? ` (${sub.coordinatorPhone})` : ''}`
      : '',
  ].filter(Boolean);

  return {
    ...blank,
    title: `${col.title}${sub ? ` — ${sub.title}` : ''} (${VENDOR_CATEGORY_META[vendor.category]?.label ?? vendor.category})`.slice(
      0,
      160,
    ),
    client: vendor.vendorName.slice(0, 120),
    deliverables: items.map(itemLine).join('\n'),
    items,
    fee,
    currency: col.currency,
    revisions: 2,
    due: /^\d{4}-\d{2}-\d{2}$/.test(sub?.eventDate || vendor.paymentDueDate)
      ? sub?.eventDate || vendor.paymentDueDate
      : '',
    ...(advPct > 0 ? { deposit_pct: advPct } : {}),
    payment_terms:
      adv > 0
        ? `Advance paid: ${formatMoney(adv, col.currency)}${vendor.utrReference ? ` (${vendor.utrReference})` : ''}. Balance ${formatMoney(Math.max(0, fee - adv), col.currency)} payable upon satisfactory completion.`
        : 'Payment released in agreed milestones upon written confirmation.',
    exclusions:
      'Any extra hours, additional guests beyond agreed buffer, or out-of-scope add-ons require prior written host approval via change order.',
    notes: [vendor.clauseSummary, ...contactBits].filter(Boolean).join('\n'),
  };
}

export function summarizeCollectionForAI(col: EventCollection): string {
  const totals = computeCollectionTotals(col);
  const subsText = col.subEvents
    .map(
      (s, i) =>
        `${i + 1}. ${s.title} (${s.eventDate || 'date TBD'} ${s.timeSlot || ''}, Venue: ${s.venueName || 'TBD'}, Guests: ${s.guestCount}, Coordinator: ${s.coordinatorName || 'TBD'} ${s.coordinatorPhone || ''}, Status: ${s.status})`,
    )
    .join('\n');
  const vendorsText = col.vendors
    .map((v) => {
      const subName = col.subEvents.find((s) => s.id === v.subEventId)?.title ?? 'All sub-events';
      return `- ${v.vendorName} [${v.category}] for ${subName}: Fee ${formatMoney(v.agreedFee, col.currency)}, Advance ${formatMoney(v.advancePaid, col.currency)}, Status: ${v.agreementStatus}, Contact: ${v.contactPerson || '—'} (${v.contactPhone || 'no phone'}), Terms: ${v.clauseSummary || 'none yet'}`;
    })
    .join('\n');

  return [
    `Active Event Collection: "${col.title}" (${col.kind}, City: ${col.city || 'unspecified'}, Jurisdiction: ${col.jurisdiction}, Currency: ${col.currency})`,
    `Totals: Budget ${formatMoney(totals.totalBudget, col.currency)}, Advance Paid ${formatMoney(totals.totalAdvancePaid, col.currency)}, Balance Due ${formatMoney(totals.totalBalanceDue, col.currency)}, ${totals.confirmedCount}/${totals.vendorCount} vendors confirmed.`,
    `Sub-events:\n${subsText || '(none yet)'}`,
    `Vendors:\n${vendorsText || '(none yet)'}`,
  ].join('\n');
}

export const subEventPayloadSchema = z.object({
  id: z.string().min(1).max(64),
  collectionId: z.string().max(64).optional().default(''),
  sortOrder: z.number().int().min(0).max(500).optional().default(0),
  title: z.string().trim().min(1).max(160),
  eventDate: z.string().max(40).optional().default(''),
  timeSlot: z.string().max(80).optional().default(''),
  venueName: z.string().max(160).optional().default(''),
  venueAddress: z.string().max(240).optional().default(''),
  guestCount: z.number().int().min(0).max(100000).optional().default(0),
  coordinatorName: z.string().max(120).optional().default(''),
  coordinatorPhone: z.string().max(40).optional().default(''),
  status: z.enum(['planning', 'locked', 'completed']).optional().default('planning'),
  notes: z.string().max(1200).optional().default(''),
});

export const eventVendorPayloadSchema = z.object({
  id: z.string().min(1).max(64),
  collectionId: z.string().max(64).optional().default(''),
  subEventId: z.string().max(64).nullable().optional().default(null),
  category: z
    .enum([
      'catering',
      'venue',
      'photography',
      'decor',
      'makeup',
      'music-dj',
      'transport',
      'priest-officiant',
      'contractor',
      'landlord',
      'other',
    ])
    .optional()
    .default('catering'),
  vendorName: z.string().trim().min(1).max(160),
  contactPerson: z.string().max(120).optional().default(''),
  contactPhone: z.string().max(40).optional().default(''),
  contactEmail: z.string().max(160).optional().default(''),
  whatsappNumber: z.string().max(40).optional().default(''),
  agreedFee: z.number().int().min(0).max(100000000).optional().default(0),
  advancePaid: z.number().int().min(0).max(100000000).optional().default(0),
  paymentDueDate: z.string().max(40).optional().default(''),
  utrReference: z.string().max(80).optional().default(''),
  agreementStatus: z.enum(['draft', 'whatsapp-sent', 'confirmed', 'disputed']).optional().default('draft'),
  clauseSummary: z.string().max(1200).optional().default(''),
  deliverables: z.string().max(2000).optional().default(''),
});

export const eventCollectionPayloadSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z
    .enum(['marriage', 'intimate-wedding', 'home-renovation', 'apartment-move', 'custom'])
    .optional()
    .default('marriage'),
  title: z.string().trim().min(1).max(160),
  jurisdiction: z.string().max(20).optional().default('IN-KA'),
  currency: z.enum(['INR', 'USD']).optional().default('INR'),
  startDate: z.string().max(40).optional().default(''),
  endDate: z.string().max(40).optional().default(''),
  city: z.string().max(120).optional().default(''),
  primaryContactName: z.string().max(120).optional().default(''),
  primaryContactPhone: z.string().max(40).optional().default(''),
  notes: z.string().max(2000).optional().default(''),
  subEvents: z.array(subEventPayloadSchema).max(40).optional().default([]),
  vendors: z.array(eventVendorPayloadSchema).max(120).optional().default([]),
});

export const LOCAL_EVENTS_STORAGE_KEY = 'termslock:event-collections:v1';
