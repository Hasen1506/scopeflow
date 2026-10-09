-- Money: GST tax invoices, invoice payment reminders and Razorpay reconciliation.
--
-- business_profiles: gst_state (two-digit GST state code of the seller's registration), sac_code
-- (services accounting code printed on tax invoices) and lut_arn (letter of undertaking for
-- exports without payment of IGST). projects: the client's GSTIN, state code and billing address,
-- printed on tax invoices and used for the place of supply. All optional.
ALTER TABLE scopeflow.business_profiles ADD COLUMN IF NOT EXISTS gst_state text;
ALTER TABLE scopeflow.business_profiles ADD COLUMN IF NOT EXISTS sac_code text;
ALTER TABLE scopeflow.business_profiles ADD COLUMN IF NOT EXISTS lut_arn text;
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS client_gstin text;
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS client_state text;
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS client_address text;

-- One row per payment reminder sent for an overdue invoice (the daily job sends at most one per
-- invoice per reminder interval). Owner-private operational data, removed with the account.
CREATE TABLE IF NOT EXISTS scopeflow.invoice_reminders (
  invoice_id text NOT NULL REFERENCES scopeflow.invoices(id),
  sent text NOT NULL,
  PRIMARY KEY (invoice_id, sent)
);

-- When the reconciliation job last asked Razorpay about an unpaid order, so it backs off.
ALTER TABLE scopeflow.payments ADD COLUMN IF NOT EXISTS checked text;

REVOKE ALL ON ALL TABLES IN SCHEMA scopeflow FROM PUBLIC;
