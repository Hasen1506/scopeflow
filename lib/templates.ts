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
];
