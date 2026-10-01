# Scopeflow early beta

Client scope approvals for freelancers: immutable versions, bearer review links, client decisions, version history, account-scoped API tokens, and a staging-only WebMCP draft tool, scope templates, project search and status filters, project JSON export, review-link revocation/replacement, and five authenticated MCP tools.

## Status

Built for functional and security review, not certified for production or millions of users. Muse approval, live end-to-end Muse testing, production capacity validation, billing, monitoring/alerting, automated account deletion and operational recovery drills are pending. Proposed pricing: Solo $9/month and Studio $19/month. Billing is disabled.

Public routes: /, /connect, /reviewer-guide, /privacy, /terms, /plans, /api, /api/openapi and bearer review links. Account data requires platform sign-in or an account-scoped token. Review URLs authorize reading and one decision; share deliberately. Names are self-reported, not verified signatures.

## Storage and limits

Cloudflare D1 through Sites DB binding. Drizzle migrations are in drizzle/. Tokens are hashed at rest and expire after 30 days. One active API token per account. Caps: 100 projects/account, 100 versions/project, 24 KB input bodies, 30 scope write attempts/account/minute, 10 key generations/account/minute, 10 decision attempts/review/minute. These are beta controls, not a complete abuse prevention system. Authenticated rate checks themselves consume DB writes.

## Verification

Local API smoke tests cover auth requirements, validation, origin protection, create/revise/history, immutable versions, stale and duplicate decisions, token issuance and revocation. These are functional checks, not an independent penetration test or a scalability benchmark. Local integration tests additionally verify API authorization across two account identities, MCP discovery/auth and creates/revisions, idempotent retries, oversized input, and revoked/replaced URLs. Production two-account isolation and real ChatGPT/Muse connection testing still need completion.

Run `node tests/integration.mjs` against a running local preview after local migrations. The script refuses non-localhost targets and creates fictional disposable fixtures. Run `node tests/core.mjs` for the original workflow smoke tests.

## Deployment

Use the Sites skills and the existing project_id in .openai/hosting.json. Do not create another site. Generate schema migrations before packaging. Never include local test data, credentials, .wrangler, node_modules, or environment files in source commits. Use a branded custom hostname before directory submission, per the owner's requirement.
