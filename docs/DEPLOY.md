# Deploying Scopeflow: what each feature needs

The base Render and Neon setup is in [render-deployment.md](render-deployment.md) and
[neon-live-configuration.md](neon-live-configuration.md); this page adds what the features need. Every variable
below is also listed, with comments, in [`.env.example`](../.env.example), and `render.yaml` declares them.

Put the variables on the Render web service (Environment). None of them may be committed. Everything except
the first table is optional: a feature without its variables is off, and the UI says so.

## Required

| Variable | What it does | Notes |
| --- | --- | --- |
| `SCOPEFLOW_SIGNING_SECRET` | Seeds the Ed25519 key that signs client decisions, ledger entries and PDF receipts; `/verify` checks receipts against it. | Generate once: `openssl rand -base64 48`. **Never change it casually**: records signed with an old key only keep verifying if the old value is kept in `SCOPEFLOW_SIGNING_SECRET_PREVIOUS` (comma-separated). **A production build no longer signs with `NEON_AUTH_COOKIE_SECRET`**: without this variable new records are unsigned (records signed earlier with the cookie-derived key still verify). `SCOPEFLOW_ALLOW_COOKIE_SIGNING=1` restores the old fallback while you migrate. `/api/health` reports `signing: dedicated | cookie_fallback | off`. |
| `SCOPEFLOW_CRON_SECRET` | Authorizes the cron jobs' calls to the web service (reconciliation, head digest, housekeeping, analytics export). | `render.yaml` generates it and shares it with the cron services. |
| `SCOPEFLOW_ADMIN_TOKEN` | Operator token for `/api/readiness`, `/api/analytics` and the cron callbacks. | `render.yaml` generates it. |
| `DATABASE_MIGRATION_URL` | Owner-role connection used only by the pre-deploy migration step. | Set in the dashboard (docs/ws-10.md). |

Keys in a KMS or HSM: the signing key is derived in process from the secret. Moving it into a cloud KMS or an
HSM needs that service's account and its signing API (AWS KMS, Google Cloud KMS or a PKCS#11 device); the
`signRecord`/`verifyRecord` functions in `lib/signing.ts` are the single place to change.

## Email: Send for signature, one-time codes, reminders

Set `SCOPEFLOW_MAIL_FROM` (a sender on a domain verified with the provider, e.g. `Scopeflow <scopes@your-domain>`)
and one provider:

| Provider | Variables |
| --- | --- |
| Resend | `RESEND_API_KEY` |
| Postmark | `POSTMARK_SERVER_TOKEN` (optional `POSTMARK_MESSAGE_STREAM`, default `outbound`) |
| Amazon SES (v2 API, signed with AWS Signature V4) | `SCOPEFLOW_SES_ACCESS_KEY_ID`, `SCOPEFLOW_SES_SECRET_ACCESS_KEY`, `SCOPEFLOW_SES_REGION` (optional `SCOPEFLOW_SES_SESSION_TOKEN`). The IAM user needs `ses:SendEmail`. |

`SCOPEFLOW_MAIL_PROVIDER` picks one when several are set. `SCOPEFLOW_MAIL_REPLY_TO` is the default reply-to.
Emails go out as "<business name> via Scopeflow" with the owner's reply-to address and logo when the owner
set branding. Without a provider, Send for signature falls back to copy link / mail app, and the email-code
check cannot be turned on.

Sending from each owner's own domain needs that domain verified with the provider (DKIM records per
domain); this server sends from one verified domain.

## SMS and WhatsApp one-time codes

MSG91 (`MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, optional `MSG91_OTP_VAR`) or Twilio (`TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, and for WhatsApp `TWILIO_WHATSAPP_FROM` with
`TWILIO_WHATSAPP_CONTENT_SID`). `SCOPEFLOW_SMS_PROVIDER` picks one. **India:** SMS to Indian numbers needs a
DLT-registered sender ID and template on the operator's DLT portal before MSG91 will deliver; that
registration is done by the business, not in code.

## AI drafting and the scope-creep radar

| Variable | What it does |
| --- | --- |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Turns AI on (defaults: `gpt-4o-mini` / `claude-haiku-5-5`; careful tier `gpt-4o` / `claude-sonnet-5-5`). |
| `SCOPEFLOW_LLM_PROVIDER` | `openai` or `anthropic` when both keys are set (OpenAI wins otherwise). |
| `SCOPEFLOW_OPENAI_MODEL`, `SCOPEFLOW_ANTHROPIC_MODEL` (and `_CAREFUL`) | Model overrides. |
| `SCOPEFLOW_EMBEDDINGS` | `openai` (uses `OPENAI_API_KEY`, `text-embedding-3-small`) or `voyage` (`VOYAGE_API_KEY`, `voyage-3.5`): the radar also matches requests to clauses by meaning, across languages. Optional `SCOPEFLOW_EMBEDDING_MODEL`, `SCOPEFLOW_EMBEDDING_MIN` (default 0.45). |

