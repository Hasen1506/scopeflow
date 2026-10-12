-- WS-06: messaging, capture channels and the AI radar.
-- Additive and idempotent. Every table that holds client data references its project with
-- ON DELETE CASCADE, so project and account deletion remove it with the project.

-- Per-project switch for client notifications (change order proposed, invoice issued, payment
-- reminder). On by default (H18).
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS notify_client boolean NOT NULL DEFAULT true;

-- The owner's own sign-in address and whether the auth provider verified it. Recorded from the
-- owner's browser session; used for the inbound allow-list (L7) and the "<Business> via
-- ScopeFlow" display name, which needs a verified owner address (M19).
CREATE TABLE IF NOT EXISTS scopeflow.owner_contacts (
  owner text PRIMARY KEY,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  updated text NOT NULL
);

-- Mail outbox (SF-19): every outbound email is one row, rendered once, sent through the mail
-- router (per-class provider order with failover) and retried from here. dedupe_key makes a
-- notification idempotent however many times its trigger fires. Bodies are cleared 30 days after
-- delivery by the reminders job.
CREATE TABLE IF NOT EXISTS scopeflow.mail_outbox (
  id text PRIMARY KEY,
  owner text,
  project_id text REFERENCES scopeflow.projects(id) ON DELETE CASCADE,
  event text NOT NULL,
  class text NOT NULL CHECK (class IN ('transactional', 'auth', 'bulk')),
  recipient text NOT NULL,
  recipient_domain text NOT NULL,
  subject text,
  body_text text,
  body_html text,
  headers text,
  from_name text,
  reply_to text,
  dedupe_key text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'suppressed', 'no_provider', 'dev_log', 'refused')),
  provider text,
  provider_message_id text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt text,
  created text NOT NULL,
  sent text
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_outbox_dedupe ON scopeflow.mail_outbox(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mail_outbox_owner ON scopeflow.mail_outbox(owner, created);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_recipient ON scopeflow.mail_outbox(recipient, created);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_project ON scopeflow.mail_outbox(project_id, event);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_retry ON scopeflow.mail_outbox(status, next_attempt) WHERE status = 'queued';

-- One suppression list fed by every provider's bounce and complaint webhooks (and unsubscribes,
-- which suppress bulk mail only). Addresses are stored lower-cased.
CREATE TABLE IF NOT EXISTS scopeflow.mail_suppressions (
  address text PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('hard_bounce', 'complaint', 'unsubscribed', 'manual')),
  provider text,
  created text NOT NULL
);
-- Webhook deliveries already processed (provider retries are acknowledged, not re-applied).
CREATE TABLE IF NOT EXISTS scopeflow.mail_provider_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  created text NOT NULL,
  PRIMARY KEY (provider, event_id)
);

