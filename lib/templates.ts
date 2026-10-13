import {blank, itemLine, type Item, type ClientInput, type Scope} from './scope';
import type {Mode} from './contracts';

function outline(title: string, items: Item[], client_inputs: ClientInput[], exclusions: string, notes: string): Scope {
  return {...blank, title, items, deliverables: items.map(itemLine).join('\n'), client_inputs, exclusions, notes};
}
const item = (id: string, title: string, qty = 1, unit = '', acceptance = ''): Item => ({id, title, qty, unit, price: null, acceptance});

const general: {id: string; name: string; content: Scope}[] = [
  {id: 'brand', name: 'Brand identity', content: outline('Brand identity',
    [item('i_logo', 'Primary logo and two variations', 1, 'logo suite', 'Delivered as SVG, PNG and PDF'), item('i_palette', 'Colour palette and typography'), item('i_guide', 'Brand guidelines document', 12, 'pages', 'Print-ready PDF')],
    [{id: 'c_brief', title: 'Completed brand questionnaire', due: ''}, {id: 'c_refs', title: 'Competitor and inspiration references', due: ''}],
    'Website design, print production, and additional brand applications.',
    'Confirm the fee, client, and exact quantities before saving. Feedback is consolidated into one list per revision round.')},
  {id: 'website', name: 'Website project', content: outline('Website design and build',
    [item('i_design', 'Responsive page designs', 5, 'pages', 'Desktop and mobile layouts approved in Figma'), item('i_build', 'Pages implemented', 5, 'pages', 'Works in current Chrome, Safari, Firefox and Edge'), item('i_handover', 'Handover and launch checklist')],
    [{id: 'c_copy', title: 'Final copy for every page', due: ''}, {id: 'c_access', title: 'Domain and hosting access', due: ''}],
    'Hosting fees, paid assets, copywriting, ongoing maintenance, SEO, and integrations unless listed above.',
    'List the exact pages. Confirm browser support, responsibilities, payment terms, fee and client before saving.')},
  {id: 'content', name: 'Content package', content: outline('Content creation package',
    [item('i_plan', 'Content plan', 1, 'month'), item('i_posts', 'Social posts', 12, 'posts', 'Final files in agreed formats'), item('i_video', 'Short-form videos', 4, 'videos', 'Up to 60 seconds, captioned')],
    [{id: 'c_assets', title: 'Brand assets and product photos', due: ''}, {id: 'c_approvals', title: 'Feedback on the content plan', due: ''}],
    'Paid distribution, community management, and additional versions unless listed above.',
    'Specify the exact number of pieces, formats, and delivery channels. Confirm usage rights, fee and client before saving.')},
  {id: 'mobile-app', name: 'Mobile app', content: outline('Mobile app design and build',
    [item('i_flows', 'User flows and wireframes', 1, 'set', 'Approved in Figma'), item('i_ui', 'App screens designed', 12, 'screens', 'iOS and Android layouts approved in Figma'), item('i_build', 'Screens implemented', 12, 'screens', 'Runs on the two latest iOS and Android versions'), item('i_store', 'App store submission', 1, 'submission per store', 'Submitted to the App Store and Google Play')],
    [{id: 'c_accounts', title: 'Apple and Google developer accounts', due: ''}, {id: 'c_content', title: 'Final copy and images for every screen', due: ''}],
    'Backend or API development, ongoing maintenance, paid third-party services, and store approval itself.',
    'Name every screen. Confirm supported OS versions, devices, payment terms, fee and client before saving.')},
  {id: 'seo-retainer', name: 'Monthly SEO retainer', content: outline('Monthly SEO retainer',
    [item('i_audit', 'Technical SEO audit', 1, 'audit', 'Written report with prioritised fixes'), item('i_articles', 'Optimised articles', 4, 'articles per month', 'Published or delivered as final drafts'), item('i_report', 'Monthly performance report', 1, 'report per month', 'Rankings, traffic and next steps')],
    [{id: 'c_access', title: 'Search Console and analytics access', due: ''}, {id: 'c_topics', title: 'Approval of the monthly topic list', due: ''}],
    'Paid ads, link buying, website development, and guaranteed rankings.',
    'State the retainer period and notice terms. Results depend on factors outside our control; no ranking is guaranteed.')},
  {id: 'video', name: 'Video production', content: outline('Video production',
    [item('i_script', 'Script and storyboard', 1, 'script', 'Approved in writing before the shoot'), item('i_shoot', 'Filming', 1, 'shoot day', 'Up to 8 hours on location'), item('i_edit', 'Edited video', 1, 'video', 'Up to 90 seconds, colour graded, with licensed music'), item('i_cuts', 'Social cut-downs', 3, 'cuts', '15 to 30 seconds, captioned')],
    [{id: 'c_brief', title: 'Creative brief and brand assets', due: ''}, {id: 'c_location', title: 'Location access and permissions', due: ''}],
    'Actors or presenters, travel outside the city, paid stock footage, and additional shoot days.',
    'Confirm usage rights, delivery formats, payment terms, fee and client before saving.')},
  {id: 'copywriting', name: 'Website copywriting', content: outline('Website copywriting',
    [item('i_pages', 'Web pages written', 5, 'pages', 'Delivered in Google Docs, up to 600 words each'), item('i_meta', 'SEO titles and meta descriptions', 5, 'pages'), item('i_tone', 'Tone of voice guide', 1, 'guide', '2-page PDF')],
    [{id: 'c_interview', title: 'A 60-minute kickoff interview', due: ''}, {id: 'c_facts', title: 'Product facts, pricing and approvals', due: ''}],
    'Design, development, translation, and copy for pages not listed above.',
    'List the exact pages and word counts. Confirm payment terms, fee and client before saving.')},
  {id: 'workshop', name: 'Strategy workshop', content: outline('Strategy workshop',
    [item('i_prep', 'Discovery interviews', 4, 'interviews', '45 minutes each, notes shared'), item('i_workshop', 'Facilitated workshop', 1, 'half-day session', 'Up to 10 participants, remote or on site'), item('i_report', 'Workshop report and recommendations', 1, 'report', 'PDF within 5 working days of the workshop')],
    [{id: 'c_people', title: 'Participant list and calendars', due: ''}, {id: 'c_docs', title: 'Existing strategy documents', due: ''}],
    'Implementation of the recommendations, venue and catering costs, and travel outside the city.',
    'Confirm the date, format, number of participants, payment terms, fee and client before saving.')},
];

