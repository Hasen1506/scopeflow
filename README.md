# Scopeflow early beta

Client scope approvals for freelancers: immutable versions, bearer review links, client decisions, version history, account-scoped API tokens, and a staging-only WebMCP draft tool, scope templates, project search and status filters, project JSON export, review-link revocation/replacement, self-service deletion of account data, and five authenticated MCP tools. Scopes can be reused as new drafts; unsaved work warns before replacement and browser creation retries use idempotency keys.

## Render and Neon

The app runs on Node 24 with Next.js. Neon PostgreSQL stores application data;
Neon Auth handles signup, login, logout, and password recovery. Clients review
scopes using their private links without creating accounts. Cloudflare and
OpenAI Sites authentication are no longer runtime requirements.

See [the deployment guide](docs/render-deployment.md) for the Render Blueprint,
Neon setup, required environment variables, and live checks.

```sh
npm ci --include=dev --include=optional
# Copy .env.example to .env.local and configure a Neon development branch.
npm run db:migrate
npm run dev
```

## Validation

`npm run build` generates the Next.js production build; `npm start` listens on
Render's `PORT`. `npm run typecheck` checks types. Pure logic tests run with
`node tests/unit.mjs`. For auth, storage, account isolation, immutable versions,
review links, MCP tools, and ledger checks, follow the guide's disposable local
PostgreSQL/auth fixture setup and run `npm run test:local`. These suites refuse
remote database targets and must not run on production data.

The repository's existing lint findings are separate from deployment setup.
Run `npm run lint` to inspect them. Billing remains disabled. Live Neon email
verification/recovery, Render deployment, operational monitoring, and connector
directory approval require external setup and verification.

## Storage and limits

PostgreSQL migrations are in `db/migrations`. Legacy SQLite migrations in
`drizzle` are retained for historical regression tests. API tokens are hashed
at rest, expire after 30 days, and can be revoked. Account ownership checks,
transactional writes, immutable versions, link revocation, self-service deletion,
and beta caps remain in place. The application uses a private `scopeflow`
database schema and never exposes its database connection string to the browser.

## Scope ledger

Scopes use structured deliverables with stable IDs, plain-language version
diffs, and a clarity linter. After approval, the append-only hash-chained ledger
tracks change orders, revision rounds, late client inputs, and goodwill. The
client review page verifies the chain. The scope checker uses a transparent
keyword heuristic; it does not call an AI model or collect payment.

The REST API and `/mcp` accept account-scoped Scopeflow API tokens. Neon website
sessions also authorize browser requests. OpenAI Sites managed OAuth no longer
applies to Render hosting. Do not use trusted-user request headers as login.

Existing deployed D1 data and account identities are not automatically moved
by this change. See the deployment guide before migrating existing customers.
