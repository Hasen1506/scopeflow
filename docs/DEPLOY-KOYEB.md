# Move ScopeFlow from Render to Koyeb

Checked 19 October 2026 against Koyeb's own pages. The web app moves to one free
instance. The four cron groups move to GitHub Actions. Neon stays the database.
`render.yaml` stays in the repo and stays valid until the last step of the cutover.

## Limits and caveats

Sources: [Instances](https://www.koyeb.com/docs/reference/instances) (updated 27 May 2026),
[Scale to zero](https://www.koyeb.com/docs/run-and-scale/scale-to-zero) (updated 27 May 2026),
[Pricing FAQ](https://www.koyeb.com/docs/faqs/pricing), [Pricing](https://www.koyeb.com/pricing),
[Edge network](https://www.koyeb.com/docs/reference/edge-network) (updated 27 May 2026),
[Build from Git](https://www.koyeb.com/docs/build-and-deploy/build-from-git),
[Environment variables](https://www.koyeb.com/docs/build-and-deploy/environment-variables),
[Terms](https://www.koyeb.com/docs/legal/terms).

| Limit | What Koyeb documents | What ScopeFlow does |
| --- | --- | --- |
| RAM | 512 MB | Two Node processes (`scripts/start.mjs` and `next start`). The image sets `NODE_OPTIONS=--max-old-space-size=320`. `PG_POOL_MAX=4` on the service. |
| CPU | 0.1 vCPU | The first request after sleep can spend most of its time in Node, after the VM exists. |
| Disk | 2 GB SSD. Volumes are not allowed on the free instance. | The image is the only disk use. No volume is attached. |
| Count | One free instance per organization. | One web service, named `scopeflow`. |
| Regions | Frankfurt (`fra`) or Washington, D.C. (`was`) only. Singapore exists for Eco instances, which are paid. | `fra`. Of the two free regions, Frankfurt is the closer one to India. |
| Sleep | Scales to zero after 1 hour with no internet traffic. The idle period cannot be changed, and sleep cannot be turned off. | The service sleeps. See the cold start below. |
| Cold start | Deep sleep creates a new microVM in 1–5 seconds. Light sleep (~200 ms) is for Starter, Pro, Scale, and Enterprise, not the free instance. HTTP/2 cannot wake a sleeping service. A WebSocket can wake it and may live only a few minutes. | This app's cold start was not measured here. The 1–5 seconds is the documented VM create time. Next.js on 0.1 vCPU can take longer before `/api/health` returns. The health check grace is 180 seconds. Cron callbacks use Node's HTTP/1.1 client so they can wake the instance. |
| Build memory | Not published. The Docker build runs on Koyeb's builder, separate from the 512 MB instance. | `Dockerfile` runs `npm run build:capped` (460 MB old-space heap, one build CPU). |
| Custom domain and TLS | The edge terminates TLS. The pricing page says a custom domain is supported with automatic SSL, "ten custom domain for free" and then $0.20/month. The pricing FAQ says the Pro plan includes 100 custom domains and that extra domains are not charged yet ($0.20/month later). The feature table on the pricing page also says "Unlimited" and "500 included" on higher plans. | One domain, `scope-flow.tech`. Attach it in Koyeb so the certificate exists, and keep Cloudflare as the proxy. The two Koyeb pages do not agree on the free count; one domain is inside every figure they publish. |
| Commercial use | The terms describe a professional customer (the French Consumer Code consumer rules do not apply). The instances page says free instances "should not be used for production applications" and are for preview and hobby projects. The free web service itself is not billed ([pricing FAQ](https://www.koyeb.com/docs/faqs/pricing)). | The owner chose this instance anyway. Treat the "not for production" line as a real limit: sleep, 0.1 vCPU, one instance, no SLA on the free tier. |
| Keep-alive | The terms do not name keep-alive pings. Sleep is a documented property of the free instance and cannot be disabled. | This repo does not ping the service to keep it awake. |
| Postgres | One free Koyeb Postgres database, 5 active hours, 1 GB. | Leave it unused. ScopeFlow stays on Neon. |

Koyeb has no documented `koyeb.yaml` service spec (`/docs/build-and-deploy/koyeb-yaml` returns 404). `$HOME/.koyeb.yaml` is the CLI credentials file. The service is a Dockerfile plus `scripts/koyeb-create.sh`, which uses the CLI flags Koyeb documents (`--instance-type free`, `--regions fra`, `--git-builder docker`, `--checks 8000:http:/api/health`).

## What stays on Render until cutover

`render.yaml` still defines the Starter web service and the four Starter cron services. Do not delete those services, and do not switch the web plan to `free`, until the checklist below says so.

## Trusted proxy (Cloudflare, then Koyeb)

Koyeb appends the address that connected to Koyeb onto `X-Forwarded-For`. The last entry is the only one Koyeb certifies ([edge network](https://www.koyeb.com/docs/reference/edge-network)). `scripts/start.mjs` forwards that header unchanged.

With Cloudflare proxied (orange cloud) in front:

1. Cloudflare sets `cf-connecting-ip` and `cf-ray`, and appends to `X-Forwarded-For`.
2. Koyeb appends the Cloudflare edge address at the end.

`SCOPEFLOW_TRUSTED_HOPS=1` and `SCOPEFLOW_TRUSTED_PROXY=cloudflare` then treat that last address as the peer. It is a Cloudflare range, so `lib/origin.ts` uses `cf-connecting-ip`. That is the same pair Render uses today. A direct request to the `koyeb.app` host has no `cf-ray`; the last `X-Forwarded-For` entry is the client, and the Cloudflare headers are ignored.

Set both values on the Koyeb service. After DNS moves, open one client decision and confirm `/api/readiness` shows `trusted_proxy: cloudflare` and `trusted_hops: 1`, and that the stored client address is the visitor.

`APP_URL` stays `https://scope-flow.tech` with no path. Health, readiness, and payment webhooks answer on any host. Other pages on the `koyeb.app` host redirect to that origin.

## Files

| File | Role |
| --- | --- |
| `Dockerfile` | Node 24.19.0 (`.node-version`). Build with `build:capped`, prune dev dependencies, `npm start`. Listens on `PORT` (8000). |
| `scripts/koyeb-create.sh` | One-time `koyeb services create`. |
| `.github/workflows/deploy-koyeb.yml` | `workflow_dispatch` only. `npm run db:migrate:deploy` with `DATABASE_MIGRATION_URL`, then `koyeb services update` for that commit. |
| `.github/workflows/cron-retention.yml` | `30 20 * * *` — `node scripts/cron.mjs retention heads housekeeping`, then the notification drain. |
| `.github/workflows/cron-reminders.yml` | `30 3 * * *` — `node scripts/cron.mjs reminders`. |
| `.github/workflows/cron-reconcile.yml` | `0 */6 * * *` — `node scripts/cron.mjs reconcile`. |
| `.github/workflows/cron-check-models.yml` | `0 22 * * *` — `node scripts/cron.mjs check-models analytics`. |

`node scripts/cron.mjs --dry-run <jobs>` prints the jobs and does not open a database. The schedules do not pass `--dry-run`. `node scripts/send-reminders.mjs --dry-run` lists reminder mail and sends nothing; that flag is for a manual check.

## GitHub Actions clocks

The cron expressions match `render.yaml` and are UTC. Three limits come from GitHub, not from this repo:

1. A `schedule` event runs only for the workflow file on the repository's default branch. Until these files are on `main`, run them with **Actions → the workflow → Run workflow**.
2. GitHub may start a scheduled run later than the clock time when Actions is busy.
3. GitHub disables scheduled workflows after 60 days without activity on the repository. A push, or someone using the repository, keeps them enabled. `workflow_dispatch` is the catch-up when a day was missed. This repo does not add a dummy workflow to defeat that rule.

Each workflow uses a concurrency group with `cancel-in-progress: false`, so a late run is not cancelled by the next clock. A second run waits. GitHub drops an older run that is still only queued when a newer one for the same group arrives. The jobs are idempotent; run the workflow by hand if a day was skipped.

Public repositories do not spend Actions minutes on the standard GitHub-hosted runners.

The workflows do nothing until the `DATABASE_URL` repository secret exists (they pass with a notice). Adding that secret turns them on. Pause the Render cron services first so the two runners do not both fire.

`.github/workflows/cron.yml` no longer has a timer. Its **Run workflow** button still POSTs the notification drain, reconcile, heads, analytics, and housekeeping over HTTP. Leave it unused once the four script workflows are the runner.

On failure, if `SCOPEFLOW_ERROR_WEBHOOK` is set, the workflow POSTs `{source, id, message, at}` and nothing else. The same shape as `lib/errors.ts`. An empty secret sends nothing.

## Environment variables to copy onto Koyeb

Copy values from the Render web service. Put secrets in Koyeb Secrets and reference them as `{{ secret.NAME }}`. The create script sets only the non-secret values below. Add every other key in the Koyeb service settings before the first real deploy. `NEXT_PUBLIC_SUPPORT_EMAIL` is read at Docker build time (`ARG` in the Dockerfile); set it before the build.

Copy these. Regenerating a generated secret signs everyone out, breaks receipt verification, or breaks the cron token.

| Variable | On Koyeb |
| --- | --- |
| `NODE_ENV` | `production` (the create script sets it) |
| `DATABASE_URL` | Copy. App role (`scopeflow_app`). The web process and the Actions crons. |
| `DATABASE_MIGRATION_URL` | Copy. Owner role. Used by the deploy workflow, not by the web process. |
| `NEON_AUTH_BASE_URL` | Copy. |
| `NEON_AUTH_COOKIE_SECRET` | Copy the current value. A new value drops sessions. |
| `APP_URL` | `https://scope-flow.tech` (the create script sets it). No path, no trailing slash. |
| `SCOPEFLOW_TRUSTED_PROXY` | `cloudflare` (the create script sets it). |
| `SCOPEFLOW_TRUSTED_HOPS` | `1` (the create script sets it). |
| `SCOPEFLOW_ADMIN_TOKEN` | Copy. |
| `SCOPEFLOW_ENCRYPTION_KEY` | Copy. A new key cannot open secrets already stored. |
| `SCOPEFLOW_ANALYTICS` | `on` (the create script sets it). |
| `POSTHOG_KEY` | Copy if set. |
| `POSTHOG_HOST` | `https://eu.i.posthog.com` (the create script sets it). |
| `SCOPEFLOW_SIGNING_SECRET` | Copy. Receipts and the ledger verify with it. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Copy if set. Build time. |
| `RESEND_API_KEY` | Copy if set. |
| `SCOPEFLOW_MAIL_FROM` | Copy if set. |
| `SCOPEFLOW_MAIL_REPLY_TO` | Copy if set. |
| `SCOPEFLOW_CRON_SECRET` | Copy. |
| `SCOPEFLOW_MAIL_PROVIDER` | Copy if set. |
| `POSTMARK_SERVER_TOKEN` | Copy if set. |
| `SCOPEFLOW_SES_ACCESS_KEY_ID` | Copy if set. |
| `SCOPEFLOW_SES_SECRET_ACCESS_KEY` | Copy if set. |
| `SCOPEFLOW_SES_REGION` | Copy if set. |
| `MSG91_AUTH_KEY` | Copy if set. |
| `MSG91_OTP_TEMPLATE_ID` | Copy if set. |
| `TWILIO_ACCOUNT_SID` | Copy if set. |
| `TWILIO_AUTH_TOKEN` | Copy if set. |
| `TWILIO_SMS_FROM` | Copy if set. |
| `TWILIO_WHATSAPP_FROM` | Copy if set. |
| `TWILIO_WHATSAPP_CONTENT_SID` | Copy if set. |
| `OPENAI_API_KEY` | Copy if set. |
| `ANTHROPIC_API_KEY` | Copy if set. |
| `SCOPEFLOW_EMBEDDINGS` | Copy if set. |
| `VOYAGE_API_KEY` | Copy if set. |
| `SCOPEFLOW_INBOUND_DOMAIN` | Copy if set. |
| `SCOPEFLOW_INBOUND_SECRET` | Copy. |
| `RAZORPAY_KEY_ID` | Copy if set. |
| `RAZORPAY_KEY_SECRET` | Copy if set. |
| `RAZORPAY_WEBHOOK_SECRET` | Copy if set. |
| `STRIPE_SECRET_KEY` | Copy if set. |
| `STRIPE_WEBHOOK_SECRET` | Copy if set. |
| `STRIPE_CURRENCIES` | Copy if set. |
| `SCOPEFLOW_TSA_URL` | `https://freetsa.org/tsr` unless Render has a different value (the create script sets the default). |
| `SCOPEFLOW_PDF_SIGN_CERT` | Copy if set. PEM text is allowed. |
| `SCOPEFLOW_PDF_SIGN_KEY` | Copy if set. |

Also copy any of these that the Render service actually has. They are optional in `.env.example` or read by the server, and they are not all declared in `render.yaml`.

`SCOPEFLOW_SIGNING_SECRET_PREVIOUS`, `SCOPEFLOW_ALLOW_COOKIE_SIGNING`, `SCOPEFLOW_LEGACY_KEY_IDS`, `POSTMARK_MESSAGE_STREAM`, `SCOPEFLOW_SES_SESSION_TOKEN`, `SCOPEFLOW_MAIL_API_URL`, `SCOPEFLOW_MAIL_ROUTES`, `SCOPEFLOW_MAIL_WEBHOOK_SECRET`, `SCOPEFLOW_MAIL_UNSUBSCRIBE_SECRET`, `RESEND_WEBHOOK_SECRET`, `SCOPEFLOW_SES_SNS_TOPIC_ARN`, `MSG91_OTP_VAR`, `SCOPEFLOW_SMS_PROVIDER`, `SCOPEFLOW_LLM_PROVIDER`, `SCOPEFLOW_OPENAI_MODEL`, `SCOPEFLOW_OPENAI_MODEL_CAREFUL`, `SCOPEFLOW_ANTHROPIC_MODEL`, `SCOPEFLOW_ANTHROPIC_MODEL_CAREFUL`, `SCOPEFLOW_OPENAI_URL`, `SCOPEFLOW_ANTHROPIC_URL`, `SCOPEFLOW_EMBEDDING_MODEL`, `SCOPEFLOW_EMBEDDING_MIN`, `SCOPEFLOW_EMBEDDINGS_URL`, `SCOPEFLOW_TSA_AUTH`, `SCOPEFLOW_PDF_SIGN_KEY_PASSPHRASE`, `SCOPEFLOW_PDF_EXTRA_FONTS`, `SCOPEFLOW_FX_URL`, `SCOPEFLOW_CONTEXT_RETENTION_DAYS`, `SCOPEFLOW_TOMBSTONE_RETENTION_YEARS`, `SCOPEFLOW_PLAN`, every `SCOPEFLOW_LIMIT_<NAME>` that is set, `SCOPEFLOW_ERROR_WEBHOOK`, `SCOPEFLOW_ANALYTICS_SALT`, `SCOPEFLOW_CLOUDFLARE_IPS`, `PG_POOL_MAX` (the create script sets `4` for the 512 MB instance; keep Render's value if it is already lower), `OAUTH_CIMD_HOSTS`, `OAUTH_VERIFIED_DOMAINS`, `SCOPEFLOW_ROUTE_ENABLED`, `SCOPEFLOW_RBI_BANK_RATE_PCT`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_OTP_TEMPLATE`, `WHATSAPP_OTP_LANG`, `WHATSAPP_BOT_NUMBER`, `RAZORPAY_BILLING_KEY_ID`, `RAZORPAY_BILLING_KEY_SECRET`, `RAZORPAY_BILLING_WEBHOOK_SECRET`, `RAZORPAY_BILLING_PLAN_PRO_MONTH`, `RAZORPAY_BILLING_PLAN_PRO_YEAR`, `RAZORPAY_BILLING_PLAN_AGENCY_MONTH`, `RAZORPAY_BILLING_PLAN_AGENCY_YEAR`, `STRIPE_BILLING_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET`, `STRIPE_BILLING_PRICE_PRO_MONTH`, `STRIPE_BILLING_PRICE_PRO_YEAR`, `STRIPE_BILLING_PRICE_AGENCY_MONTH`, `STRIPE_BILLING_PRICE_AGENCY_YEAR`, `SCOPEFLOW_BILLING_SELLER_NAME`, `SCOPEFLOW_BILLING_SELLER_ADDRESS`, `SCOPEFLOW_BILLING_SELLER_GSTIN`, `SCOPEFLOW_BILLING_SAC`, `SCOPEFLOW_BILLING_LUT_ARN`.

If Render has a `RAZORPAY_BILLING_PLAN_*_FOUNDING` or `STRIPE_BILLING_PRICE_*_FOUNDING` value from the plans work, copy that too.

Leave `SCOPEFLOW_OTP_DEV` and `SCOPEFLOW_OTP_DEV_LOG` unset.

The create script also sets `PORT=8000`. Koyeb would otherwise set `PORT` to the lowest exposed port, which is the same number. `scripts/start.mjs` binds `0.0.0.0` and uses the next port for Next.js.

## GitHub repository secrets

Settings → Secrets and variables → Actions → Secrets.

| Secret | Used by |
| --- | --- |
| `DATABASE_URL` | All four cron workflows. The app role, the same value as on Koyeb. |
| `DATABASE_MIGRATION_URL` | Deploy workflow only. The owner role. |
| `KOYEB_TOKEN` | Deploy workflow. A Koyeb API token that can update the service. |
| `SCOPEFLOW_CRON_SECRET` | All four cron workflows. Same value as the web service. |
| `SCOPEFLOW_ADMIN_TOKEN` | All four cron workflows. Same value as the web service. |
| `SCOPEFLOW_CONTEXT_RETENTION_DAYS` | Retention workflow, if you set a server default. |
| `RESEND_API_KEY`, `SCOPEFLOW_MAIL_FROM`, `SCOPEFLOW_MAIL_REPLY_TO`, `SCOPEFLOW_MAIL_PROVIDER`, `POSTMARK_SERVER_TOKEN`, `SCOPEFLOW_SES_ACCESS_KEY_ID`, `SCOPEFLOW_SES_SECRET_ACCESS_KEY`, `SCOPEFLOW_SES_REGION` | Reminders workflow. Same values as the web service. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `POSTHOG_KEY` | Check-models workflow. |
| `SCOPEFLOW_ERROR_WEBHOOK` | Failure notice. Optional. Same URL as the web service if you want one collector. |

Optional variables (not secrets): `KOYEB_APP` and `KOYEB_SERVICE`, both defaulting to `scopeflow`.

`APP_URL` in the cron workflows is the literal `https://scope-flow.tech`. It is not a secret.

## DNS (Cloudflare, `scope-flow.tech`)

1. In Koyeb, attach the custom domain `scope-flow.tech` to the app. Koyeb issues the certificate and shows the CNAME target (`<app>-<org>.koyeb.app`).
2. In Cloudflare, lower the TTL on the current record (300 seconds is enough) and wait for the old TTL to lapse.
3. Change that record to a CNAME at the Koyeb target. Leave the cloud orange so Cloudflare still proxies.
4. SSL/TLS mode **Full (strict)**. Turn **Always Use HTTPS** on. Koyeb's edge does not redirect HTTP to HTTPS by itself; Cloudflare does.
5. The browser still uses `https://scope-flow.tech`. Cloudflare's certificate is the one clients see. Koyeb's certificate is the one Cloudflare sees on the origin.

## Cutover (short downtime, shared database)

Neon is shared. Migrations are forward. A migration applied for the new deploy is still there if you point DNS back at Render, so deploy a commit Render can run.

1. Create the Koyeb service: `scripts/koyeb-create.sh` with the branch you intend to run. Confirm in the service settings that deploy-on-push is off. Add every environment variable from the tables above. Do not attach `scope-flow.tech` yet.
2. If that commit has migrations Render has not applied, run the deploy workflow once so `db:migrate:deploy` runs before you rely on the new process. The create command itself builds once; for a commit whose migrations are already on Neon, that first build is safe.
3. `curl -fsS https://<app>-<org>.koyeb.app/api/health` returns 200. Pages on that host redirect to `https://scope-flow.tech`, which still reaches Render. That redirect is the canonical-host check.
4. Attach the domain in Koyeb, then change the Cloudflare CNAME as above.
5. `curl -fsS https://scope-flow.tech/api/health` returns 200. Sign in. Open `/api/readiness` with the operator token and confirm the proxy check. Open one review page.
6. Pause the four Render cron services (`scopeflow-retention`, `scopeflow-reminders`, `scopeflow-reconcile`, `scopeflow-check-models`).
7. Add the GitHub secrets. Run each of the four cron workflows once from the Actions tab. Confirm `/api/readiness` → `checks.cron.jobs`.
8. Leave the Render web service up.

While the instance is asleep, the first client waits for the VM and for Next.js to boot. Budget that wait. The health grace of 180 seconds is for deploys, not a promise to visitors.

## Rollback

1. Point the Cloudflare CNAME back at the Render host. Keep the cloud orange.
2. Resume the four Render cron services.
3. Remove the `DATABASE_URL` Actions secret, or disable the four cron workflows, so they stop. The deploy workflow does not run unless someone starts it.
4. Leave the Koyeb service in place until the next attempt. `render.yaml` still describes the Render services.
5. Do not try to un-apply migrations. The Render process keeps using the same Neon database.

## When to delete the Render services

Delete the four Render cron services and the Render web service after all of these are true:

- `https://scope-flow.tech` has been served by Koyeb for a full day, including at least one wake from sleep.
- Each of the four Actions workflows has completed once with a green run, and `/api/readiness` shows those jobs.
- You have the Cloudflare record and the Koyeb env vars written down outside Render.

Until then, `render.yaml` remains the rollback. Deleting the Render services before that throws away the working process.