// SF-22 (WS-09): vertical packs. Starters for a trade, priced in INR with GST, with the shape that trade
// needs (a payment schedule, stage inspections, a monthly retainer). Ids are stable: projects made from
// them, change orders and the WS-05 rate-card picker refer to them, so never rename one.
const inr = (s: Scope): Scope => ({...s, currency: 'INR', tax_label: 'GST', tax_pct: 18});
/** Add-on lines a pack prices separately (billed as change orders); read by the WS-05 RateCardPicker. */
export type RateCardLine = {id: string; title: string; unit: string};
export type TemplatePack = {id: string; name: string; pack: string; content: Scope; modes: Mode[]; tags: string[]; rate_card?: RateCardLine[]};
export const verticalPacks: TemplatePack[] = [
  {id: 'wedding-photographer', name: 'Wedding photography package', pack: 'Wedding & events', modes: ['consumer', 'freelancer'], tags: ['wedding', 'events', 'photography'],
    rate_card: [{id: 'rc_extra_hour', title: 'Extra coverage hour', unit: 'hour'}, {id: 'rc_extra_album', title: 'Additional printed album', unit: 'album'}, {id: 'rc_drone', title: 'Drone coverage', unit: 'half-day'}],
    content: {...inr(outline('Wedding photography package',
      [item('w_coverage', 'Wedding day coverage', 8, 'hours', 'One lead photographer from getting ready to the reception'), item('w_photos', 'Edited high-resolution photos', 400, 'photos', 'Colour corrected, delivered in an online gallery within 6 weeks'), item('w_album', 'Printed wedding album', 1, 'album', '30 spreads, layout approved before printing'), item('w_gallery', 'Online gallery for family and guests', 1, 'gallery', 'Downloadable for 12 months')],
      [{id: 'c_shotlist', title: 'Shot list and family names', due: ''}, {id: 'c_venue', title: 'Venue timings and photography permissions', due: ''}],
      'Extra coverage hours, additional albums, drone coverage, travel outside the city and raw files, unless added by change order.',
      'Rate card (billed as change orders): extra coverage hour, additional printed album, drone coverage. Confirm the date, venue, fee and client before saving.')),
    milestones: [{id: 'm_booking', title: 'Booking the date', pct: 30, due: ''}, {id: 'm_event', title: 'On the wedding day', pct: 50, due: ''}, {id: 'm_album', title: 'On album delivery', pct: 20, due: ''}]}},
  {id: 'interiors-boq', name: 'Interiors BOQ with stage sign-off', pack: 'Interiors & renovation', modes: ['consumer', 'agency'], tags: ['interiors', 'renovation', 'boq'],
    content: {...inr(outline('Home interiors: bill of quantities',
      [item('b_design', 'Design and 3D visualisation', 1, 'set', 'Layouts and renders approved in writing'), item('b_civil', 'Civil and electrical work', 40, 'points', 'Inspection signed off before carpentry starts'), item('b_ceiling', 'False ceiling', 450, 'sq ft', 'Inspection signed off before painting'), item('b_kitchen', 'Modular kitchen', 1, 'kitchen', 'Materials as per the approved finish schedule'), item('b_wardrobes', 'Wardrobes', 3, 'units', 'Hardware and finish as per the approved schedule'), item('b_paint', 'Painting', 1800, 'sq ft', 'Final inspection signed off at handover')],
      [{id: 'c_site', title: 'Site access and society approvals', due: ''}, {id: 'c_finishes', title: 'Material and finish selections', due: ''}],
      'Structural changes, appliances, loose furniture, décor, and quantities beyond this BOQ unless added by change order.',
      'Each stage is paid after its inspection is signed off. Quantities are measured on site; differences are agreed as change orders.')),
    milestones: [{id: 'm_design', title: 'Booking and design sign-off', pct: 10, due: ''}, {id: 'm_civil', title: 'Civil and electrical inspection signed off', pct: 40, due: ''}, {id: 'm_carpentry', title: 'Carpentry and ceiling inspection signed off', pct: 35, due: ''}, {id: 'm_handover', title: 'Final inspection and handover', pct: 15, due: ''}]}},
  {id: 'ca-retainer', name: 'CA monthly compliance retainer', pack: 'Accounting & compliance', modes: ['freelancer', 'enterprise'], tags: ['accounting', 'compliance', 'retainer'],
    content: {...inr(outline('Monthly compliance retainer',
      [item('ca_books', 'Bookkeeping', 150, 'entries per month', 'Books closed by the 10th of the following month'), item('ca_gst', 'GST returns (GSTR-1 and GSTR-3B)', 1, 'filing set per month', 'Filed by the due dates'), item('ca_tds', 'TDS payment and challan', 1, 'per month', 'Paid by the 7th of the following month'), item('ca_mis', 'Monthly MIS report', 1, 'report per month', 'P&L, receivables and payables summary')],
      [{id: 'c_invoices', title: 'Sales and purchase invoices by the 5th', due: ''}, {id: 'c_bank', title: 'Bank statements for the month', due: ''}],
      'Income tax returns, audits, notices and representations, ROC filings and entries beyond the monthly quota, unless added by change order.',
      'Late documents move filing dates; penalties from late documents are the client\'s. Confirm the monthly fee, notice period and client before saving.')),
    engagement: 'retainer', retainer: {period: 'monthly', quotas: [{item_id: 'ca_books', qty: 150}, {item_id: 'ca_gst', qty: 1}, {item_id: 'ca_tds', qty: 1}, {item_id: 'ca_mis', qty: 1}], carry_over: 'none', renewal: 'auto'}}},
  {id: 'agency-social-retainer', name: 'Agency social media retainer', pack: 'Agency retainers', modes: ['agency'], tags: ['social', 'agency', 'retainer'],
    content: {...inr(outline('Social media retainer',
      [item('s_plan', 'Monthly content calendar', 1, 'calendar per month', 'Approved before the month starts'), item('s_posts', 'Static and carousel posts', 16, 'posts per month', 'Designed, captioned and scheduled'), item('s_reels', 'Reels', 4, 'reels per month', 'Up to 30 seconds, captioned'), item('s_report', 'Monthly performance report', 1, 'report per month', 'Reach, engagement and next steps')],
      [{id: 'c_brand', title: 'Brand guidelines and product photos', due: ''}, {id: 'c_feedback', title: 'Feedback on the calendar within 3 working days', due: ''}],
      'Paid ads budget, influencer fees, shoots, community management outside working hours and pieces beyond the monthly quota, unless added by change order.',
      'Unused quota does not carry over. Confirm the monthly fee, notice period and client before saving.')),
    engagement: 'retainer', retainer: {period: 'monthly', quotas: [{item_id: 's_plan', qty: 1}, {item_id: 's_posts', qty: 16}, {item_id: 's_reels', qty: 4}, {item_id: 's_report', qty: 1}], carry_over: 'none', renewal: 'auto'}}},
];

// Mode-specific starters (SF-18): which modes a general starter is suggested in. A mode only orders the
// list; every starter stays available in every mode (plan §2).
const generalModes: Record<string, Mode[]> = {brand: ['freelancer', 'agency'], website: ['freelancer', 'agency', 'enterprise'], content: ['freelancer', 'agency'], 'mobile-app': ['agency', 'enterprise'], 'seo-retainer': ['freelancer', 'agency'], video: ['freelancer', 'agency', 'consumer'], copywriting: ['freelancer'], workshop: ['agency', 'enterprise']};

export type BuiltinTemplate = {id: string; name: string; content: Scope; modes: Mode[]; tags: string[]; pack?: string; rate_card?: RateCardLine[]};
export const templates: BuiltinTemplate[] = [
  ...general.map(t => ({...t, modes: generalModes[t.id] ?? ['freelancer'], tags: [] as string[]})),
  ...verticalPacks,
];
/** Starters in the order a mode suggests them: that mode's first, the rest after (none are hidden). */
export function startersFor(mode: Mode, list: BuiltinTemplate[] = templates): BuiltinTemplate[] {
  return [...list.filter(t => t.modes.includes(mode)), ...list.filter(t => !t.modes.includes(mode))];
}
