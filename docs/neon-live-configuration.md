# Scopeflow live configuration

Configured 4 October 2026. Secrets are held only in Render Environment settings.

| Resource | Value |
| --- | --- |
| Neon project | `Scopeflow` (`purple-king-37058196`) |
| Region | AWS Singapore |
| Production branch | `br-round-heart-azlvz7aw` |
| Development branch | `br-twilight-field-azgogwvm` |
| Database | `neondb` |
| Render service | `scopeflow` (`srv-db0ra5psrm7s738rnkhg`) |
| Public origin | `https://scopeflow-qnng.onrender.com` |

Production uses the pooled PostgreSQL connection in server-only DATABASE_URL. Neon Better Auth is enabled on that branch, with email/password signup and Neon's shared email provider. The exact Render HTTPS origin is registered as a trusted origin. Render stores NEON_AUTH_BASE_URL, a stable random NEON_AUTH_COOKIE_SECRET, APP_URL and NODE_ENV=production. No database password or cookie secret belongs in source control.

Startup runs `npm run db:migrate && npm start`. All six application tables were initialized in the `scopeflow` schema, separate from the managed `neon_auth` schema. Render and Neon are co-located in Singapore and use free plans. The development branch was created before application writes and is isolated from production.

Verified: live Render deployment, app homepage, GET /api/health returned 200 with status ok, GET /api/auth/get-session returned 200 with null for an anonymous request, Neon Auth email/password configuration and trusted origin. No sign-up, verification/recovery email, saved-scope or client-approval walkthrough was performed on the live app.

This is a new Render deployment. It does not migrate historical Cloudflare D1 data or remap prior platform identities. Existing external sites and domains were not changed. See render-deployment.md before any historical customer migration.
