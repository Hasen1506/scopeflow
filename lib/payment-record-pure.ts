// Pure parts of lib/payment-record.ts: no database, no network, no server imports, so the property
// tests can load them (tests/property/money-payments-review.test.mjs). lib/payment-record.ts
// re-exports everything here, so callers keep importing from './payment-record'.

export type RecordResult = {recorded: boolean; ledger: boolean; seq?: number; duplicate?: boolean; ignored?: string; note?: string; outcome?: 'excess' | 'short'; excess_minor?: number; short_minor?: number};

/** M1: a known order whose payment did not reach the ledger (never stamp its event processed). */
export const notOnLedger = (r: RecordResult | null) => !!r && !r.ignored && r.ledger === false;
