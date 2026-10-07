-- PR B: optional email one-time code before a client signs.
--
-- `require_otp` is owner-private project metadata (like client_email): when true, a decision
-- through the review link is accepted only after the reviewer proves control of the project's
-- client email with a 6-digit code. Codes are stored only as salted SHA-256 hashes, expire after
-- 10 minutes and allow 5 attempts; a verified code yields a short-lived session whose hash is
-- kept here so the decision can be tied to it.
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS require_otp boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS scopeflow.review_otps (
  id text PRIMARY KEY,
  version_id text NOT NULL REFERENCES scopeflow.versions(id) ON DELETE CASCADE,
  email text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires text NOT NULL,
  created text NOT NULL,
  verified text,
  session_hash text
);
CREATE INDEX IF NOT EXISTS idx_review_otps_version ON scopeflow.review_otps(version_id, created);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_otps_session ON scopeflow.review_otps(session_hash) WHERE session_hash IS NOT NULL;
REVOKE ALL ON ALL TABLES IN SCHEMA scopeflow FROM PUBLIC;
