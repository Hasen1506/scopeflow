# Scopeflow: review and scale readiness

Updated 1 October 2026. This is an early beta, not a production capacity certification.

## Reviewer access

The implementation supports public app/docs/policy pages and sign-in for each reviewer to create their own isolated test data and API token. The reviewer guide is at /reviewer-guide. No shared admin password or production customer data is required. Public reviewer access is deployed. A branded domain and real connector testing remain required before directory submission.

## Branded URL

The default Sites address contains the account namespace. Renaming the app slug does not remove that namespace. A custom domain with DNS control is the supported way to use a product-only hostname. The application must use the verified custom hostname for website, API, OpenAPI, documentation and policy links; no invented domain or nonworking endpoint should be submitted. DNS ownership and routing are still required.

## Can this serve millions?

Muse acceptance is a distribution/review decision, not a load-test certificate, an uptime commitment or a guarantee of users. A million registered accounts differs greatly from a million concurrent users. The present implementation uses one D1 database and has not been benchmarked under representative traffic.

Cloudflare documents a maximum 10 GB per paid D1 database and describes each database as single-threaded; throughput depends on query duration. Its recommended scale-out model uses multiple smaller databases. Those provider limits do not establish this Sites project's actual quota or hosting commercial terms. See https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/d1/platform/pricing/ .

Illustration only: one million active users making 20 requests/day means 20 million requests/day, about 231/second on average and around 2,315/second at an assumed tenfold peak. Each app request can execute several database queries. One million accounts storing 10 projects with 5 versions averaging 4 KB each would store roughly 200 GB of content alone, before indexes and metadata. A single database cannot satisfy that storage assumption.

## Gates before broad launch

1. Connect and validate a branded domain, anonymous reviewer links and production sign-in. Test two real independent accounts and revoked/expired tokens. Complete actual Muse integration testing.
2. Run an independent security review. Project JSON export and review-link revocation/replacement are implemented. Add self-service account deletion and operational incident handling. Review privacy/legal obligations and minimize logs containing identifiers.
3. Establish production hosting quotas, costs, metrics, alerting, backup/restore drills, a status/support process, and spending controls. Keep a small announced beta until those are proven.
4. Benchmark realistic mixed traffic on an authorized staging environment. Track p95 latency, failures, storage growth and saturation, plus concurrent revision/approval races. Define pass/fail targets before measuring. Do not stress the shared live review endpoint.
5. For larger usage, partition data by account/tenant or migrate to a database arrangement sized from measured demand. Create idempotency is implemented. Add indexed pagination, edge abuse protection, appropriate caching that never leaks private scopes, and queues for future background tasks.
6. Roll out in measured cohorts; raise limits only after capacity and cost data support them. Millions remain an engineering and operational milestone to prove.

## Business boundaries

Proposed Solo $4/month or $36/year remains a hypothesis; no charges or checkout are enabled. Approval does not guarantee revenue, ranking, virality or Meta endorsement. Confirm payment processing, support burden and infrastructure economics before charging broadly.
