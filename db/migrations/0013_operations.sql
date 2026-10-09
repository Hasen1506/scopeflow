-- Product and operations: per-project retention and legal hold, automatic expiry of archived
-- drafts, owner branding, email forwarding into the radar, shared and versioned templates.

-- projects.retention_days overrides the owner's context_retention_days for one project (NULL =
-- the account setting). legal_hold freezes a project: no redaction, no draft expiry, no deletion
-- (and no account deletion) until the owner lifts it. legal_hold_reason is the owner's note.
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS retention_days integer CHECK (retention_days IS NULL OR retention_days BETWEEN 1 AND 3650);
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS legal_hold_reason text;
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS legal_hold_set text;
-- account_settings.draft_expiry_days (NULL = keep): archived projects that never got a client
-- decision or ledger entry are deleted that many days after they were archived.
ALTER TABLE scopeflow.account_settings ADD COLUMN IF NOT EXISTS draft_expiry_days integer CHECK (draft_expiry_days IS NULL OR draft_expiry_days BETWEEN 7 AND 3650);

-- Branding on the review page, PDFs and emails: an accent colour (#rrggbb), a small logo
-- (data: URL, PNG or JPEG, at most 150 KB) and the reply-to address for client emails.
ALTER TABLE scopeflow.business_profiles ADD COLUMN IF NOT EXISTS brand_color text;
ALTER TABLE scopeflow.business_profiles ADD COLUMN IF NOT EXISTS logo text;
ALTER TABLE scopeflow.business_profiles ADD COLUMN IF NOT EXISTS reply_to text;
-- logo_hash addresses the logo for email clients (GET /api/brand/<hash>) without revealing the owner.
ALTER TABLE scopeflow.business_profiles ADD COLUMN IF NOT EXISTS logo_hash text;
CREATE INDEX IF NOT EXISTS idx_profiles_logo ON scopeflow.business_profiles(logo_hash) WHERE logo_hash IS NOT NULL;

-- Email forwarding into the radar: each project can get a private inbound address
-- (scope-<inbound_token>@SCOPEFLOW_INBOUND_DOMAIN). Forwarded client emails are checked by the
-- radar and kept here for the owner; nothing is sent or recorded on the ledger automatically.
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS inbound_token text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_inbound ON scopeflow.projects(inbound_token) WHERE inbound_token IS NOT NULL;
CREATE TABLE IF NOT EXISTS scopeflow.inbound_messages (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES scopeflow.projects(id),
  message_id text,
  received text NOT NULL,
  sender text,
  subject text,
  body text NOT NULL,
  radar text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'dismissed', 'done'))
);
CREATE INDEX IF NOT EXISTS idx_inbound_project ON scopeflow.inbound_messages(project_id, received);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_message_id ON scopeflow.inbound_messages(project_id, message_id) WHERE message_id IS NOT NULL;

-- Templates: tags, a revision counter with history, and a share link another owner can import.
ALTER TABLE scopeflow.templates ADD COLUMN IF NOT EXISTS tags text NOT NULL DEFAULT '[]';
ALTER TABLE scopeflow.templates ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE scopeflow.templates ADD COLUMN IF NOT EXISTS share_token text;
ALTER TABLE scopeflow.templates ADD COLUMN IF NOT EXISTS origin text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_share ON scopeflow.templates(share_token) WHERE share_token IS NOT NULL;
CREATE TABLE IF NOT EXISTS scopeflow.template_revisions (
  template_id text NOT NULL REFERENCES scopeflow.templates(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  name text NOT NULL,
  content text NOT NULL,
  created text NOT NULL,
  PRIMARY KEY (template_id, revision)
);

-- Online payments: what a provider order pays for (the deposit, or one issued invoice) and refunds.
ALTER TABLE scopeflow.payments ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'deposit';
ALTER TABLE scopeflow.payments ADD COLUMN IF NOT EXISTS invoice_seq integer;

-- Project deletion (drafts) and account deletion also remove inbound messages.
REVOKE ALL ON ALL TABLES IN SCHEMA scopeflow FROM PUBLIC;
