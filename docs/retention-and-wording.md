# Client-data retention and your wording

Data controls has two new sections, stored per account (`GET/PUT /api/settings`):

- **Client data retention** (`context_retention_days`: 1–3650 or none). After that many days the IP address and
  browser user agent recorded with client decisions and client ledger entries are replaced with "redacted"
  (plus `redacted_at`). Signed fields are untouched, so receipts and the chain keep verifying. A database rule
  (migration 0008) allows exactly that change, and only inside a transaction that sets `scopeflow.redact`.
  It runs when the owner opens their project list, when they save settings, and for everyone from
  `node scripts/redact-expired.mjs` (run it daily, e.g. a Render Cron Job). `SCOPEFLOW_CONTEXT_RETENTION_DAYS`
  sets a server default for owners who chose none.
- **Your wording**: the "Send for signature" subject and message (placeholders `{client}`, `{title}`,
  `{version}`, `{link}`; the message must include `{link}`), and default "Outside this scope" and working-terms
  text pre-filled into new drafts.
