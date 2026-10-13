import {sample,blank,type Scope} from '@/lib/scope';
import {api} from '../ui';
import {LEGACY_DRAFT_KEY,draftKey,clearDrafts,restoreDraft,normalizeDraft,meaningfulDraft} from '@/lib/editor';

export type RestoredDraft={
 /** The draft to show, and where it came from (null: nothing worth restoring). */
 stored:Scope|null;from:'tab'|'account'|'browser'|null;
 /** The draft the server keeps with the account; `known` is false when /api/unsaved-draft could not be read. */
 kept:Scope|null;known:boolean;
 /** The account's draft, offered back through Undo when this tab's signed-out draft took its place. */
 undo:Scope|null;
};

/** First load (BUG-14): pick the unsaved draft to restore for `who` (null: signed out, the draft lives only
 * in this tab), and clear what a signed-in browser must not keep. Moved verbatim from useWorkspace().refresh. */
export async function restoreOnLoad(who:string|null):Promise<RestoredDraft>{
 let stored:Scope|null=null,from:RestoredDraft['from']=null,anon:Scope|null=null,local:Scope|null=null,kept:Scope|null=null,known=false,undo:Scope|null=null;const now=Date.now();
 const keep=(d:Scope|null)=>!!d&&meaningfulDraft(d,sample,blank);
 try{localStorage.removeItem(LEGACY_DRAFT_KEY);anon=restoreDraft(sessionStorage.getItem(draftKey(null)),now,null);
  // Signed in: nothing stays in the browser. A draft an earlier build kept here moves to the account.
  if(who!==null){local=restoreDraft(localStorage.getItem(draftKey(who)),now,who);clearDrafts(localStorage);sessionStorage.removeItem(draftKey(null));}
 }catch{/* storage unavailable */}
 if(who===null){if(keep(anon)){stored=anon;from='tab';}}
 else{try{const r=await api('/api/unsaved-draft');kept=r.draft?normalizeDraft(r.draft):null;known=true;}catch{/* draft service unavailable: autosave still writes, never deletes */}
  // What was typed signed out in this tab comes first (Undo brings the account's draft back), then the account's draft.
  if(keep(anon)){stored=anon;from='tab';if(keep(kept))undo=kept;}else if(keep(kept)){stored=kept;from='account';}else if(keep(local)){stored=local;from='browser';}}
 return {stored,from,kept,known,undo};
}
