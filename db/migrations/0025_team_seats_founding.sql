-- Studio seats, the shared activity log, and the founding-price lock on an account's plan.
CREATE TABLE IF NOT EXISTS scopeflow.account_members (
  id text PRIMARY KEY,
  account text NOT NULL,
  email text NOT NULL,
  user_id text,
  role text NOT NULL CHECK (role IN ('manager', 'member', 'finance')),
  status text NOT NULL CHECK (status IN ('invited', 'active')),
  created text NOT NULL,
  UNIQUE (account, email)
);
CREATE INDEX IF NOT EXISTS idx_account_members_email ON scopeflow.account_members (email);
CREATE INDEX IF NOT EXISTS idx_account_members_user ON scopeflow.account_members (user_id);

CREATE TABLE IF NOT EXISTS scopeflow.account_activity (
  id text PRIMARY KEY,
  account text NOT NULL,
  actor text NOT NULL,
  kind text NOT NULL,
  detail text NOT NULL,
  created text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_activity_account ON scopeflow.account_activity (account, created);

ALTER TABLE scopeflow.accounts_plans ADD COLUMN IF NOT EXISTS founding boolean NOT NULL DEFAULT false;
ALTER TABLE scopeflow.accounts_plans ADD COLUMN IF NOT EXISTS founding_until text;
