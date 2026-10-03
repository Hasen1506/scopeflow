CREATE TABLE scopeflow.projects (
  id text PRIMARY KEY, owner text NOT NULL, latest integer NOT NULL,
  created text NOT NULL
);
CREATE INDEX idx_projects_owner ON scopeflow.projects(owner);
CREATE TABLE scopeflow.versions (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES scopeflow.projects(id),
  version integer NOT NULL, token text NOT NULL, revoked integer NOT NULL DEFAULT 0,
  content text NOT NULL, status text NOT NULL DEFAULT 'pending', signer text,
  comment text, created text NOT NULL, decided text,
  CONSTRAINT idx_versions_project_version UNIQUE(project_id, version),
  CONSTRAINT idx_versions_token UNIQUE(token)
);
CREATE TABLE scopeflow.api_keys (
  hash text PRIMARY KEY, owner text NOT NULL, expires text NOT NULL, created text NOT NULL
);
CREATE INDEX idx_api_keys_owner ON scopeflow.api_keys(owner);
CREATE TABLE scopeflow.rate_limits (
  id text PRIMARY KEY, window_id integer NOT NULL, hits integer NOT NULL
);
CREATE TABLE scopeflow.ledger_entries (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES scopeflow.projects(id),
  seq integer NOT NULL, kind text NOT NULL, baseline_version integer NOT NULL,
  actor text NOT NULL, payload text NOT NULL, ref text, prev_hash text NOT NULL,
  hash text NOT NULL, created text NOT NULL,
  CONSTRAINT idx_ledger_project_seq UNIQUE(project_id, seq),
  CONSTRAINT idx_ledger_project_ref UNIQUE(project_id, ref)
);
REVOKE ALL ON ALL TABLES IN SCHEMA scopeflow FROM PUBLIC;
