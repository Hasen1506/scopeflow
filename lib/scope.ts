import { z } from 'zod';
export const scopeSchema = z.object({
 title:z.string().trim().min(3).max(160),client:z.string().trim().min(2).max(120),
 deliverables:z.string().trim().min(5).max(5000),exclusions:z.string().trim().max(3000),
 fee:z.number().finite().min(0).max(10000000),currency:z.enum(['USD','INR','GBP','EUR']),
 revisions:z.number().int().min(0).max(50),due:z.string().refine(x=>!x || (/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x),'Use a valid date'),
 notes:z.string().trim().max(3000)
}).strict();
export type Scope = z.infer<typeof scopeSchema>;
export type Version = {id:string;project_id:string;version:number;token:string;revoked?:number;content:Scope;status:string;signer:string|null;comment:string|null;created:string;decided:string|null};
export const sample:Scope={title:'Brand identity / Studio North',client:'Studio North',deliverables:'Primary logo and two variations\nColor palette and typography\n12-page brand guidelines',exclusions:'Website design, social media templates, and print production.',fee:1800,currency:'USD',revisions:2,due:'',notes:'Feedback is consolidated into one list per round. Additional work needs a separate agreement.'};
export const blank:Scope={title:'',client:'',deliverables:'',exclusions:'',fee:0,currency:'USD',revisions:2,due:'',notes:''};
export function money(s:Scope){return new Intl.NumberFormat('en-US',{style:'currency',currency:s.currency,maximumFractionDigits:2}).format(s.fee);}
export function label(status:string){return ({pending:'Awaiting review',approved:'Approved',changes_requested:'Changes requested'} as Record<string,string>)[status]||status;}
