// Phase 0 contract (type-only, frozen). Changes need the agreement of every workstream owner.
// See docs/contracts.md.

/**
 * An amount in integer minor units of its currency (paise for INR, cents for USD, yen for JPY),
 * always a safe integer. The brand is optional so plain numbers stay assignable; it documents
 * intent at API boundaries.
 */
export type Minor = number & {readonly __minor?: 'Minor'};

/** The tax heads a breakdown can carry. `GST` is the single undivided head (no place of supply). */
export type TaxHeadName = 'CGST' | 'SGST' | 'IGST' | 'GST';

/** One tax head of a breakdown. `rate` is a percentage (9 for 9%). */
export type GstHead = {name: TaxHeadName; rate: number; amount: Minor};

/**
 * GST on one amount, in minor units: `total - round_off === taxable + sum(heads.amount)`.
 * `round_off` is the explicit rounding line on an Indian invoice (may be negative).
 */
export type GstBreakdown = {taxable: Minor; heads: GstHead[]; round_off: Minor; total: Minor};

/** Why money moved, as the money fold groups it. */
export type MoneyPurpose = 'deposit' | 'invoice' | 'recorded' | 'refund' | 'tds_credit' | 'excess';

/** Money on a project, in minor units of the agreement currency. */
export type MoneyState = {
  received: Minor;
  refunded: Minor;
  tds_credited: Minor;
  excess: Minor;
  by_purpose: Partial<Record<MoneyPurpose, Minor>>;
  deposit: {due: Minor; paid: Minor; covered: boolean};
};
