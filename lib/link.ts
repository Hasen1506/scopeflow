// Review-link expiry. A creator can make the link of an undecided version stop working a set number
// of days after it was handed out (a new version, or a replaced link). Decided versions are the
// client's record of the agreement, so their links never expire. Pure; shared by routes and the UI.
// H5 (WS-02): link_issued is the version's own (version_links.link_issued), so replacing one version's
// link never restarts another version's expiry.

export const LINK_EXPIRY_CHOICES = [7, 14, 30, 60, 90] as const;
export type LinkState = {status: string; created: string; link_issued?: string | null; link_expiry_days?: number | null};

/** When this version's link stops working (ISO), or null when it never does. */
export function linkExpires(v: LinkState): string | null {
  if (v.status !== 'pending' || !v.link_expiry_days) return null;
  // link_issued is set when this version's link is replaced; otherwise the version's own date counts.
  const t = Date.parse(v.link_issued || v.created);
  return Number.isNaN(t) ? null : new Date(t + v.link_expiry_days * 86400000).toISOString();
}
export function linkExpired(v: LinkState, now = Date.now()) {
  const at = linkExpires(v);
  return at !== null && Date.parse(at) <= now;
}
