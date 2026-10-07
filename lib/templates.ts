import {blank, itemLine, type Item, type ClientInput, type Scope} from './scope';

function outline(title: string, items: Item[], client_inputs: ClientInput[], exclusions: string, notes: string): Scope {
  return {...blank, title, items, deliverables: items.map(itemLine).join('\n'), client_inputs, exclusions, notes};
}
const item = (id: string, title: string, qty = 1, unit = '', acceptance = ''): Item => ({id, title, qty, unit, price: null, acceptance});

export const templates: {id: string; name: string; content: Scope}[] = [
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
