// Rate card storage (SF-06, owner: WS-05). Server-only: one row per account in scopeflow.rate_cards
// (db/migrations/0018_ws-05_ledger_retainers.sql). The pure pricing lives in lib/rate-card-core.ts
// and is re-exported here, so consumers (WS-06 radar, MCP) import one module.
import {db} from './server';
import {EMPTY_RATE_CARD, rateCardSchema, type RateCard} from './rate-card-core';

export * from './rate-card-core';

/** The account's rate card; an empty card with the default multipliers when none is saved. */
export async function rateCardFor(owner: string): Promise<RateCard> {
  const row = await db().prepare('SELECT items,multipliers FROM scopeflow.rate_cards WHERE owner=?').bind(owner).first<{items: string; multipliers: string}>();
  if (!row) return EMPTY_RATE_CARD;
  const parsed = rateCardSchema.safeParse({items: JSON.parse(row.items), multipliers: JSON.parse(row.multipliers)});
  return parsed.success ? parsed.data : EMPTY_RATE_CARD;
}

/** Replaces the account's rate card (validated by the caller with rateCardSchema). */
export async function saveRateCard(owner: string, card: RateCard): Promise<RateCard> {
  const now = new Date().toISOString();
  await db().prepare('INSERT INTO scopeflow.rate_cards (owner,items,multipliers,updated) VALUES (?,?,?,?) ON CONFLICT (owner) DO UPDATE SET items=excluded.items, multipliers=excluded.multipliers, updated=excluded.updated')
    .bind(owner, JSON.stringify(card.items), JSON.stringify(card.multipliers), now).run();
  return card;
}
