# Scopeflow audit

Reviewed by reading the schema, API routes, mail templates and the running app (desktop and phone widths), then fixing the items that do not need a secret or a product decision. Findings are ranked by what would hurt a paying client.

## Fixed in this change

**Must-fix**

- Theme choice did not stick. The app stored two axes (`theme` and `system`/`light`/`dark`), and a refresh could put the marketing page’s attributes back on `<html>`. There are now three appearances: Light, Dark and Etched. The choice is applied before first paint and again after hydration. The switch sits in a side rail (a bottom bar on a phone).
- Switching sections or refreshing flashed the marketing page for a signed-in owner. A session hint is written when sign-in succeeds, and the workspace stays up while `/api/me` is still loading.
- Templates appeared twice (main nav and the Account menu). The Account menu keeps Settings, Connect and Plans. Templates stays in the main nav.
- Account and editor controls were different heights. Text inputs and selects in an editor are 48px. Deliverable quantity, unit and price are 44px, and the quantity column is wide enough for the spinner. “Outside this scope” and the account default for that text are tall text areas.
- A client decision did not email the freelancer. Approving or requesting changes now queues a `client_decision` email to the owner’s address on file. If that address has not been stored yet, the decision is still saved and the send is skipped.
- The countersign error page had no top-level heading.

**Should-fix**

- The client review page now says who sent the scope when the account has a business name, and what Approve versus Request changes does.
- The WhatsApp settings panel is on the account page. Without Meta keys it says the bot is not set up. It does not pretend to send messages.
- Support heading “Talk to the builder” is now “Support and security”.
- Unexpected server errors can POST `{source, id, message, at}` to `SCOPEFLOW_ERROR_WEBHOOK` when that URL is set. No stack and no request body are sent.
- `docs/neon-live-configuration.md` still described a free plan, six tables, and an old Render hostname. It now matches `render.yaml` (`https://scope-flow.tech`, Starter, migrations). Neon does not delete rows after six hours.
- `docs/pricing-economics.md` still described Cloudflare D1 and “no outbound email”. The app is Neon and Render. Email, payments and in-app drafting run only when those keys are set.

**Nice-to-have**

- Client bundles import `lucide-react`, `date-fns` and `recharts` through `optimizePackageImports`.

## Needs owner

These cannot be finished from the repository. Each step is the concrete check.

