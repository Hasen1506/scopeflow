-- WS-01 (M3/M4): exact minor units for issued invoices.
-- invoices.amount is double precision (0010). Issued invoices are immutable (guard_invoices refuses
-- UPDATE), so the minor-unit columns are GENERATED from the stored amount and currency: adding them
-- rewrites the table without firing row triggers, every existing row is backfilled, and new rows
-- get them automatically. The amount goes through numeric (exact decimal; half away from zero).
-- Additive and idempotent.

-- ISO 4217 exponent (decimal places) per currency; matches config/currencies.ts and lib/minor.ts.
-- IMMUTABLE because the generated columns depend on it: never change an existing code's exponent.
CREATE OR REPLACE FUNCTION scopeflow.currency_exponent(code text) RETURNS smallint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN code IN ('JPY','KRW','VND','CLP','ISK','UGX','XAF','XOF','XPF','PYG','RWF','KMF','GNF','DJF','VUV') THEN 0
    WHEN code IN ('KWD','BHD','OMR','JOD','TND','LYD','IQD') THEN 3
    ELSE 2
  END::smallint
$$;

ALTER TABLE scopeflow.invoices
  ADD COLUMN IF NOT EXISTS currency_exponent smallint GENERATED ALWAYS AS (scopeflow.currency_exponent(currency)) STORED;
ALTER TABLE scopeflow.invoices
  ADD COLUMN IF NOT EXISTS amount_minor bigint GENERATED ALWAYS AS (round(amount::numeric * (10::numeric ^ scopeflow.currency_exponent(currency)))::bigint) STORED;

COMMENT ON COLUMN scopeflow.invoices.amount_minor IS 'WS-01: the invoice total in integer minor units of currency (exact, from amount).';
COMMENT ON COLUMN scopeflow.invoices.currency_exponent IS 'WS-01: ISO 4217 decimal places of currency.';
