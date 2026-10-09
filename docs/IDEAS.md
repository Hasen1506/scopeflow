# Ideas backlog (not implemented)

Collected while implementing the 2026-10-07 roadmap PRs (A–F plus retention/wording). Each line is a
candidate, not a commitment; nothing here is built. Roughly ordered by value for effort within each group.

## Integration follow-ups between the roadmap PRs (small, do right after merging)
Done since: receipts default to the project time zone, and the deposit charged is `totals().deposit` (the figure on
the signed scope paper; the old separate formula could differ by a cent).
- **Receipt prints tax, deposit and payment terms** (A + C) and the deposit-paid ledger entry (A + F).
- **Unify `lib/time.ts` (C) and `validTimeZone`/`stamp` in `lib/receipt.ts` (A)** into one helper.
- **OTP for change-order approvals** (B): the same email-code gate before a client approves a change order.
- **Radar before approval in the UI** (E): the endpoint already works on the latest version; the button lives only
  in the post-approval ledger panel.
- **Templates carry currency/tax/deposit defaults** (C + D).
- **AI draft respects owner default clauses** (D + retention/wording PR).

## Trust and legal weight
- **PAdES-signed PDF with a DSC** and an **RFC 3161 timestamp** (TSA) on the receipt, so the PDF verifies in Acrobat
  without Scopeflow.
- **Embed a Unicode font** (e.g. Noto Sans subset) in the receipt; today non-WinAnsi names (Tamil, Hindi, CJK) print as "?".
- **Aadhaar eSign via an ESP** (Digio, Leegality) as a third assurance tier above email OTP, for high-value work.
- **BSA 2023 §63 certificate data** generated from the ledger for Indian disputes ("dispute pack": receipt PDF +
  ledger + chain proof + certificate).
- **SMS / WhatsApp OTP** (MSG91 or Twilio; Indian DLT sender + template registration needed).
- **"Who opened" log** on review links (first/last view, count), shown to the owner.
- **Review-link expiry** (e.g. expire after 30 days) and **automatic reminders** on a schedule. Manual reminders
  (one a day, three per version) are built.
- **Multi-party signing order** (approver + finance) and multiple signers per version.
- **Separate `system` ledger actor** for provider events (payments) instead of `client`, so a revoked review link
  never blocks recording a payment.
- **Stamp duty flag** for Indian agreements above a threshold, with an e-stamping link.

## Money
- **Dual-currency display with an FX rate locked at signature** (INR ↔ USD export work), plus an LUT/GST export note.
- **Milestone payments** (schedule of amounts and due dates) and **Net-X payment reminders**. Recording offline
  payments, the balance due and a PDF statement of account are built; a GST tax invoice is not.
- **Razorpay Route / Stripe Connect payouts** to each freelancer (KYC per freelancer), refunds, partial payments,
  a reconciliation job that polls orders when a webhook is missed, and Stripe Checkout for non-INR clients.
- **Hour-bank or money-budget revisions** as an alternative to a fixed round count.
- **Per-account default currency, tax and locale** (INR + GST 18% for India) instead of USD for every new draft.
- **INR plan pricing** on the Plans page.

## AI and scope intelligence
- **Embedding similarity** for the radar (semantic match of requests to clauses), multilingual (Hindi/Tamil requests).
- **Running "creep value" in Insights**: total value of out-of-scope requests caught, approved and declined.
- **Email forwarding into the radar** (Resend inbound or Gmail) and an MCP tool that runs the full radar.
- **AI rewrite suggestions for lint issues** ("replace 'minor tweaks' with ...") and a domain-specific vocabulary pack.
- **Template marketplace / shared team templates** with versioning and tags.
- **Evaluate `gpt-6-luna` as the OpenAI default** (D + E): cheaper than `gpt-4o-mini` and current, but a reasoning
  model; needs the Chat Completions request re-verified (`max_completion_tokens`, no `temperature`) against a live key.
- **Model-lifecycle guard**: a scheduled check of the provider deprecation pages (or the Models APIs) that warns before
  the configured model retires (Claude Haiku 4.5 is listed "not sooner than 15 Oct 2026"); today a test pins known
  retired ids only.
- **Show the active model on the AI controls** and let the owner pick a quality tier (fast vs careful) per request.

## Product and operations
- **Retention per project with legal hold**, and an automatic expiry for archived drafts.
- **Owner branding** on the review page, PDF and emails (logo, colours) and a custom sending domain per account.
- **Email provider adapter** (Postmark, SES) behind the existing Resend interface.
- **Plan-tier config** for the beta caps and rate limits (today constants in code).
- **Drop the cookie-secret fallback for the signing key in production**; move signing to KMS/HSM.
- **Accessibility pass** on the review page (OTP input, deposit button, focus order).
