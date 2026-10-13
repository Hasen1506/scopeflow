# Provider contract fixtures (L14)

Webhook payloads in the shape documented by the providers, with fictional ids and TEST notes:

- Razorpay: https://razorpay.com/docs/webhooks/payloads/payments/ (order.paid, payment.captured),
  https://razorpay.com/docs/webhooks/payloads/refunds/ (refund.processed),
  https://razorpay.com/docs/webhooks/payloads/subscriptions/ (subscription.activated / charged / halted / cancelled).
- Stripe: https://docs.stripe.com/api/events/types (checkout.session.completed,
  checkout.session.async_payment_succeeded, charge.refunded, customer.subscription.updated / deleted).

`tests/property/ws-10-providers.test.mjs` signs each one the way the provider does (Razorpay:
HMAC-SHA256 of the raw body, X-Razorpay-Signature; Stripe: `t=<ts>,v1=HMAC(t.body)`) and checks the
parsers in lib/razorpay.ts and lib/stripe.ts against them. WS-04 (payments, refunds) and WS-08
(subscriptions) reuse them for their own webhook tests.
