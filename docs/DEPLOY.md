# Deploying Scopeflow: what the roadmap features need

Notes for the founder after the roadmap PRs (#6 PDF receipt and /verify, #7 client OTP, #8 money and
terms, #10 templates and AI drafting, #11 scope-creep radar, #12 Razorpay deposit, #13 retention and
editable wording) were merged. The base Render and Neon setup is in [render-deployment.md](render-deployment.md)
and [neon-live-configuration.md](neon-live-configuration.md); this page only adds what those features need.
Every variable below is also listed, with comments, in [`.env.example`](../.env.example).

Put the variables on the Render web service (Environment). None of them may be committed.

## Required

| Variable | What it does | Notes |
| --- | --- | --- |
| `SCOPEFLOW_SIGNING_SECRET` | Seeds the Ed25519 key that signs client decisions, ledger entries and PDF receipts; `/verify` checks receipts against it. | Generate once: `openssl rand -base64 48`. **Never change it casually**: records signed with an old key only keep verifying if the old value is kept in `SCOPEFLOW_SIGNING_SECRET_PREVIOUS` (comma-separated). If unset, a key is derived from `NEON_AUTH_COOKIE_SECRET`, which ties receipt verification to the cookie secret; set it explicitly. |
| `RESEND_API_KEY` and `SCOPEFLOW_MAIL_FROM` | Email through Resend: "Send for signature" and the client's one-time code (#7). | Set both or neither. `SCOPEFLOW_MAIL_FROM` must be a sender on a domain verified in Resend, e.g. `Scopeflow <scopes@your-domain>`. Without them, Send for signature falls back to copy link / mail app, and **the email-code check cannot be turned on** (the owner toggle reports that email is not configured). Optional: `SCOPEFLOW_MAIL_REPLY_TO`. |

## AI drafting (#10) and scope-creep radar (#11): optional

| Variable | What it does |
| --- | --- |
| `OPENAI_API_KEY` | Turns AI on with OpenAI (default model `gpt-4o-mini`). |
| `ANTHROPIC_API_KEY` | Turns AI on with Anthropic (default model `claude-haiku-4-5`). |
| `SCOPEFLOW_LLM_PROVIDER` | Optional: `openai` or `anthropic`, to choose when both keys are set (OpenAI wins otherwise). |
| `SCOPEFLOW_OPENAI_MODEL`, `SCOPEFLOW_ANTHROPIC_MODEL` | Optional model overrides. |

With neither key set, both AI features are off and the UI says so. Text is sent to the provider only when an
owner presses Draft with AI or runs a radar check; the privacy notice already describes this.

**Watch for a Haiku 4.5 deprecation notice.** Anthropic lists `claude-haiku-4-5-20251001` as active with a
tentative retirement date of "not sooner than 2026-10-15"
([model deprecations](https://docs.anthropic.com/en/docs/about-claude/model-deprecations)). Anthropic says it
gives at least 60 days' notice by email to the account owner. When that notice arrives, set
`SCOPEFLOW_ANTHROPIC_MODEL` to the recommended replacement (or change `DEFAULT_MODELS` in `lib/llm.ts`) and run
one draft and one radar check before the retirement date. Requests to a retired model fail.

## Razorpay deposit on signature (#12): optional

| Variable | What it does |
| --- | --- |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay Dashboard > Settings > API Keys. With both set, a client who approved a scope with a deposit can pay it with Razorpay Checkout. Without them the Pay button is disabled with the reason, and `POST /api/review/<token>/deposit` answers 503 `payments_disabled`. |
| `RAZORPAY_WEBHOOK_SECRET` | The secret you set on the webhook below. |

Webhook (Razorpay Dashboard > Webhooks > Add new webhook):

- **URL:** `<APP_URL>/api/payments/razorpay/webhook`, e.g. `https://scopeflow-qnng.onrender.com/api/payments/razorpay/webhook`
- **Active events:** `payment.captured` and `order.paid`
- **Secret:** the same value as `RAZORPAY_WEBHOOK_SECRET`

The webhook is what marks a deposit paid and appends the signed `payment` entry to the project ledger: the
Checkout success callback alone does not. Start with Test Mode keys, pay one deposit end to end, check that
the ledger shows the payment, then switch to Live keys and a Live webhook. This is a scaffold: no refunds,
partial payments, payouts to freelancers, or reconciliation of missed webhooks yet (see
[deposits.md](deposits.md)).

Before you turn Live keys on, update the privacy notice (`app/privacy/page.tsx`). It still says "This beta
does not collect payments or store card information" and does not name Razorpay as a processor.

## Client-data retention (#13)

| Variable | What it does |
| --- | --- |
| `SCOPEFLOW_CONTEXT_RETENTION_DAYS` | Optional server-wide default (1–3650 days) for owners who set no retention in Data controls. After that many days, the IP address and browser user agent stored with client decisions and client ledger entries are replaced with `redacted`. Unset = keep until deleted. Signed fields are never touched, so receipts and the hash chain still verify. |

**Daily cron.** Retention only happens when the redaction script runs. Add a Render Cron Job on the same repo
and environment group (it needs `DATABASE_URL`, plus `SCOPEFLOW_CONTEXT_RETENTION_DAYS` if you use it):

- **Command:** `node scripts/redact-expired.mjs`
- **Schedule:** once a day, e.g. `30 20 * * *` (Render cron times are UTC; 20:30 UTC is 02:00 IST)
- **Build command:** `npm ci`

The script is idempotent. It prints how many versions and ledger entries it redacted.

## Keep the OTP dev flags unset in production

`SCOPEFLOW_OTP_DEV` and `SCOPEFLOW_OTP_DEV_LOG` exist only for local development and CI. With
`SCOPEFLOW_OTP_DEV=1`, one-time codes are written to the server log instead of emailed, and
`SCOPEFLOW_OTP_DEV_LOG` also writes them to a file. Anyone who can read those logs could then confirm a
client's email and sign as that client. The code refuses dev mode unless `APP_URL` is localhost, but do not
rely on that guard: **leave both variables unset on Render**, and make sure they are not in a shared
environment group.

## After deploying

1. `npm run db:migrate` runs migrations 0004–0008 (client OTP, project time zone, templates, payments,
   retention settings). They add tables and columns, and 0008 also replaces the immutability trigger
   functions so that retention may redact IP and user agent (and nothing else) on recorded decisions.
2. Check `/api/health`, then sign and download one PDF receipt and open its QR code at `/verify`.
3. If Resend is set: turn on the email code check on a test project and sign through it.
4. If an AI key is set: run one Draft with AI and one radar check.
5. If Razorpay is set: pay one Test Mode deposit and check the ledger entry.
6. Run the cron job once by hand and check its output.
