# Scopeflow early beta

Client scope approvals for freelancers: immutable versions, bearer review links, client decisions, version history, account-scoped API tokens, and a staging-only WebMCP draft tool, scope templates, project search and status filters, project JSON export, review-link revocation/replacement, self-service deletion of account data, and five authenticated MCP tools. Scopes can be reused as new drafts; unsaved work warns before replacement and browser creation retries use idempotency keys.

## Scope ledger (0.3.0)

Scopes are made of structured deliverables with stable ids, so versions show plain-language diffs and a linter scores clarity before saving. Once the client approves the latest version, it becomes the baseline of an append-only ledger: change orders (approved or declined by the client on the review link they already have), revision rounds used, late client inputs that move the delivery date, and logged goodwill. Each entry is hash-chained to the previous one and anchored to the approved scope; the review page recomputes the chain in the client's browser. "Is this in scope?" is a transparent keyword heuristic that cites deliverables and exclusion clauses; MCP tools give the user's own agent the structured agreement to judge. See docs/plan-scope-ledger.md for the design.

Run `node tests/unit.mjs` (no server) and `node tests/ledger.mjs` against a local preview. `node scripts/dev-migrate.mjs` applies migrations to the `npm run dev` database. The account write limit (30/minute) can trip when suites run back to back; wait a minute between them.

## Status

Built for functional and security review, not certified for production or millions of users. Muse approval, live end-to-end Muse testing, production capacity validation, billing, monitoring/alerting, operational recovery drills are pending. Proposed Solo pricing: $4/month or $36/year, with a free first-project tier. See docs/pricing-economics.md for modeled costs and margins. Billing is disabled.

Public routes: /, /connect, /reviewer-guide, /privacy, /terms, /plans, /api, /api/openapi and bearer review links. Account data requires platform sign-in or an account-scoped token. Review URLs authorize reading and one decision; share deliberately. Names are self-reported, not verified signatures.

## Storage and limits

Cloudflare D1 through Sites DB binding. Drizzle migrations are in drizzle/. Tokens are hashed at rest and expire after 30 days. One active API token per account. Caps: 100 projects/account, 100 versions/project, 24 KB input bodies, 30 scope write attempts/account/minute, 10 key generations/account/minute, 10 decision attempts/review/minute. These are beta controls, not a complete abuse prevention system. Authenticated rate checks themselves consume DB writes.

## Verification

Local API smoke tests cover auth requirements, validation, origin protection, create/revise/history, immutable versions, stale and duplicate decisions, token issuance and revocation. These are functional checks, not an independent penetration test or a scalability benchmark. Local integration tests additionally verify API authorization across two account identities, MCP discovery/auth and creates/revisions, idempotent retries, oversized input, and revoked/replaced URLs. Production two-account isolation and real ChatGPT/Muse connection testing still need completion.

Run `node tests/account-deletion.mjs` to verify confirmed browser-only deletion, transaction rollback, account isolation, link and token invalidation, and starting fresh. This deletes fictional data in the local test account only.

Run `node tests/integration.mjs` against a running local preview after local migrations. The script refuses non-localhost targets and creates fictional disposable fixtures. Run `node tests/core.mjs` for the original workflow smoke tests.

## Deployment

Use the Sites skills and the existing project_id in .openai/hosting.json. Do not create another site. Generate schema migrations before packaging. Never include local test data, credentials, .wrangler, node_modules, or environment files in source commits. Use a branded custom hostname before directory submission, per the owner's requirement.

Run `node scripts/dev-migrate.mjs` after loading the local preview, then `node tests/run-local.mjs` to run all workflow and regression suites against fictional localhost data. This test run clears local request counters and deletes the local test account data. Project exports now contain every scope version and all ledger entries, including private goodwill notes. Store them securely.
