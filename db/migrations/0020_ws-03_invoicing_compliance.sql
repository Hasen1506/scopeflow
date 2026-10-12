-- WS-03: invoicing compliance. Additive and idempotent.
--
-- credit_notes (H12): own series per owner (CN-0001 …), immutable, each against one invoice.
-- receipt_vouchers (H11): GST rule 50 vouchers for advances (RV-0001 …; PR-0001 … plain receipts for
--   sellers without a GSTIN), one per advance payment on the ledger, immutable.
-- tds_credits (H19): TDS certificates (Form 16A / 131) recorded against an invoice. Mirrored to the
--   ledger as `tds_credit` entries once WS-05 enables that kind.
-- delivery_acceptances (SF-07): the MSMED s.2(b) facts (delivery, written acceptance or objection);
--   append-only, the latest row per project/milestone is current. Mirrored to the ledger as
--   `delivery_accepted` once WS-05 enables it.
-- milestone_schedules (M9): the payment schedule frozen in minor units at the baseline's approval.
-- invoice_terms (H19/SF-07): per-project TDS default and MSMED written payment term.
-- msme_profiles (SF-07): Udyam registration per owner until WS-08's profile fields land.
-- invoices.tds_minor / gross_minor: the expected TDS and the cap-counting gross of WS-03 invoices.
-- No foreign keys to projects: account deletion (WS-08) removes these rows with the audited bypass.

ALTER TABLE scopeflow.invoices ADD COLUMN IF NOT EXISTS tds_minor bigint;
ALTER TABLE scopeflow.invoices ADD COLUMN IF NOT EXISTS gross_minor bigint;

CREATE TABLE IF NOT EXISTS scopeflow.credit_notes (
  id text PRIMARY KEY,
  owner text NOT NULL,
  project_id text NOT NULL,
  seq integer NOT NULL,
  number text NOT NULL CHECK (length(number) <= 16),
  invoice_seq integer NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  taxable_minor bigint NOT NULL,
  currency text NOT NULL,
  reason text NOT NULL,
  issued text NOT NULL,
  request_id text,
  content text NOT NULL,
  UNIQUE (owner, seq),
  UNIQUE (owner, request_id)
);
CREATE INDEX IF NOT EXISTS idx_credit_notes_project ON scopeflow.credit_notes (project_id);

CREATE TABLE IF NOT EXISTS scopeflow.receipt_vouchers (
  id text PRIMARY KEY,
  owner text NOT NULL,
  project_id text NOT NULL,
  seq integer NOT NULL,
  number text NOT NULL CHECK (length(number) <= 16),
  ledger_seq integer NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  taxable_minor bigint NOT NULL,
  currency text NOT NULL,
  issued text NOT NULL,
  content text NOT NULL,
  UNIQUE (owner, seq),
  UNIQUE (project_id, ledger_seq)
);
CREATE INDEX IF NOT EXISTS idx_receipt_vouchers_project ON scopeflow.receipt_vouchers (project_id);

CREATE TABLE IF NOT EXISTS scopeflow.tds_credits (
  id text PRIMARY KEY,
  owner text NOT NULL,
  project_id text NOT NULL,
  invoice_seq integer NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL,
  certificate_no text NOT NULL,
  form text NOT NULL CHECK (form IN ('16A', '131')),
  quarter text NOT NULL,
  received text NOT NULL,
  created text NOT NULL,
  UNIQUE (project_id, invoice_seq, certificate_no)
);
CREATE INDEX IF NOT EXISTS idx_tds_credits_project ON scopeflow.tds_credits (project_id);

CREATE TABLE IF NOT EXISTS scopeflow.delivery_acceptances (
  id text PRIMARY KEY,
  owner text NOT NULL,
  project_id text NOT NULL,
  milestone_id text,
  delivered_on text NOT NULL,
  accepted_on text,
  objection_on text,
  objection_removed_on text,
  evidence text NOT NULL DEFAULT '',
  created text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delivery_acceptances_project ON scopeflow.delivery_acceptances (project_id, created);

CREATE TABLE IF NOT EXISTS scopeflow.milestone_schedules (
  project_id text NOT NULL,
  version integer NOT NULL,
  currency text NOT NULL,
  schedule text NOT NULL,
  created text NOT NULL,
  PRIMARY KEY (project_id, version)
);

CREATE TABLE IF NOT EXISTS scopeflow.invoice_terms (
  project_id text PRIMARY KEY,
  owner text NOT NULL,
  tds text,
  msmed_agreed_days integer CHECK (msmed_agreed_days IS NULL OR msmed_agreed_days BETWEEN 1 AND 45),
  msmed_rate_basis text NOT NULL DEFAULT 'on_due_date' CHECK (msmed_rate_basis IN ('on_due_date', 'per_period')),
  updated text NOT NULL
);

CREATE TABLE IF NOT EXISTS scopeflow.msme_profiles (
  owner text PRIMARY KEY,
  udyam_number text NOT NULL,
  registered_on text NOT NULL,
  category text NOT NULL CHECK (category IN ('micro', 'small', 'medium')),
  updated text NOT NULL
);

-- Issued documents never change. Only account deletion (scopeflow.account_delete) may remove them.
CREATE OR REPLACE FUNCTION scopeflow.guard_ws03_documents() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND scopeflow.deletion_allowed() AND coalesce(current_setting('scopeflow.account_delete', true), '') = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'scopeflow: % rows are immutable once issued', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS credit_notes_immutable ON scopeflow.credit_notes;
CREATE TRIGGER credit_notes_immutable BEFORE UPDATE OR DELETE ON scopeflow.credit_notes FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_ws03_documents();
DROP TRIGGER IF EXISTS receipt_vouchers_immutable ON scopeflow.receipt_vouchers;
CREATE TRIGGER receipt_vouchers_immutable BEFORE UPDATE OR DELETE ON scopeflow.receipt_vouchers FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_ws03_documents();
DROP TRIGGER IF EXISTS tds_credits_immutable ON scopeflow.tds_credits;
CREATE TRIGGER tds_credits_immutable BEFORE UPDATE OR DELETE ON scopeflow.tds_credits FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_ws03_documents();
DROP TRIGGER IF EXISTS delivery_acceptances_immutable ON scopeflow.delivery_acceptances;
CREATE TRIGGER delivery_acceptances_immutable BEFORE UPDATE OR DELETE ON scopeflow.delivery_acceptances FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_ws03_documents();
DROP TRIGGER IF EXISTS milestone_schedules_immutable ON scopeflow.milestone_schedules;
CREATE TRIGGER milestone_schedules_immutable BEFORE UPDATE OR DELETE ON scopeflow.milestone_schedules FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_ws03_documents();

-- H11: an invoice whose whole value was paid in advance (adjusted from receipt vouchers) asks for 0.
ALTER TABLE scopeflow.invoices DROP CONSTRAINT IF EXISTS invoices_amount_check;
ALTER TABLE scopeflow.invoices ADD CONSTRAINT invoices_amount_check CHECK (amount >= 0);
