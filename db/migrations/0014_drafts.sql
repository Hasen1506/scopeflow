-- Unsaved scope drafts, kept with the account instead of in one browser: they follow the owner
-- to any device, survive signing out, and nothing is left in the browser afterwards. One draft
-- per account (the new scope being written); it is removed when that scope is saved, when the
-- owner discards it, by account deletion, and by the daily job after 90 days without an edit.
CREATE TABLE IF NOT EXISTS scopeflow.drafts (
  owner text PRIMARY KEY,
  content text NOT NULL CHECK (length(content) <= 60000),
  updated text NOT NULL
);
CREATE INDEX IF NOT EXISTS drafts_updated ON scopeflow.drafts (updated);