**Model lifecycle.** The daily job runs `node scripts/check-models.mjs`: it asks each provider's Models API
whether the configured models are still served and warns 45 days before a known retirement date
(`MODEL_RETIREMENTS` in `lib/llm.ts`). `--strict` exits 1 on a missing or retired model, for a deploy gate.

## Email forwarding into the radar

Set `SCOPEFLOW_INBOUND_DOMAIN` (e.g. `in.your-domain`) and `SCOPEFLOW_INBOUND_SECRET` (at least 16
characters). Point the domain's MX at your mail provider's inbound service and its webhook at
`<APP_URL>/api/inbound/email`, authenticated with the secret as a bearer token or as the basic-auth password
(Postmark: `https://postmark:<secret>@your-app/api/inbound/email`). Owners then create a private
`scope-<token>@<domain>` address per project (Project settings) and forward client emails to it; each one is
checked by the radar (keywords and, when configured, meaning; the AI check runs only when the owner asks).

## Online payments

**Razorpay** (INR first): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Webhook
(Dashboard > Webhooks): URL `<APP_URL>/api/payments/razorpay/webhook`, events `payment.captured` and
`order.paid`, the same secret.

**Stripe Checkout** (other currencies): `STRIPE_SECRET_KEY` (a secret or restricted key with Checkout
Sessions write and Refunds write), `STRIPE_WEBHOOK_SECRET`. Webhook (Developers > Webhooks): URL
`<APP_URL>/api/payments/stripe/webhook`, events `checkout.session.completed` and
`checkout.session.async_payment_succeeded`. `STRIPE_CURRENCIES` (e.g. `USD,EUR,GBP`) limits Stripe to those.

Routing: INR goes to Razorpay when it is set up, other currencies to Stripe when it is set up, otherwise
whichever is configured. Clients pay the deposit and what is still open on each issued invoice (a partial
payment of the balance) from the review link. Only the verified webhook, or the daily reconciliation that
asks the provider about unpaid orders from the last 30 days, marks a payment paid and appends the signed
`payment` entry. Owners refund online payments (full or partial) through the same provider from the
workspace, or record refunds made outside Scopeflow; both appear on the client's record and statement.

Money goes to the merchant account that owns these keys. **Paying each freelancer directly** (Razorpay Route
or Stripe Connect) needs a linked account per freelancer with that freelancer's own KYC, which is a contract
between the freelancer and the provider; Scopeflow does not do this.

## Evidence: timestamps, signed PDFs, fonts

| Variable | What it does |
| --- | --- |
| `SCOPEFLOW_TSA_URL` (optional `SCOPEFLOW_TSA_AUTH`) | RFC 3161 timestamps on decisions and PDFs (PAdES B-T). Use a qualified TSA for legal weight. |
| `SCOPEFLOW_PDF_SIGN_CERT`, `SCOPEFLOW_PDF_SIGN_KEY` (optional `SCOPEFLOW_PDF_SIGN_KEY_PASSPHRASE`) | PAdES-signs every PDF so it verifies in Acrobat. A DSC (Class 3 document signer) from an Indian CA, or any document-signing certificate. |
| `SCOPEFLOW_PDF_EXTRA_FONTS` | Extra TrueType fonts for scripts the bundled Noto fonts do not cover. |

**Aadhaar eSign** as a third assurance tier needs an agreement with an eSign Service Provider (for example
Digio or Leegality) and their API keys; it is not built in.

## Money, retention and limits

| Variable | What it does |
| --- | --- |
| `SCOPEFLOW_FX_URL` | Reference exchange rates for the locked FX line (default: ECB rates via api.frankfurter.dev; `off` disables lookups; owners can still type a rate). |
| `SCOPEFLOW_CONTEXT_RETENTION_DAYS` | Server-wide default (1–3650 days) for owners who set no retention. After that many days the IP address and user agent on client decisions and client ledger entries become `redacted`. Owners can set their own period, a per-project period, and legal holds. |
| `SCOPEFLOW_PLAN`, `SCOPEFLOW_LIMIT_<NAME>` | Plan tier (`beta`, `free`, `solo`) and per-limit overrides (`lib/plans.ts`). |

