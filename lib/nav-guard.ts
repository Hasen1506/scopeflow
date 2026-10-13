/** Counts the owner's own navigations and draft edits, so a slow load can tell whether the owner moved on
 * while it waited (e.g. the first /api/scopes must not bounce a "New scope" click back to the project list). */
export type NavGuard={bump():void;mark():number;unchanged(mark:number):boolean};
export function navGuard():NavGuard{let n=0;return {bump(){n++;},mark(){return n;},unchanged(mark){return mark===n;}};}
