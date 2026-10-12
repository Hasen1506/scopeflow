// Phase 0 contract (type-only, frozen). Changes need the agreement of every workstream owner.

/** Every event lib/notify.ts can deliver. WS-06 owns delivery; others only call notify(). */
export type NotifyEvent =
  | 'co_proposed'
  | 'invoice_issued'
  | 'payment_reminder'
  | 'contact_changed_old_address'
  | 'cosign_invite'
  | 'payment_claim'
  | 'payment_alert'
  | 'account_closed_client_notice';

/** What every notification carries. `to` is a raw address; delivery code masks it in logs. */
export type NotifyPayload = {
  project_id?: string;
  owner?: string;
  to?: string | null;
  data?: Record<string, unknown>;
};

/** The outcome of one notify() call. Phase 0 only logs, so `delivered` is false and `channel` is `log`. */
export type NotifyResult = {event: NotifyEvent; delivered: boolean; channel: 'log' | 'email' | 'sms' | 'whatsapp'; provider?: string};
