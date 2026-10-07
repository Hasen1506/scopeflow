-- PR D: the creator's own scope templates ("save as template"). Built-in starter templates
-- stay in code (lib/templates.ts); these rows are private to their owner, editable and
-- deletable, and removed with the account.
CREATE TABLE IF NOT EXISTS scopeflow.templates (
  id text PRIMARY KEY,
  owner text NOT NULL,
  name text NOT NULL,
  content text NOT NULL,
  created text NOT NULL,
  updated text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_owner ON scopeflow.templates(owner);
REVOKE ALL ON ALL TABLES IN SCHEMA scopeflow FROM PUBLIC;
