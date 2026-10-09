-- When the review link was last emailed through Scopeflow, and how many reminders followed.
--
-- last_sent / sent_version: the time and version of the latest email delivered by the provider
-- (a copied link or the owner's own mail app is not tracked). reminders: reminder emails sent for
-- sent_version; a first send of a new version resets it. Owner-private project metadata, outside
-- the signed content, so none of it affects receipts or the ledger.
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS last_sent text;
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS sent_version integer;
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS reminders integer NOT NULL DEFAULT 0;
