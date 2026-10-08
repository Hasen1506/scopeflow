# Deposit on signature (Razorpay scaffold)

- A scope may carry `deposit_pct` (signed content). After the client approves, the review page shows the deposit.
- With `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`: `POST /api/review/<token>/deposit` creates (or reuses) a Razorpay
  order for the deposit in the currency's minor unit and the page opens Razorpay Checkout (CSP allows
  checkout.razorpay.com only). Without keys the button is disabled with the reason and the endpoint answers 503
  `payments_disabled`.
- `POST /api/payments/razorpay/webhook` (events `payment.captured`, `order.paid`): verifies
  `X-Razorpay-Signature` (HMAC-SHA256 of the raw body with `RAZORPAY_WEBHOOK_SECRET`, constant time), requires the
  order to exist with the same amount and currency, marks it paid once, and appends a signed `payment` entry
  (`provider, purpose, order_id, payment_id, amount, currency`) to the project's hash-chained ledger, which the
  client's browser re-verifies. Owners can never write `payment` entries.
- Where the money goes: orders are created with the server's own `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`, so a
  deposit settles to the Razorpay merchant account of whoever operates the server, not to the creator. The terms,
  reviewer guide and review page say so; `tests/property/payment-copy.test.mjs` fails if Route transfers appear
  without the copy being updated.
- Amount: `depositAmount()` is `totals(content).deposit`, the figure printed on the signed scope paper.
- Not done (scaffold): refunds, partial payments, Razorpay Route payouts to freelancers, Stripe, reconciliation
  job for missed webhooks. See docs/IDEAS.md.
