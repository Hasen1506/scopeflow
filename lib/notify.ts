import type {NotifyEvent, NotifyPayload, NotifyResult} from './contracts';

// Notifications (owner: WS-06). Phase 0: logs the event only (never the payload, which can hold
// client addresses); nothing is sent. WS-06 routes events to email, SMS and WhatsApp with fallback.

export type {NotifyEvent, NotifyPayload, NotifyResult};
export const NOTIFY_EVENTS: readonly NotifyEvent[] = [
  'co_proposed', 'invoice_issued', 'payment_reminder', 'contact_changed_old_address',
  'cosign_invite', 'payment_claim', 'payment_alert', 'account_closed_client_notice',
];

export async function notify(event: NotifyEvent, payload: NotifyPayload = {}): Promise<NotifyResult> {
  console.info(`[scopeflow:notify] ${event}${payload.project_id ? ' project ' + payload.project_id : ''} (not sent: notifications are not enabled yet)`);
  return {event, delivered: false, channel: 'log'};
}
