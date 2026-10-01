# Scopeflow pricing and economics

Prepared 1 October 2026. Recommended experiment: free first project, Solo $4/month or $36/year. These are proposed prices, not active subscriptions. No billing is implemented. Infrastructure, support, conversion and retention figures below are scenarios, not measured results.

## Does $1 make sense?

$1/month can cover low technical usage, but leaves little room for support, fraud, refunds and acquisition. The product's code complexity does not determine the value of avoiding scope misunderstandings. That value and willingness to pay still need validation with actual clients. Keep the first project and recipient reviewing free to reduce adoption friction; test payment with creators who repeatedly use the workflow.

If a $1-equivalent offer is useful, charge $12/year upfront as a limited founding experiment. Advertise the actual $12 annual charge prominently. Avoid an unlimited lifetime offer or bundling unlimited model usage. Do not assume a lower price creates viral growth.

## Payment reference scenarios

The US reference uses [Stripe domestic-card pricing](https://stripe.com/pricing), 2.9% + $0.30 per successful charge, plus [Stripe Billing pay-as-you-go](https://stripe.com/billing/pricing), 0.7% of Billing volume. Combined reference fee = 3.6% of revenue + $0.30 per charge. This is not a quote for the founder's merchant account. International cards, currency conversion, tax tools, disputes and sales taxes are excluded.

| Offer | Monthly revenue equivalent | Monthly fee equivalent | After payment fees | After $0.50 operating reserve | Contribution margin |
|---|---:|---:|---:|---:|---:|
| $1/month | $1.00 | $0.336 | $0.664 | $0.164 | 16.4% |
| $12/year | $1.00 | $0.061 | $0.939 | $0.439 | 43.9% |
| $3/month | $3.00 | $0.408 | $2.592 | $2.092 | 69.7% |
| $4/month | $4.00 | $0.444 | $3.556 | $3.056 | 76.4% |
| $36/year | $3.00 | $0.133 | $2.867 | $2.367 | 78.9% |
| $5/month | $5.00 | $0.480 | $4.520 | $4.020 | 80.4% |

Annual values amortize one payment over 12 months; annual cash receipts are not monthly recurring cash collection. The $0.50 monthly reserve per payer is an adjustable assumption for variable hosting, support and refunds. It is not a measured cost and does not include all overhead, founder salary, acquisition or taxes. Contribution margin is not net profit. At $1/month, one five-minute support task valued at $12/hour costs $1 and consumes roughly six months of modeled contribution.

An India-based merchant must use local rates. [Stripe India](https://stripe.com/in/pricing) lists 2% for domestic Mastercard/Visa and different international/presentment/conversion rates; it requires requesting an invite. Do not apply the US fixed $0.30 fee to that account. Merchant eligibility, chosen provider, settlement currency and subscription support must be established before finalizing our actual fee model.

## Technical costs

Scopeflow currently stores small structured text in D1 and serves web/API/MCP requests through Sites. It has no uploaded files, background model calls, outbound email service or enabled payment processor. ChatGPT/Muse prepares scopes using the user's agent; Scopeflow does not currently purchase an extra model call for each scope. Adding hosted AI, email, attachments or background jobs would change costs.

[Cloudflare Workers direct pricing](https://developers.cloudflare.com/workers/platform/pricing/) starts at $5/month on Paid, with 10 million requests and 30 million CPU milliseconds included. Above that, requests cost $0.30/million and CPU $0.02/million ms. These are underlying provider references, not confirmed charges or quotas for our managed Sites deployment.

[D1 direct pricing](https://developers.cloudflare.com/d1/platform/pricing/) includes 25 billion rows read, 50 million rows written and 5 GB storage on Paid, then $0.001/million reads, $1/million writes and $0.75/GB-month. Queries can scan more rows than they return, and indexes add writes. Cheap request rates do not prove database capacity or sufficient operational reliability.

Illustrative small beta: 100 payers at 1,000 dynamic requests each/month produce 100,000 requests/month. At an assumed 10ms CPU average that is one million CPU ms. Ten projects with five 4KB versions each per payer are about 20MB of content for 100 payers. Indexes, metadata, rate-limit writes, unpaid users, abuse and growth add usage. These inputs are unmeasured; instrument real usage and verify Sites commercial terms before relying on the provider's included allocations. A million users still require capacity and architecture work.

## Business scenarios

Using the US fee reference, $0.50/payer/month reserve, and an additional assumed $25/month fixed overhead:

| Paying creators | $1/month contribution after fixed overhead | $4/month contribution after fixed overhead |
|---|---:|---:|
| 100 | -$8.60 | $280.60 |
| 1,000 | $139.00 | $3,031.00 |

These are scenarios, not forecasts or net profit. Free users must also be funded. At the recommended monthly price, a three-month contribution payback ceiling would be roughly $9.17 acquisition cost before fixed overhead. That is a ceiling to test, not a suggested advertising budget; retention and churn are unknown.

Use a founding cohort to measure repeat creation, recipient decisions, support minutes, infrastructure usage, failed payments and willingness to pay. Keep billing disabled until merchant onboarding, signed idempotent webhooks, paid entitlements, cancellation/refunds and purchase tests are working. Final price should follow observed value and economics, not the app's apparent simplicity.
