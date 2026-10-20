// M15: how often and how much one-time codes may be sent. Pure, so the schedule is unit tested.
//
// Per version: at most OTP_DAILY_PER_VERSION codes in any 24 hours, with an exponential cooldown
// between sends (none before the first, then 30 s, 2 min, 10 min). Per destination address: at most
// OTP_DAILY_PER_DESTINATION codes in 24 hours for one owner's projects (S6: counted per owner and
// address, so one freelancer cannot use up another's client), and at most
// OTP_DAILY_PER_DESTINATION_GLOBAL across every owner (anti-spam). Per owner: a daily budget in
// cost units (email and WhatsApp cost 1, SMS 5), SCOPEFLOW_OTP_DAILY_BUDGET (default 200).

export const OTP_DAILY_PER_VERSION = 5;
export const OTP_DAILY_PER_DESTINATION = 10;
export const OTP_DAILY_PER_DESTINATION_GLOBAL = 30;
export const OTP_COOLDOWNS_MS = [0, 30_000, 120_000, 600_000] as const;
export const OTP_WINDOW_MS = 24 * 3600_000;
export const OTP_UNIT_COST = {email: 1, whatsapp: 1, sms: 5} as const;

/** Wait required before the next code, given how many were sent in the window. */
export function otpCooldownMs(sentInWindow: number): number {
  return OTP_COOLDOWNS_MS[Math.max(0, Math.min(OTP_COOLDOWNS_MS.length - 1, Math.floor(sentInWindow)))];
}

export function otpDailyBudget(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SCOPEFLOW_OTP_DAILY_BUDGET);
  return Number.isInteger(n) && n > 0 ? n : 200;
}

export type OtpLimitInput = {
  now: number;
  /** created times (ms) of codes sent for this version in the last 24 hours. */
  version: number[];
  /** created times (ms) of codes sent to this destination for this owner's projects in the last 24 hours. */
  destination: number[];
  /** created times (ms) of codes sent to this destination by any owner in the last 24 hours (S6 global cap). */
  destinationGlobal?: number[];
  /** cost units the owner spent today, and the unit cost of this send. */
  spent: number; cost: number; budget: number;
};
export type OtpLimit = {ok: true} | {ok: false; code: 'otp_cooldown' | 'otp_send_limit' | 'otp_destination_limit' | 'otp_budget'; retry_after: number; error: string};

/** Can a code be sent now? Seconds until it can, otherwise. */
export function otpSendAllowed(i: OtpLimitInput): OtpLimit {
  const secs = (ms: number) => Math.max(1, Math.ceil(ms / 1000));
  const v = [...i.version].sort((a, b) => a - b), d = [...i.destination].sort((a, b) => a - b);
  if (v.length >= OTP_DAILY_PER_VERSION) return {ok: false, code: 'otp_send_limit', retry_after: secs(v[v.length - OTP_DAILY_PER_VERSION] + OTP_WINDOW_MS - i.now), error: `${OTP_DAILY_PER_VERSION} codes were already sent for this link today. Use the latest one, or try again later.`};
  if (d.length >= OTP_DAILY_PER_DESTINATION) return {ok: false, code: 'otp_destination_limit', retry_after: secs(d[d.length - OTP_DAILY_PER_DESTINATION] + OTP_WINDOW_MS - i.now), error: 'Too many codes were sent to this address today. Try again later.'};
  const g = [...(i.destinationGlobal ?? [])].sort((a, b) => a - b);
  if (g.length >= OTP_DAILY_PER_DESTINATION_GLOBAL) return {ok: false, code: 'otp_destination_limit', retry_after: secs(g[g.length - OTP_DAILY_PER_DESTINATION_GLOBAL] + OTP_WINDOW_MS - i.now), error: 'Too many codes were sent to this address today. Try again later.'};
  const wait = otpCooldownMs(v.length);
  const last = v[v.length - 1];
  if (last !== undefined && i.now - last < wait) return {ok: false, code: 'otp_cooldown', retry_after: secs(last + wait - i.now), error: 'A code was sent a moment ago. Use it, or wait before asking for another.'};
  if (i.spent + i.cost > i.budget) return {ok: false, code: 'otp_budget', retry_after: secs(86400_000 - (i.now % 86400_000)), error: 'Codes cannot be sent for this creator’s projects right now. Try again tomorrow, or ask the creator.'};
  return {ok: true};
}

/** M15/SF-10: the channel to use when the owner allows several: WhatsApp, then email, then SMS. */
export function preferredChannel(o: {email?: string | null; phone?: string | null; available: ('email' | 'sms' | 'whatsapp')[]}): 'email' | 'sms' | 'whatsapp' | null {
  if (o.phone && o.available.includes('whatsapp')) return 'whatsapp';
  if (o.email && o.available.includes('email')) return 'email';
  if (o.phone && o.available.includes('sms')) return 'sms';
  return null;
}
