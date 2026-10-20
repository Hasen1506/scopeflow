# Online payments: deposits, invoices and refunds (Razorpay and Stripe)

- A scope may carry `deposit_pct` (signed content). After the client approves, the review page shows the
  deposit and, for each issued invoice, what is still open on it.
- Provider: INR goes to Razorpay (`RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`) when configured, other currencies
  to Stripe Checkout (`STRIPE_SECRET_KEY`, optionally limited by `STRIPE_CURRENCIES`), otherwise whichever is
  configured (`providerFor` in `lib/razorpay.ts`). Without either, the buttons are disabled with the reason and
  the endpoints answer 503 `payments_disabled`.
- `POST /api/review/<token>/deposit` and `POST /api/review/<token>/invoices/<seq>/pay` (`lib/checkout-server.ts`)
  create a Razorpay order (reused on reload) or a Stripe Checkout session (idempotent per hour) in the
  currency's minor unit. Razorpay opens Checkout on the page (CSP allows checkout.razorpay.com only); Stripe
  redirects to its hosted page and back to `/payment-return`, which returns to the review link kept in the tab's
  session storage, so the review token never reaches Stripe. An invoice payment is for what is still open on
  that invoice: a partial payment of the balance.
- Webhooks: `POST /api/payments/razorpay/webhook` (events `payment.captured`, `order.paid`; HMAC-SHA256 of the raw
  body with `RAZORPAY_WEBHOOK_SECRET`) and `POST /api/payments/stripe/webhook` (events
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`; `Stripe-Signature` with
  `STRIPE_WEBHOOK_SECRET`, five-minute tolerance). Both require the order to exist with the same amount and
  currency, mark it paid once, and append a signed `payment` entry (`provider, purpose (deposit | invoice),
  order_id, payment_id, amount, currency, invoice_number?`) as the `system` actor. Owners can never write
  `payment` entries.
- Reconciliation: the daily job calls `POST /api/payments/razorpay/reconcile` (bearer `SCOPEFLOW_CRON_SECRET`),
  which repairs paid orders missing their ledger entry and asks Razorpay and Stripe about unpaid orders from the
  last 30 days (at most once every six hours per order).
- Refunds: `POST /api/scopes/<id>/refunds` refunds part or all of an online payment through its provider and
  appends a `refund` entry with the provider's refund id; at most what is still refundable on that payment, and
  a retry with the same `request_id` never refunds twice. Refunds made outside Scopeflow are recorded as `refund`
  entries through the ledger API. Refunds lower the amount paid everywhere (balance, invoice status, statement,
  reminders).
- Where the money goes: orders are created with the server's own keys, so payments settle to the merchant account
  of whoever operates the server, not to the creator. The terms, reviewer guide and review page say so;
  `tests/property/payment-copy.test.mjs` fails if Route transfers or Connect accounts appear without the copy
  being updated. Paying each freelancer directly (Razorpay Route, Stripe Connect) needs a KYC'd account per
  freelancer and is not done.
- Amount: the deposit is `agreementTotals(...).deposit` (`lib/agreement-totals.ts`), in the agreement's
  currency, the figure printed on the signed scope paper.