1. **Email DNS.** Mail is not tied to one domain in code. Set `SCOPEFLOW_MAIL_FROM` (for example `Scopeflow <notifications@scope-flow.tech>`) and one provider: `RESEND_API_KEY`, or `POSTMARK_SERVER_TOKEN`, or `SCOPEFLOW_SES_ACCESS_KEY_ID` / `SCOPEFLOW_SES_SECRET_ACCESS_KEY` / `SCOPEFLOW_SES_REGION`. Optional `SCOPEFLOW_MAIL_PROVIDER` (`resend`, `postmark`, `ses`) and `SCOPEFLOW_MAIL_REPLY_TO`. Put them on the Render web service. Copy the provider’s Records tab. Classic Resend values, which change if the dashboard shows CNAMEs instead (domains created after August 2026):
   - MX `send` priority 10 → `feedback-smtp.<region>.amazonses.com` (example `feedback-smtp.us-east-1.amazonses.com`). This is the bounce return path, not the inbox MX.
   - TXT `send` → `v=spf1 include:amazonses.com ~all`
   - TXT `resend._domainkey` → `p=<public key from the Resend dashboard>`
   - TXT `_dmarc` → `v=DMARC1; p=none; rua=mailto:<you>`
   Postmark, if used: TXT SPF `v=spf1 include:spf.mtasv.net ~all`, plus the return-path CNAME and DKIM the dashboard shows. SES: three DKIM CNAMEs `*._domainkey` → `*.dkim.amazonses.com`, SPF `v=spf1 include:amazonses.com ~all`, and a custom MAIL FROM MX `feedback-smtp.<region>.amazonses.com` priority 10. Verify with [MXToolbox](https://mxtoolbox.com/) (SPF, DKIM, DMARC, MX) and [mail-tester.com](https://www.mail-tester.com/).
2. **WhatsApp Business.** Share links (`wa.me`) work with no keys. The bot, OTP template and webhook stay off until the Render web service has `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, and optionally `WHATSAPP_OTP_TEMPLATE`, `WHATSAPP_OTP_LANG`, `WHATSAPP_BOT_NUMBER`, `WHATSAPP_API_VERSION` (default `v21.0`). Point the Meta webhook at `https://scope-flow.tech/api/whatsapp/webhook`.
3. **Cron secret.** `render.yaml` can generate `SCOPEFLOW_CRON_SECRET` (at least 16 characters; `openssl rand -base64 32`). The same value must be on the web service and the cron services. `/api/notify/drain` and `/api/payments/razorpay/reconcile` answer 503 until it is set, and 401 for a wrong bearer token. If GitHub Actions cron is used, set the same name as a repository secret.
4. **Signing secret.** Production refuses to seal decisions without `SCOPEFLOW_SIGNING_SECRET`. Rotating it breaks old receipts unless the previous secret is kept as a verification key.
5. **Error webhook.** Set `SCOPEFLOW_ERROR_WEBHOOK` to the collector URL (Slack incoming webhook, a small HTTPS endpoint, or similar). Until then, failures are only in the Render logs, with an `err_…` id in the API response.
6. **Database backups.** Neon keeps its own point-in-time history on the plan you pay for. Confirm the production branch’s history window in the Neon dashboard. The app does not ship a second backup job.
7. **One-time code before approval.** Identity check is off unless the project sets `require_otp`. Turning that on for every new project changes what every client must do. Decide that in product, then set it from project settings (email, SMS or WhatsApp, and a destination on file). Do not flip the default in code without that decision.
8. **Read rate limits across instances.** Writes are counted in Postgres. Reads are counted in memory on each instance, and the comments point at Cloudflare rate-limiting rules as the real cap. Add those rules in Cloudflare for `/api/review/*` and `/api/auth/*` if more than one instance will run.
9. **npm audit.** `npm audit` reports 5 high and 4 moderate, all in dev tooling (`eslint-config-next` → `fast-glob` → `micromatch` → `braces`, and `drizzle-kit` → `esbuild`). They are not in the production server bundle. Upgrade when the upstream releases land; do not force-break the lint toolchain for them.

## Ideas for the owner

Not built.

- A qualified signature (Aadhaar eSign is stubbed behind `SCOPEFLOW_ESIGN_PROVIDER`; DocuSign or Zoho Sign is not integrated). Today’s record is a typed name, time, IP, user agent, content hash and an Ed25519 seal. The paper footer already says it is not a verified electronic signature. A dispute that needs a statutory signature needs a provider contract.
- Plan prices and which features are actually gated. `lib/plans.ts` still marks several items “coming soon” and enforces numeric limits only.
- Live Muse connection. Connect is a prompt to paste into Muse, then “Import a draft (JSON)”. In-app drafting is `POST /api/draft` and needs `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.
- Positioning and the founding-price experiment in `docs/pricing-economics.md`.

## What you didn’t ask about

Walked in a browser at 1280 and 390, plus the route and schema review.

**Journeys.** Sign-up, sign-in, the try-editor, templates, plans, connect, verify, privacy, terms, support and the account gate all render. The golden Playwright flow already covers compose → private link → approve → change order. A new spec covers request-changes → new version → re-approve, and checks both versions in Decision history. It runs in CI with Postgres; this environment has no database, so it was not executed here. ChatGPT MCP is `app/mcp/route.ts`. Agents are not given client review links (`review_path` is null for API tokens).

**Empty, loading, error.** Signed-out account and payments pages explain that sign-in is required. A missing review link and a missing countersign link render an error instead of a blank page. `/api/health` on this machine returned 503 `auth_not_configured` because Neon Auth is not in the local env. That is the right failure.

**Copy.** Most client-page copy is already plain and specific. The support page’s casual heading was the one that read like a side project. “EARLY BETA” on the wordmark is accurate for the current release; removing it is a launch decision.

**Visual consistency.** See the field and theme fixes above. Three themes only. Etched is the cobalt look (theme A, light), not a fourth “etched night”.

**Mobile.** The client shell already had a phone layout. The new theme control becomes a bottom bar under 720px so it does not cover the approval buttons (the page padding includes the bar).

**Accessibility.** axe on 25 public pages found one moderate issue: the countersign error page had no `h1`. That heading is now there. Lighthouse accessibility was 100 on the home page and the sign-in page. Colour contrast of the theme tokens is checked by `tests/property/ws-09-theme.test.mjs`.

**Trust on the client page.** The scope document, the version, the consent line, and the “what happens next” block after approval were already there. The sender line is new when a business name is saved. A forwarded link is still a bearer token: anyone with it can act, unless that project requires a one-time code.

**Abuse.** Review POST requires a same-origin check, a typed name, `acknowledged: true`, the version, and the SHA-256 of the canonical content. A mismatch is 409 `content_changed`. Pending links can expire after 7, 14, 30, 60 or 90 days when the owner sets that; approved links stay as the record. Revoking a link is a separate owner action. Webhooks check a signature or a bearer secret. `tests/property/api-auth.test.mjs` fails if a new route has neither an auth check nor a place on the public list.

**Reliability.** There is no Sentry package. Logs plus the optional webhook above are the monitoring path. Migrations live in `db/migrations/` and CI applies them before the API suite. Readiness is `/api/readiness` with the operator token.

**Security headers** (measured on the local server): Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`. Production also sends HSTS. CSP still allows `unsafe-inline` scripts because the App Router emits bootstrap scripts; `unsafe-eval` is development only. Removing `unsafe-inline` needs a nonce build and is not a safe one-line change.

**Nielsen, in short.** The product speaks in the user’s language and shows status after a decision. The biggest heuristic miss was the missing owner notification (now queued) and the theme control that did not match what it stored (now three named buttons). Error recovery on a bad review link tells the reader to ask the sender. Help exists on Support, Privacy and the reviewer guide.

## Proof

| Check | Result |
| --- | --- |
| `tsc --noEmit` | pass |
| `next build` | pass |
| Property tests added here | pass (approval body, tokens, diff base, totals, API auth inventory, cron bearer compare, owner decision email, theme, mounts) |
| `npm run test:props` | 543 tests. 539 passed in this environment. The other 4 call `pdfimages`, `pdftotext` or `pdfsig` (Poppler), which CI installs and this machine does not. Coverage gate 126/126. |
| Playwright landing flash | pass on the dev server and on `next start` |
| Playwright theme-rail screenshots | 6 baselines committed (Light, Dark, Etched × 1280 and 390), generated against `next start` |
| axe | 25 public routes, one moderate finding, fixed |
| Lighthouse home, `next dev` | performance 68, accessibility 100, best-practices 96, SEO 100. LCP 5.6s, 1,614 KiB, unminified dev bundles |
| Lighthouse home, `next start` | performance 89, accessibility 100, best-practices 93, SEO 100. LCP 3.6s, 668 KiB, unused JS about 209 KiB |
| Lighthouse sign-in, `next dev` → `next start` | performance 74 → 83, accessibility 100, SEO 66 (the auth page is thin on indexable content) |
| `npm audit` | 0 critical, 5 high, 4 moderate, all dev dependencies (see Needs owner) |
| Request-changes → re-approve Playwright spec | added; runs in the existing CI Playwright job. Not executed in this environment (no Postgres) |
| Email and PDF goldens | already in `tests/golden/` and `tests/property/mail.test.mjs`. The new owner-decision template is locked by `tests/property/owner-decision-mail.test.mjs` |

CI (`.github/workflows/ci.yml`) already runs typecheck, lint, `test:props` (every `tests/property/*.test.mjs`), the Playwright project, `test:local` and `test:live` on pull requests. The new files sit in those globs. No new workflow was required.

## Not verified here

- Live DNS for `scope-flow.tech` (no mailbox credentials).
- A real client approval against Neon. `/api/health` is 503 until `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` are set.
- The re-approval Playwright spec against Postgres. CI is the run that executes it.
