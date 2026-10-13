import {randomInt, createHash, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {getUser} from '@/lib/auth/server';
import {db, json, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {maskPhone, phoneSchemaPattern, sendOtpMessage, OtpTransportError} from '@/lib/sms';
import {botConfigured} from '@/lib/wa-outbox';

// Linking the owner's WhatsApp number to the forward-to-bot (SF-04, WS-06). Browser session only
// (never an API token): POST {phone, consent: true} sends a 6-digit code to that number on
// WhatsApp; POST {phone, code} links it; DELETE unlinks. One number per owner and one owner per
// number. Codes are hashed, expire after 10 minutes, allow 5 attempts and 3 sends per hour.

const CONSENT = 'I agree that Scopeflow reads the messages I forward to its WhatsApp number to check them against my agreements and replies to me only. Scopeflow never messages my clients.';
const start = z.object({phone: z.string().trim().regex(phoneSchemaPattern, 'Use the international format, e.g. +919876543210'), consent: z.literal(true)}).strict();
const confirm = z.object({phone: z.string().trim().regex(phoneSchemaPattern), code: z.string().trim().regex(/^\d{6}$/)}).strict();
const hash = (owner: string, phone: string, code: string) => createHash('sha256').update(`scopeflow-wa-link-v1|${owner}|${phone}|${code}`).digest('hex');

async function session(request: Request) { return request.headers.has('authorization') ? null : getUser(); }

export async function GET(request: Request) {
  try {
    const user = await session(request);
    if (!user) return json({error: 'Sign in to link WhatsApp.'}, 401);
    const link = await db().prepare('SELECT phone,verified FROM scopeflow.wa_links WHERE owner=?').bind(user.userId).first<{phone: string; verified: string}>();
    return json({configured: botConfigured(), linked: link ? {phone: maskPhone(link.phone), since: link.verified} : null, bot_number: process.env.WHATSAPP_BOT_NUMBER?.trim() || null, consent: CONSENT});
  } catch (e) { return failure(e); }
}

export async function POST(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const user = await session(request);
    if (!user) return json({error: 'Sign in to link WhatsApp.'}, 401);
    if (!botConfigured()) return json({error: 'The WhatsApp bot is not configured on this server.', code: 'whatsapp_disabled'}, 503);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const verify = confirm.safeParse(raw);
    if (verify.success) {
      const {phone, code} = verify.data;
      const row = await db().prepare('UPDATE scopeflow.wa_link_codes SET attempts=attempts+1 WHERE owner=? AND phone=? RETURNING code_hash,expires,attempts').bind(user.userId, phone).first<{code_hash: string; expires: string; attempts: number}>();
      if (!row || Date.parse(row.expires) < Date.now() || row.attempts > 5) return json({error: 'The code has expired. Ask for a new one.', code: 'code_expired'}, 410);
      const a = Buffer.from(row.code_hash), b = Buffer.from(hash(user.userId, phone, code));
      if (a.length !== b.length || !timingSafeEqual(a, b)) return json({error: 'That code is not right.', code: 'code_invalid'}, 400);
      const taken = await db().prepare('SELECT owner FROM scopeflow.wa_links WHERE phone=?').bind(phone).first<{owner: string}>();
      if (taken && taken.owner !== user.userId) return json({error: 'This number is linked to another Scopeflow account.', code: 'phone_taken'}, 409);
      const now = new Date().toISOString();
      await db().prepare('INSERT INTO scopeflow.wa_links (owner,phone,verified,consent) VALUES (?,?,?,?) ON CONFLICT (owner) DO UPDATE SET phone=excluded.phone, verified=excluded.verified, consent=excluded.consent').bind(user.userId, phone, now, now).run();
      await db().prepare('DELETE FROM scopeflow.wa_link_codes WHERE owner=?').bind(user.userId).run();
      return json({linked: {phone: maskPhone(phone), since: now}}, 201);
    }
    const input = start.safeParse(raw);
    if (!input.success) return json({error: 'Provide your WhatsApp number in international format and accept the consent text, or the 6-digit code.', consent: CONSENT}, 400);
    const {phone} = input.data;
    if (!await allowWrite('wa-link:' + user.userId, 3)) return json({error: 'Too many codes. Try again in a minute.'}, 429);
    const prior = await db().prepare('SELECT sent,created FROM scopeflow.wa_link_codes WHERE owner=?').bind(user.userId).first<{sent: number; created: string}>();
    const recent = prior && Date.now() - Date.parse(prior.created) < 3600_000;
    if (recent && prior.sent >= 3) return json({error: 'You asked for 3 codes in the last hour. Try again later.', code: 'code_limit'}, 429);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db().prepare('INSERT INTO scopeflow.wa_link_codes AS c (owner,phone,code_hash,expires,attempts,sent,created) VALUES (?,?,?,?,0,1,?) ON CONFLICT (owner) DO UPDATE SET phone=excluded.phone, code_hash=excluded.code_hash, expires=excluded.expires, attempts=0, sent=CASE WHEN ? THEN c.sent+1 ELSE 1 END, created=CASE WHEN ? THEN c.created ELSE excluded.created END')
      .bind(user.userId, phone, hash(user.userId, phone, code), new Date(Date.now() + 600_000).toISOString(), new Date().toISOString(), !!recent, !!recent).run();
    try {
      const sent = await sendOtpMessage('whatsapp', phone, code, {title: 'linking WhatsApp', idempotencyKey: `scopeflow-walink-${user.userId}-${Date.now()}`});
      return json({sent: true, to: maskPhone(phone), channel: sent.channel, expires_in: 600});
    } catch (e) {
      if (e instanceof OtpTransportError) return json({error: 'The code could not be sent on WhatsApp. Check the number and try again.', code: 'send_failed'}, 502);
      throw e;
    }
  } catch (e) { return failure(e); }
}

export async function DELETE(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const user = await session(request);
    if (!user) return json({error: 'Sign in to link WhatsApp.'}, 401);
    await db().prepare('DELETE FROM scopeflow.wa_links WHERE owner=?').bind(user.userId).run();
    await db().prepare('DELETE FROM scopeflow.wa_pending WHERE owner=?').bind(user.userId).run();
    return json({linked: null});
  } catch (e) { return failure(e); }
}
