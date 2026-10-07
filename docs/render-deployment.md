# Deploy Scopeflow to Render with Neon

Scopeflow now runs as a Node 24 / Next.js web service. Neon PostgreSQL stores
projects, immutable versions, review links, API tokens, request counters, and
ledger entries. Neon Auth handles accounts, password hashing, email signup,
login, logout, verification, and password recovery. Reviewers use their private
review links and do not need accounts. No Cloudflare account, persistent Render
disk, file-storage service, payment provider, or AI API key is required.

## Prepare Neon

1. Select the Neon project and branch you want to use for Scopeflow. Prefer a
   separate branch/database for development and testing.
2. From **Connect**, copy the pooled PostgreSQL connection string, including its
   database role and password. Store it as `DATABASE_URL` in Render's secret
   environment settings. The app verifies TLS, supports SCRAM channel binding, and uses unnamed queries
   for compatibility with Neon's pooler.
3. Enable the current **Neon Auth** service for that same branch. Copy its full
   Auth URL into `NEON_AUTH_BASE_URL`. This SDK targets the Better Auth based
   service, not legacy Stack Auth.
4. Enable email/password accounts in Neon Auth. Add the exact Render HTTPS
   origin to the service's trusted origins/allowed domains. Add your custom
   domain when you configure one. Configure verification and password-recovery
   email delivery in Neon Auth and verify both on the live app.

The application tables are created in the `scopeflow` schema; the migrations
do not change Neon's managed authentication schema. Use a database role with
permission to create/own the application schema and tables. The app queries
PostgreSQL on the server and enforces account ownership in its API; no direct
browser database credentials or Neon Data API permissions are needed.

## Create the Render service

Push this change to your GitHub repository, then create a Render Blueprint from
the repository using [render.yaml](../render.yaml). Alternatively, create a
**Node web service** with the following settings:

| Setting | Value |
| --- | --- |
| Build command | `npm ci --include=dev --include=optional && npm run build` |
| Start command | `npm run db:migrate && npm start` |
| Health check | `/api/health` |
| Node version | Pinned in `.node-version` to 24.19.0 |

Render supplies `PORT`; Next listens on `0.0.0.0` and uses that port. The
Blueprint selects Render's free web-service plan as a starting point. Free
services can sleep when idle; cold starts are expected. Pick a paid service if
you need continuously running hosting. Neon's free plan is also subject to its
current storage, compute, and authentication limits. Check each provider's
dashboard/pricing before choosing production capacity.

Set these values securely in the Render service:

