// Pure state helpers for the client page (owner: WS-07): read-only/closed links (H4/H10 UI) and
// link problems (LT-10). No React here, so tests/property/ws-07-client-states.test.mjs imports it.
import type {Translate} from '../../../lib/i18n/core';

export type ReadonlyReason = 'revoked' | 'rotated' | 'account_closed';
export type ReadonlyInfo = {readonly: boolean; reason: ReadonlyReason | null; keptUntil: string | null};

export function readonlyOf(data: unknown): ReadonlyInfo {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const closed = d.account_closed === true || d.readonly_reason === 'account_closed';
  const readonly = d.readonly === true || closed;
  if (!readonly) return {readonly: false, reason: null, keptUntil: null};
  const reason: ReadonlyReason = closed ? 'account_closed' : d.readonly_reason === 'rotated' ? 'rotated' : 'revoked';
  return {readonly, reason, keptUntil: typeof d.kept_until === 'string' ? d.kept_until : null};
}


export type ProblemKind = 'not_found' | 'expired' | 'unavailable';
export type Sender = {name: string | null; email: string | null};
/** `expiredText`: the server's own expiry wording (WS-02 `expired_text`), preferred over formatting `expired`. */
export type LinkProblemState = {kind: ProblemKind; expired: string | null; sender: Sender | null; expiredText?: string | null};

/** How the review API's error maps to what the client sees. */
export function problemOf(error: unknown): LinkProblemState {
  const e = (error ?? {}) as {status?: number; code?: string; data?: Record<string, unknown>};
  const data = e.data ?? {};
  const raw = (data.sender ?? data.creator ?? null) as Record<string, unknown> | null;
  const sender: Sender | null = raw && typeof raw === 'object' ? {name: typeof raw.name === 'string' && raw.name ? raw.name : null, email: typeof raw.email === 'string' && raw.email.includes('@') ? raw.email : null} : null;
  if (e.status === 410 || e.code === 'link_expired') return {kind: 'expired', expired: typeof data.expired === 'string' ? data.expired : null, sender, ...(typeof data.expired_text === 'string' && data.expired_text ? {expiredText: data.expired_text} : {})};
  if (e.status === 404 || e.status === 400) return {kind: 'not_found', expired: null, sender};
  return {kind: 'unavailable', expired: null, sender: null};
}

/** mailto: with a ready-to-send request for a new link (no recipient when the sender is unknown). */
export function askSenderHref(t: Translate, sender: Sender | null) {
  const query = new URLSearchParams({subject: t('problem.mailSubject'), body: t('problem.mailBody')}).toString().replace(/\+/g, '%20');
  return `mailto:${sender?.email ? encodeURIComponent(sender.email).replace('%40', '@') : ''}?${query}`;
}


/** #59/B-1: how long Approve / Request changes stay disabled after a server-side failure to record. */
export const DECISION_COOLDOWN_S = 30;
/**
 * A decision that failed because the server could not record it right now (signing unavailable,
 * a 5xx, or no response at all) gets a cooldown and a "let the sender know" path instead of an
 * invitation to retry at once. A 4xx about the decision itself (stale version, bad input) does not. Pure.
 */
export function decisionUnavailable(error: unknown): boolean {
  const e = (error ?? {}) as {status?: number; code?: string};
  if (e.code === 'signing_unavailable') return true;
  if (typeof e.status !== 'number') return true;
  return e.status >= 500;
}

/** mailto: telling the sender the decision could not be recorded (no recipient: the page does not know their address). */
export function tellSenderHref(t: Translate, version: number, link: string, comment = '') {
  const body = t('decide.tellBody', {version, link}) + (comment.trim() ? '\n\n' + comment.trim().slice(0, 1500) : '');
  const query = new URLSearchParams({subject: t('decide.tellSubject', {version}), body}).toString().replace(/\+/g, '%20');
  return `mailto:?${query}`;
}