## Plan and cost (founder decision, H15)

Render's free web plan spins down after 15 idle minutes (a cold start of tens of seconds for the next client
who opens a review link) and has no cron jobs. `render.yaml` therefore puts the web service and the four
cron services on **Starter**: about US$7/month for the web service plus a small per-minute charge for each
cron run (the four daily jobs run for seconds; budget a few US$ a month in total). Check Render's current
price list before switching; the alternative is to keep the free plan and run `node scripts/cron.mjs <job>`
by hand, accepting cold starts and stale reconciliation.

## Deploys and migrations

`preDeployCommand: npm run db:migrate:deploy` runs the migrations once per deploy, before traffic moves, as
the owner role in `DATABASE_MIGRATION_URL` (falls back to `DATABASE_URL` with a warning). The web process
only runs `npm start`. The role split (runtime role `scopeflow_app`, C7) and its operator steps are in
[ws-10.md](ws-10.md).

## The cron jobs

`render.yaml` defines four cron services (Starter). Each runs `node scripts/cron.mjs <job...>`: every job in
its own process, recorded in `scopeflow.cron_runs`, so one failing job never skips another and
`/api/readiness` shows the last run, staleness and failures per job.

| Service | Schedule (UTC) | Jobs |
| --- | --- | --- |
| `scopeflow-retention` | `30 20 * * *` (02:00 IST) | `retention` (`scripts/redact-expired.mjs`: redaction, draft expiry, stale unsaved drafts), `heads` (publish yesterday's signed ledger-head digest), `housekeeping` (expired idempotency keys, OAuth codes and tokens, old cron runs) |
| `scopeflow-reminders` | `30 3 * * *` (09:00 IST) | `reminders` (`scripts/send-reminders.mjs`; needs the email variables, `--dry-run` lists what it would send) |
| `scopeflow-reconcile` | `0 */6 * * *` | `reconcile` (`scripts/reconcile-payments.mjs`; no mail dependency) |
| `scopeflow-check-models` | `0 22 * * *` | `check-models`, then `analytics` (PostHog export when `POSTHOG_KEY` is set; purges events older than 400 days) |

Every job is idempotent. Manual setup: build `npm ci --omit=dev --ignore-scripts`, start command as above.

## Health and readiness

`/api/health` (Render's health check) is 200 only when the database answers and, in production, records are
signed with the dedicated key. Everything optional is reported by
`GET /api/readiness` with `Authorization: Bearer $SCOPEFLOW_ADMIN_TOKEN`: `summary` maps each check
(signing, database, db_role, mail, inbound, otp, otp_spend, payments, cron, tsa, heads, models, encryption,
analytics, proxy, canonical) to `ok`, `warn`, `off` or `fail`.

## Keep the OTP dev flags unset in production

`SCOPEFLOW_OTP_DEV` and `SCOPEFLOW_OTP_DEV_LOG` exist only for local development and CI: codes are written to
the log (and a file) instead of being sent, so anyone who can read the logs could confirm a client's email
and sign as that client. The code refuses dev mode unless `APP_URL` is localhost, but leave both unset on
Render and out of shared environment groups.

## After deploying

1. `npm run db:migrate` runs pending migrations: 0004–0010 (client OTP, time zone, templates, payments,
   retention settings, reminder tracking, business profile, invoices, review-link opens), 0011 (phone codes,
   link expiry, countersignatures, timestamps), 0012 (GST invoices, invoice reminders, reconciliation) and
   0013 (per-project retention and legal hold, draft expiry, branding, inbound email, template revisions and
   sharing, payment purposes) and 0014 (unsaved scope drafts kept with the account). They add tables and columns; 0008 replaced the immutability trigger functions
   so retention may redact IP and user agent (and nothing else).
2. Check `/api/health` (`signing` should be `dedicated`), then sign and download one PDF receipt and open its
   QR code at `/verify`.
3. With email: turn on the email code check on a test project and sign through it.
4. With AI: run one Draft with AI and one radar check; run `node scripts/check-models.mjs`.
5. With Razorpay or Stripe: pay one test-mode deposit and one invoice, refund part of one, and check the
   ledger entries.
6. With forwarding: create a forwarding address on a test project and forward one email to it.
7. Run each cron service once by hand and check `/api/readiness` → `checks.cron.jobs`.
8. WS-10: migration 0016 (runtime role, deletion audit, head digests, cron runs, idempotency keys, OAuth
   grants, analytics). Follow the operator steps in [ws-10.md](ws-10.md); check that the onrender host
   answers 308 and `/api/readiness` shows no `fail`.
