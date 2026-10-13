import type {NotifyEvent, NotifyPayload, NotifyResult} from './contracts';

// Notifications (owner: WS-06; H18, SF-13). notify(event, payload) is the one way any workstream
// tells a client or an owner that something happened. Email goes through the outbox and the mail
// router (lib/mail-outbox.ts, lib/mail-router.ts); for client notices the owner also gets a
// prefilled wa.me link to share the same news on WhatsApp themselves (ScopeFlow never messages a
// client on WhatsApp). Delivery lives in lib/notify-delivery.ts and is loaded on first use, so this
// module (the event list and the types) stays importable without a database.
//
// Client notices for change orders, invoices and payment reminders respect the project's
// `notify_client` switch (default on). Required notices (contact changed, countersign invitation,
// account closed) are always sent. Every call is idempotent per (event, project, ref).

export type {NotifyEvent, NotifyPayload, NotifyResult};
export const NOTIFY_EVENTS: readonly NotifyEvent[] = [
  'co_proposed', 'invoice_issued', 'payment_reminder', 'contact_changed_old_address',
  'cosign_invite', 'payment_claim', 'payment_alert', 'account_closed_client_notice',
];
/** Events that inform the client about money or scope; the owner can switch them off per project. */
export const OPTIONAL_CLIENT_EVENTS: readonly NotifyEvent[] = ['co_proposed', 'invoice_issued', 'payment_reminder'];

export type NotifyOutcome = NotifyResult & {
  status: 'sent' | 'dev_log' | 'queued' | 'failed' | 'refused' | 'suppressed' | 'no_provider' | 'skipped' | 'capped';
  reason?: string; outbox_id?: string; duplicate?: boolean;
  /** A wa.me link with the same news, for the owner to send from their own WhatsApp. */
  whatsapp?: string;
};

/** Delivers one event. Never throws for delivery problems: the outcome says what happened. */
export async function notify(event: NotifyEvent, payload: NotifyPayload = {}): Promise<NotifyOutcome> {
  if (!NOTIFY_EVENTS.includes(event)) return {event, delivered: false, channel: 'log', status: 'skipped', reason: 'unknown_event'};
  const {deliverNotify} = await import('./notify-delivery');
  return deliverNotify(event, payload);
}

/** Sends the change-order and invoice notices the database triggers queued (one project, or all). */
export async function drainNotifyEvents(options: {projectId?: string; limit?: number} = {}): Promise<NotifyOutcome[]> {
  const {drainNotifyEvents: drain} = await import('./notify-delivery');
  return drain(options);
}
