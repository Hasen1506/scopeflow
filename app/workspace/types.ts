import {formatMoney,type Scope} from '@/lib/scope';
import type {Insights} from '@/lib/insights';

/** A scope still unanswered after this many days gets a gentle "worth a nudge" on its card. */
export const STALE_DAYS=5;
export const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export type OvProject={project_id:string;version:number;currency:string;quoted_fee:number;quoted_total:number;agreed_fee:number|null;agreed_total:number|null;pending_changes:number;pending_value:number;approved_changes:number;deposit_due:number|null;paid:number;balance:number|null;last_sent:string|null;reminders:number;viewed:{first:string;last:string;count:number}|null};
export type Overview={projects:OvProject[];insights:Insights;online_deposits:boolean};
export const moneyMap=(m:Record<string,number>)=>Object.entries(m).filter(([,v])=>v).map(([c,v])=>formatMoney(v,c)).join(' + ')||'—';

export type Tpl={id:string;name:string;content:Scope;builtin:boolean};
/** One countersigner's own link (WS-02 `cosign_links`, browser sessions only). */
export type CosignLink={cosigner_id:string;role:string;to:string|null;cosign_path:string};
