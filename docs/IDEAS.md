# Ideas backlog: status

Collected while implementing the 2026-10-07 roadmap. Everything that can be built in code is now built and
tested; the last section lists the items that need a contract, an account or a registration outside this
repository, and what is already in place for each. [DEPLOY.md](DEPLOY.md) says which variables turn each
feature on.

## Integration follow-ups: built
- Receipt shows the deposit-paid ledger entry, tax, deposit and payment terms.
- One time helper (`lib/time.ts`) for receipts, statements and the ledger.
- Email/SMS one-time code before a client approves a change order or countersigns.
- Radar before approval: works on the latest version from the workspace.
- Templates carry currency, tax, deposit and payment-terms defaults.
- AI drafts respect the owner's default clauses.

## Trust and legal weight: built
- PAdES-signed PDFs (with a configured document-signing certificate) and RFC 3161 timestamps (B-T).
- Embedded Unicode fonts (Indian scripts, Greek, Cyrillic) in every PDF, shaped with HarfBuzz.
- BSA 2023 §63 dispute pack: receipts, statement, invoices, ledger with chain proof, timestamps and the
  certificate template, in one ZIP.
- SMS and WhatsApp one-time codes (MSG91 or Twilio).
- Review-link expiry, manual and automatic reminders, and the "opened" log.
- Multi-party signing: roles (e.g. finance) that must countersign after the client approves.
- Separate `system` ledger actor for provider events.
- Stamp-duty flag in the clarity check for Indian agreements above the threshold.
- Production refuses to sign with the cookie secret; a dedicated signing secret is required.

## Money: built
- Dual-currency line with an FX rate locked at signature (ECB reference rates), and the LUT/GST export note.
- Payment milestones, Net-X due dates and overdue-invoice reminders.
- Full GST tax invoices: SAC, place of supply, CGST/SGST/UTGST or IGST, amount in words.
- Online payments: Razorpay (INR) and Stripe Checkout (other currencies, `STRIPE_CURRENCIES`), for the deposit
  and for what is open on each invoice (partial payments of the balance); signed webhooks for both and a
  daily reconciliation that asks the provider about missed webhooks.
- Refunds: through Razorpay or Stripe from the workspace, or recorded when made outside Scopeflow; both are
  on the client's record and statement.
- Hour-bank or money-budget revisions as an alternative to a round count.
- INR plan pricing on the Plans page.

## AI and scope intelligence: built
- Embedding similarity for the radar (OpenAI or Voyage), multilingual, off without a provider key.
- Running "creep value" in Insights.
- Email forwarding into the radar (private per-project address, Postmark or generic inbound webhook) and the
  MCP `run_radar` tool.
- One-click rewrite suggestions for vague wording in the clarity check, and a vocabulary of adjacent work
  clients commonly assume is included, per project type (website, brand, content, app).
- Shared templates with versioning (revision history and restore), tags and share links.
- Model-lifecycle guard: a daily check of each provider's Models API plus known retirement dates.
- The active model on the AI controls, with a fast or careful tier per request.

## Product and operations: built
- Retention per project, legal hold, and automatic expiry of archived drafts.
- Owner branding (logo, colour, reply-to) on the review page, PDFs and emails.
- Email provider adapter: Resend, Postmark and Amazon SES.
- Plan-tier configuration for caps and rate limits.
- Accessibility pass on the review page (focus order, OTP input, payment buttons, inline errors).

## Needs a contract, account or registration outside the code
- **Aadhaar eSign** through an eSign Service Provider (Digio, Leegality): needs an ESP agreement and API keys.
  The assurance tiers (name, email code, SMS/WhatsApp code) and the identity evidence in signed receipts are
  where a third tier would plug in.
- **KMS or HSM key storage:** needs a cloud KMS account or an HSM. All signing goes through
  `lib/signing.ts` (`signRecord`, `verifyRecord`) and `lib/pades.ts`, the two places to point at it.
- **Payouts to each freelancer** (Razorpay Route or Stripe Connect): needs a linked or connected account per
  freelancer with that freelancer's own KYC. Payments go to the operator's merchant account today.
- **DLT sender and template registration** for SMS to Indian numbers: done by the business on the DLT portal;
  MSG91 delivery is built and waits on it.
- **A custom sending domain per account:** needs each owner's domain verified with the mail provider (DKIM).
  Emails already carry the owner's name, logo and reply-to.
- **`gpt-6-luna` as the OpenAI default:** needs a live key to re-verify the Chat Completions request for a
  reasoning model (`max_completion_tokens`, no `temperature`). It can be tried today with
  `SCOPEFLOW_OPENAI_MODEL`; the default stays `gpt-4o-mini` until that check is done.