-- Notification queue fed by database triggers, so a change order proposed from the owner UI, the
-- API or MCP (all write ledger_entries) and an issued invoice are always queued, whichever route
-- wrote them. lib/notify.ts drains it into the outbox.
CREATE TABLE IF NOT EXISTS scopeflow.notify_events (
  id bigserial PRIMARY KEY,
  event text NOT NULL,
  project_id text NOT NULL REFERENCES scopeflow.projects(id) ON DELETE CASCADE,
  ref text NOT NULL,
  created text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped', 'failed')),
  processed text,
  UNIQUE (event, project_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_notify_events_pending ON scopeflow.notify_events(project_id) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION scopeflow.ws06_queue_change_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'change_order' AND NEW.actor = 'owner' THEN
    INSERT INTO scopeflow.notify_events (event, project_id, ref, created)
    VALUES ('co_proposed', NEW.project_id, NEW.seq::text, NEW.created) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER ws06_notify_change_order AFTER INSERT ON scopeflow.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION scopeflow.ws06_queue_change_order();

CREATE OR REPLACE FUNCTION scopeflow.ws06_queue_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO scopeflow.notify_events (event, project_id, ref, created)
  VALUES ('invoice_issued', NEW.project_id, NEW.seq::text, NEW.issued) ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER ws06_notify_invoice AFTER INSERT ON scopeflow.invoices
  FOR EACH ROW EXECUTE FUNCTION scopeflow.ws06_queue_invoice();

-- Inbound email hardening (L7): senders outside the project allow-list (client, cosigners, owner)
-- and mail that failed SPF/DKIM are held here instead of reaching the radar inbox. The owner can
-- release a message (optionally allowing its sender from then on) or dismiss it.
CREATE TABLE IF NOT EXISTS scopeflow.inbound_quarantine (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES scopeflow.projects(id) ON DELETE CASCADE,
  message_id text,
  received text NOT NULL,
  sender text,
  subject text,
  body text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('unknown_sender', 'auth_failed')),
  auth text,
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released', 'dismissed'))
);
CREATE INDEX IF NOT EXISTS idx_inbound_quarantine_project ON scopeflow.inbound_quarantine(project_id, received);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_quarantine_message ON scopeflow.inbound_quarantine(project_id, message_id) WHERE message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS scopeflow.inbound_allow (
  project_id text NOT NULL REFERENCES scopeflow.projects(id) ON DELETE CASCADE,
  address text NOT NULL,
  created text NOT NULL,
  PRIMARY KEY (project_id, address)
);

-- WhatsApp: the owner's linked phone for the forward-to-bot (SF-04), verified by a one-time code.
-- consent records when the owner accepted the bot's terms.
CREATE TABLE IF NOT EXISTS scopeflow.wa_links (
  owner text PRIMARY KEY,
  phone text NOT NULL UNIQUE,
  verified text NOT NULL,
  consent text NOT NULL
);
CREATE TABLE IF NOT EXISTS scopeflow.wa_link_codes (
  owner text PRIMARY KEY,
  phone text NOT NULL,
  code_hash text NOT NULL,
  expires text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 1,
  created text NOT NULL
);
-- Outbound WhatsApp messages from ScopeFlow's own number: bot replies (only ever to the linked
-- owner who wrote, inside the service window), link codes and OTP template messages.
CREATE TABLE IF NOT EXISTS scopeflow.wa_outbox (
  id text PRIMARY KEY,
  owner text,
  to_phone text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reply', 'onboarding', 'otp', 'link_code')),
  body text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'dev_log', 'not_configured')),
  provider_message_id text,
  error text,
  created text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_outbox_owner ON scopeflow.wa_outbox(owner, created);
-- A forwarded message waiting for the owner to pick its project ("Which project? 1) … 2) …").
CREATE TABLE IF NOT EXISTS scopeflow.wa_pending (
  owner text PRIMARY KEY,
  text text NOT NULL,
  created text NOT NULL
);
-- Webhook message ids already handled (linked owners only), so Meta's retries are not re-run.
CREATE TABLE IF NOT EXISTS scopeflow.wa_seen (
  message_id text PRIMARY KEY,
  created text NOT NULL
);

-- Captured client requests (PWA share target and the WhatsApp bot): the text, the radar verdict
-- and a prefilled change order the owner reviews before proposing it. Nothing here is sent.
CREATE TABLE IF NOT EXISTS scopeflow.capture_drafts (
  id text PRIMARY KEY,
  owner text NOT NULL,
  project_id text REFERENCES scopeflow.projects(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('share', 'whatsapp')),
  text text NOT NULL,
  url text,
  files integer NOT NULL DEFAULT 0,
  radar text,
  created text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_capture_drafts_owner ON scopeflow.capture_drafts(owner, created);

-- Warnings for /api/readiness (WS-10 reads this table): for example an AI model that answered
-- 404 and was replaced by its fallback (L11).
CREATE TABLE IF NOT EXISTS scopeflow.readiness_warnings (
  key text PRIMARY KEY,
  source text NOT NULL,
  message text NOT NULL,
  at text NOT NULL
);