| Variable | Where it comes from |
| --- | --- |
| `DATABASE_URL` | Neon's pooled PostgreSQL connection string; secret |
| `NEON_AUTH_BASE_URL` | Neon's Auth URL for the same branch |
| `NEON_AUTH_COOKIE_SECRET` | A private random value of at least 32 characters; the Blueprint generates it |
| `APP_URL` | Your canonical public origin, exactly as the browser shows it: `https://scopeflow-qnng.onrender.com` for the current service. No path. Used for workspace links and as the OAuth issuer. If unset, the app uses the proxy's `X-Forwarded-Proto` + `Host` of each request; a mismatch is logged once. |
| `SCOPEFLOW_SIGNING_SECRET` | Random value of at least 32 characters (`openssl rand -base64 48`); the Blueprint generates it. Seeds the Ed25519 key that signs client decisions and ledger entries. Keep it stable; when rotating, put the old value in `SCOPEFLOW_SIGNING_SECRET_PREVIOUS` (comma-separated) so old records still verify. If unset, a key is derived from `NEON_AUTH_COOKIE_SECRET`. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Optional, build-time. A role address (for example `support@your-domain`) shown on Support, Privacy, Terms and Data controls. When unset, pages link to the Support page instead of a personal inbox. |
| `PG_POOL_MAX` | Optional. PostgreSQL client pool size (default 15, 2-100). Use Neon's pooled connection string. |
| `OAUTH_CIMD_HOSTS` | Optional. Comma-separated hosts whose OAuth Client ID Metadata Documents are trusted (default `chatgpt.com`). Set to an empty string to rely on dynamic client registration only. |
| `NODE_ENV` | `production`; set by the Blueprint |
| `RESEND_API_KEY` | Optional. A [Resend](https://resend.com) API key (secret). Together with `SCOPEFLOW_MAIL_FROM` it lets **Send for signature** email the review link to the client email saved on a project. Without both, nothing is emailed and the workspace offers **Copy link** and **Open in mail app** (`mailto:`) instead. |
| `SCOPEFLOW_MAIL_FROM` | Optional. The sender, on a domain verified in Resend, for example `Scopeflow <scopes@your-domain>`. Required with `RESEND_API_KEY`. |
| `SCOPEFLOW_MAIL_REPLY_TO` | Optional. Reply-To address for those emails (for example your own inbox), so client replies reach you. |

### Why APP_URL matters (the "Origin not allowed" outage)

`next start --hostname 0.0.0.0` makes `request.url` inside route handlers look like
`http://0.0.0.0:<PORT>`. Earlier builds compared the browser's `Origin` header with
`APP_URL || request.url`, so a missing or mistyped `APP_URL` rejected every sign-up,
password reset and token request with "Origin not allowed." The guard now accepts the
canonical origin (`APP_URL`) and the request's own forwarded origin
(`X-Forwarded-Proto` + `X-Forwarded-Host`/`Host`), which a cross-site page cannot forge
together with its `Origin`. Still set `APP_URL` exactly: links in MCP responses and
OAuth metadata are built from it.

If configuring the service manually, generate the cookie secret privately with
`openssl rand -base64 32`. Keep it stable across restarts/deployments. Changing
it invalidates signed session-cache cookies. Never commit real values or paste
database passwords or session secrets into chat. No Neon management API key is
required.

Migrations run at startup so the free Render plan does not need a pre-deploy
command. They take a PostgreSQL advisory lock, record checksums, and commit
atomically; repeated starts safely skip already-applied migrations. A failed
migration stops startup. Existing application writes are transactional and
serialized only where they must be: per project (revisions, client decisions,
ledger entries) and per owner (project creation cap, account deletion), using
transaction-scoped advisory locks keyed by that id. Reads that need a coherent
view run as REPEATABLE READ READ ONLY snapshots without locks. Migration
`0001_integrity_oauth.sql` adds triggers that make decided versions and ledger
entries immutable (only account deletion may remove them, through an explicit
transaction-local bypass). For defence in depth, run the app with a
least-privilege role that does not own the tables (SELECT, INSERT, UPDATE,
DELETE only) and run migrations with the owner role.

The current checked-in migration chain lives in `db/migrations`. Legacy SQLite
migrations in `drizzle` are retained only for historical regression tests.
`npm run db:generate` writes PostgreSQL schema suggestions to `db/generated`;
review and transfer a new SQL migration into `db/migrations` before deploying.
Do not edit an already-applied migration.

## Projects: archive, delete and client email

* **Archive** (owner, confirmed in a dialog) hides a project from the list and
  blocks new versions and ledger entries until it is restored. Nothing a client
  signed changes: versions, decisions, signatures, ledger entries and review
  links stay as they were, so receipts keep verifying. `PATCH /api/scopes/{id}`
  with `{"archived": true|false}`.
* **Delete project** (signed-in website owner only, type `DELETE` to confirm) is
  allowed only while the project carries no client evidence: every version is
  still awaiting review and there are no ledger entries. Projects a client has
  approved or answered can only be archived (full account deletion still removes
  everything). Migration `0002` enforces the same rule in the SF-04 triggers: the
  per-project bypass can remove only pending versions and never ledger entries;
  only account deletion (which also sets `scopeflow.account_delete`) can remove
  decided versions and ledger entries. `DELETE /api/scopes/{id}` with
  `{"confirmation":"DELETE"}`; it answers 409 `has_client_evidence` otherwise.
* **Client email** is optional project metadata, private to the owner. It is not
  part of the signed scope content, so correcting it never creates a version.
  **Send for signature** (`POST /api/scopes/{id}/send` with `{"version": n}`,
  website session only, like review links) emails the latest pending version's
  link when `RESEND_API_KEY` and `SCOPEFLOW_MAIL_FROM` are set, and otherwise
  returns the link plus a `mailto:` URL for the copy-link / mail-app fallback.

## Verify the deployed app

1. `/api/health` must return HTTP 200 with `{"status":"ok"}`. It checks that the
   database schema is reachable and auth settings are present; it does not
   establish live Neon Auth connectivity.
2. Create a fictional account at `/auth/sign-up`, verify its email as configured,
   sign in at `/auth/sign-in`, and test the password-reset email flow.
3. Save a fictional scope, open its review link while signed out, approve it,
   then verify the immutable history and ledger in the owner's account.
4. Sign in with a second account and confirm it cannot read the first account's
   projects. Sign out and verify protected requests reject the old session.
5. Create/revoke an account API token from `/connect`. The REST API and `/mcp`
   accept `Authorization: Bearer <your Scopeflow token>`. Never give a connector
   your Neon database password or cookie secret.
6. Connect ChatGPT (or MCP Inspector) to `https://<your origin>/mcp`. It discovers
   `/.well-known/oauth-protected-resource`, registers itself (DCR, or CIMD for
   `chatgpt.com`), sends you to `/oauth/authorize` to sign in and allow access,
   and exchanges the code with PKCE. Disconnect apps from `/connect`.

The automated local runner refuses remote databases and hosts. Do not point it
at Neon production: it deletes fictional account data and resets request
counters. Test the live deployment manually using disposable fixtures.

## Local development and automated tests

For your own Neon development branch, copy `.env.example` to `.env.local`, fill
in its values securely, allow `http://localhost:5173` in Neon Auth, and run:

```sh
npm ci --include=dev --include=optional
npm run db:migrate
npm run dev
```

The full automated workflow uses a **dedicated local PostgreSQL database** and
a localhost Better Auth service that exercises the real Neon SDK protocol. No
authentication bypass is compiled into the app. Use Docker to start PostgreSQL:

```sh
docker run -d --name scopeflow-render-pg \
  -p 127.0.0.1:55432:5432 \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=scopeflow_test postgres:17
```

For this disposable setup only, put these values in an ignored `.env.local`:

```dotenv
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/scopeflow_test
NEON_AUTH_BASE_URL=http://localhost:55433
NEON_AUTH_COOKIE_SECRET=<generate a local random value of at least 32 characters>
APP_URL=http://localhost:5173
```

In separate terminals, run `node tests/support/auth-service.mjs` and
`npm run dev`. Then run `npm run db:migrate`, `npm run typecheck`, and
`npm run test:local`. The fixture service uses in-memory accounts and never
sends email; live Neon verification/recovery delivery must be tested separately.
Build with `npm run build`, and test the production server with
`PORT=5173 npm start` after stopping the dev server.

## Existing data and integrations

This deployment creates the PostgreSQL schema but does not export or move data
from a deployed Cloudflare D1 database. Existing platform account identifiers
also differ from Neon user IDs. If you have existing customers/data, plan a
separate export/import with explicit account mapping and test it before switching
the public domain. This migration does not delete or modify a remote D1 site.

Billing is still disabled. Optional social-login providers (with their callback integration), branded domains,
email branding, backups, monitoring, and paid capacity can be configured after
the basic deployment works. Historical submission/scale documents describe the
earlier Sites deployment and are not Render setup instructions.
