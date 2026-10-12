-- WS-05: rate cards, retainer period lookups and the ledger entry-kind check.
-- Additive and idempotent.

-- SF-06: one rate card (price book) per account. items/multipliers are JSON arrays validated by
-- lib/rate-card-core.ts; prices are integer minor units.
CREATE TABLE IF NOT EXISTS scopeflow.rate_cards (
  owner text PRIMARY KEY,
  items text NOT NULL CHECK (length(items) <= 200000),
  multipliers text NOT NULL CHECK (length(multipliers) <= 20000),
  updated text NOT NULL
);
REVOKE ALL ON scopeflow.rate_cards FROM PUBLIC;

-- SF-05: retainer period and usage entries are read per project and kind.
CREATE INDEX IF NOT EXISTS idx_ledger_retainer_kinds ON scopeflow.ledger_entries (project_id, kind, seq)
  WHERE kind IN ('period_open', 'usage', 'period_close');

-- Entry kinds the application writes (lib/ledger.ts payloadSchemas). A workstream that adds a
-- kind replaces this constraint in its own migration (DROP ... IF EXISTS, then ADD).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entries_kind_check' AND conrelid = 'scopeflow.ledger_entries'::regclass) THEN
    ALTER TABLE scopeflow.ledger_entries ADD CONSTRAINT ledger_entries_kind_check CHECK (kind IN (
      'change_order', 'settle', 'goodwill', 'revision_round', 'client_input', 'payment', 'payment_received', 'refund',
      'baseline_superseded', 'tds_credit', 'excess_payment', 'delivery_accepted', 'payment_claim_confirmed',
      'period_open', 'usage', 'period_close'));
  END IF;
END $$;
