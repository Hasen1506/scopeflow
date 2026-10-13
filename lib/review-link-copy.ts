// WS-09 (H4, primary WS-02): the words the workspace uses around revoking or replacing a review link.
// WS-02 splits the semantics: on a pending version revoke kills the link (404); on a decided version it
// only stops new actions, and the link stays 200 read-only with the record, ledger, invoices, receipt and
// statement. Replacing a decided version's link keeps the old one as a read-only alias. The copy must say
// the client keeps their copy, so the owner is not afraid to revoke. Pure: no React, no DOM.

export type LinkAction = 'revoke' | 'rotate';
export type LinkCopy = {title: string; body: string; confirm: string; done: string};

/** True when the version has a client decision on record (approved or declined). */
export const decidedStatus = (status: string | null | undefined) => !!status && status !== 'pending';

export function linkDialogCopy(action: LinkAction, decided: boolean): LinkCopy {
  if (action === 'revoke') return decided ? {
    title: 'Revoke review access?',
    body: 'Your client keeps their copy. The link stays open read-only: the signed record, change orders, invoices, receipt and statement remain there, with a note that you closed it for new changes. Nobody can approve change orders, pay or countersign through it any more.',
    confirm: 'Confirm revocation',
    done: 'Link closed for new changes. Your client keeps a read-only copy of the signed record.',
  } : {
    title: 'Revoke review access?',
    body: 'The link stops working immediately and nobody can decide this version through it. The scope stays in your private history; share a new version or link when you are ready.',
    confirm: 'Confirm revocation',
    done: 'Review link revoked. Saved decisions remain in your history.',
  };
  return decided ? {
    title: 'Replace this review link?',
    body: 'A new link is issued for anything new. Your client keeps their copy: the old link keeps working read-only for the signed record, change orders, invoices, receipt and statement. Share the new link with the intended reviewer.',
    confirm: 'Confirm replacement',
    done: 'Link replaced. The previous link still shows the signed record, read-only.',
  } : {
    title: 'Replace this review link?',
    body: 'The current link stops working immediately. Share the replacement link with the intended reviewer.',
    confirm: 'Confirm replacement',
    done: 'Link replaced. The previous link no longer works.',
  };
}

/** The note under a revoked version (approval step and decision history). */
export const revokedNote = (decided: boolean) => decided
  ? 'Closed for new changes. Your client keeps a read-only copy.'
  : 'This version’s review link is revoked.';

/**
 * N4: the mail-app draft offered next to "Copy link to send" when this server has no email provider. Built in the
 * browser from the copied link, so no request is made and nothing is saved. Same wording as the default signature email.
 */
export function reviewMailto(to: string, {title, client, version, reviewUrl}: {title: string; client: string; version: number; reviewUrl: string}): string {
  const line = (v: string, max: number) => v.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const t = line(title, 160), c = line(client, 120);
  const subject = `Please review and approve: ${t} (version ${version})`;
  const body = [`Hi ${c},`, '', `The scope of work "${t}" (version ${version}) is ready for your review.`, 'Open the link below to read it and approve it or request changes:', '', reviewUrl, '', 'The link is private to you. Please do not forward it.'].join('\n');
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
