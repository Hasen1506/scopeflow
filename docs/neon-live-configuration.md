# Scopeflow live configuration

Configured 4 October 2026. Secrets are held only in Render Environment settings.

| Resource | Value |
| --- | --- |
| Neon project | `Scopeflow` (ID in the Neon dashboard) |
| Region | AWS Singapore |
| Production branch | production branch (ID in the Neon dashboard) |
| Development branch | development branch (ID in the Neon dashboard) |
| Database | `neondb` |
| Render service | `scopeflow` (ID in the Render dashboard) |
| Public origin | `https://scope-flow.tech` (an older Render hostname is not the canonical origin) |

Production uses the pooled PostgreSQL connection in server-only DATABASE_URL. Neon Better Auth is enabled on that branch, with email/password signup and Neon's shared email provider. The exact Render HTTPS origin is registered as a trusted origin. Render stores NEON_AUTH_BASE_URL, a stable random NEON_AUTH_COOKIE_SECRET, APP_URL (canonical `https://scope-flow.tech`), SCOPEFLOW_SIGNING_SECRET and NODE_ENV=production. Infrastructure IDs are kept in the provider dashboards, not in this repository. No database password or cookie secret belongs in source control.

Startup runs `npm run db:migrate && npm start`. The schema is the migrations under `db/migrations/` (not a six-table snapshot). Render and Neon are co-located in Singapore. The plan in `render.yaml` is Starter, not a free instance. Neon does not delete application rows after six hours. The only “six hours” in the product are a payment-reconcile backoff and a mail-retry delay. The development branch was created before application writes and is isolated from production.

Verified: live Render deployment, app homepage, GET /api/health returned 200 with status ok, GET /api/auth/get-session returned 200 with null for an anonymous request, Neon Auth email/password configuration and trusted origin. No sign-up, verification/recovery email, saved-scope or client-approval walkthrough was performed on the live app.

This is a new Render deployment. It does not migrate historical Cloudflare D1 data or remap prior platform identities. Existing external sites and domains were not changed. See render-deployment.md before any historical customer migration.
