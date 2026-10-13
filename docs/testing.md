# Ground-truth test suite

Four layers, all deterministic, all wired into CI (`.github/workflows/ci.yml`). Nothing is
retried or quarantined: a flaky test is a bug, fixed at its root.

| Command | What | Needs | Typical time |
| --- | --- | --- | --- |
| `npm run test:props` | Property-based (fast-check), golden records, differential vs pre-PR-3 | nothing (pure) | ~5 s |
| `npm run test:live` | Live API properties, fuzzing, DB-trigger immutability, client-vs-server differential | server + auth fixture + `scopeflow_test` | ~20 s |
| `npm run test:e2e` | Golden Playwright flow in Chromium | server + **fresh** auth fixture | ~30 s |
| `npm run test:local` | The existing integration suites, then every `tests/ws-*.mjs` workstream suite | server + auth fixture | ~15 s |
| `node scripts/check-coverage.mjs` | Coverage gate: every `@covers <ID>` tag is a matrix id, every item of a landed workstream is tagged | nothing | <1 s |

## CI pipeline (WS-10)

`.github/workflows/ci.yml` runs, in order: typecheck, lint, `test:props`, the **coverage gate**,
`npm run build:capped` (the production build under a 460 MB heap, L10), `db:migrate`, then the
local doubles and `next start`, Playwright (desktop Chromium plus the Pixel 7 / iPhone 13 mobile
projects for `*mobile*.spec.ts`), `test:local` and `test:live`.

Local doubles, all on `127.0.0.1`, started from `tests/support/`:

| Double | Port | Stands in for |
| --- | --- | --- |
| `auth-service.mjs` | 55433 | Neon Auth (Better Auth protocol) |
| `tsa-service.mjs` `/` | 55434 | RFC 3161 TSA (`SCOPEFLOW_TSA_URL`) |
| `tsa-service.mjs` `/fx` | 55434 | Frankfurter v1 rates (`SCOPEFLOW_FX_URL`) |
| `tsa-service.mjs` `/fbil` | 55434 | FBIL reference rates, Frankfurter v2 shape (`SCOPEFLOW_FBIL_URL`, WS-01) |
| `tsa-service.mjs` `/stripe`, `/embeddings` | 55434 | Stripe API, Voyage embeddings |

Provider contract fixtures (Razorpay `order.paid`, `payment.captured`, `refund.processed`,
`subscription.*`; Stripe checkout events), copied from the providers' documentation, live in
`tests/fixtures/providers/` and are checked by `tests/property/ws-10-providers.test.mjs`.

Read limits are kept in the server's memory since M26, so `tests/run-local.mjs` clears them
between suites with `DELETE /api/readiness?scope=read-limits` (operator token; the route answers
404 unless `APP_URL` is on localhost), next to the `rate_limits` table reset for write limits.
`tests/ws-10-platform.mjs` starts a second production server on port 5173 + 37 (signing off,
`APP_URL=https://scope-flow.tech`) for the health and canonical-host checks, and stops it.

## Coverage tags

Every test that covers an item of `tests/coverage-matrix.json` (IMPLEMENTATION_PLAN.md §14)
carries a comment `// @covers <ID>` (several ids per line allowed, spaces or commas). The gate
fails on a tag that is not a matrix id, and on any uncovered item whose primary workstream has
landed, which a workstream signals by adding `docs/ws-XX.md`. Items of workstreams that have not
landed are reported only. `npm run test:coverage` (`--strict`) requires every item, for the final
integration. Files under `tests/fixtures/` and `__golden__` do not count.

## Determinism

- **Seeded.** fast-check runs from `FC_SEED` (default `20261007`); a failure prints the seed and
  the shrunk counterexample, and `FC_SEED=<seed>` reproduces it. `FC_RUNS`, `FUZZ_RUNS` and
  `DIFF_RUNS` scale the run counts. In the browser, `crypto.randomUUID` and `Math.random` are
  seeded through an init script, so deliverable ids and therefore the signed content hash are
  identical on every run.
- **Frozen clock.** Pure suites freeze `Date` (`node:test` mock timers) at
  2026-10-07T09:00:00Z and derive every timestamp from it; the browser clock is fixed with
  `page.clock.setFixedTime`. Server-side timestamps (decision times, ledger `created`) are
  real, so goldens that pass through the server replace them with placeholders (see below).
- **Fixed signing key.** Pure suites sign with a fixed `SCOPEFLOW_SIGNING_SECRET`; Ed25519 is
  deterministic, so golden signatures are byte-exact.
- **No network.** Pure suites import `lib/*` only. Live suites and Playwright talk to
  `localhost` only; the browser context aborts every non-localhost request.
- **Mail stubbed.** CI configures no `RESEND_API_KEY`, so "Send for signature" returns its
  copy-link / `mailto:` fallback, which the E2E flow asserts. `sendMail` is property-tested
  against a stubbed `fetch` (`tests/property/mail.test.mjs`): header-safe subject, escaped HTML,
  and every provider or network failure surfaces as `MailError`.

### Pinned fast-check seed

`tests/support/fc-setup.mjs` is the one place fast-check is configured
(`fc.configureGlobal({seed, numRuns, endOnFailure})`). `npm run test:props` loads it with
`node --import`, and every property, differential and golden suite that uses fast-check also
imports it first, so a single file run with `node --test <file>` gets the same seed. Per-property
`numRuns` values are unchanged.

- Default: a fixed seed (`20261007`), so two runs generate identical inputs and identical counts.
- Explore: `FC_SEED=$RANDOM npm run test:props` (or any integer) tries a different random
  stream; `FC_SEED=<seed from a failure>` replays it. CI never sets `FC_SEED`.

## Golden records

- `tests/golden/*.golden.json`: a signed approval receipt and a 4-entry ledger built by the
  real `lib` code from fixed inputs. Byte-exact, including hashes and signatures. The test also
  re-derives the anchor from the documented format with plain `node:crypto` and verifies the
  signature with only the published public key.
- `tests/e2e/__golden__/`: the scope content saved through the UI (exact), the receipt the
  client receives, and the project export. Run-specific values (ids, timestamps, chain hashes
  that commit to them, signatures, review tokens, user agent, IP) become placeholders; the
  content hash is exact. The flow separately checks that the receipt and the export verify.

Regenerate deliberately with `UPDATE_GOLDEN=1`. A golden diff means the canonical form, a hash
input or the signing changed, and receipts already handed to clients would stop verifying.

## Invariants checked by properties

- Canonical scope hashing: key order never matters, surrounding whitespace never matters,
  canonicalisation is idempotent across a storage round trip; deliverable order does matter.
- Any mutation of signed content (17 kinds), of the signer, decision time, version or project
  changes the hash and fails signature verification; flipped signature bits never verify.
- Signed versions are immutable in PostgreSQL: every column change on a decided version and
  every ledger UPDATE/DELETE/TRUNCATE is refused, also under the per-project delete bypass.
  Review-link rotation/revocation on decided versions stays possible (by design).
- The ledger is append-only (appending never changes an earlier hash) and tamper-evident: any
  rewrite breaks the chain; a consistent rewrite without the key breaks the signatures; tail
  truncation is caught against any head the client holds (change-order receipts carry one).
- Fee = baseline fee + approved change orders only; a pending change order never changes the
  fee, deliverables, rounds or due date.
- A review-link token never grants an owner action (21 routes × 5 ways to present it × 3
  tokens) and a client can only ever create `settle` entries, only on its own project.
- Foreign Origins are refused on every state-changing route and change nothing (pure and live).
- Fuzzed input (random JSON, near-valid payloads, raw bodies, hostile path segments) never
  yields a 5xx on 22 route shapes.

## Differential results

**Main vs pre-PR-3** (bda2652, parent of e19fa63; vendored in `tests/fixtures/pre-pr3`):

| Area | Result on random inputs |
| --- | --- |
| Scope canonicalisation, anchor hash | Identical |
| Entry hashes, chain verification (incl. tampered chains) | Identical |
| Agreement folding | Differs **only** for scopes without a delivery date that carry a timeline change or a late client input: the old code reported a shift (`days_shift`, `delays[].shifted`) although there is no date to move (SF-12). Fees are always identical |
| Change-order validation | Identical, except main now rejects `days_delta` on undated scopes |
| Receipts | Pre-PR-3 had no signatures: a database rewrite that recomputes every hash (e.g. a raised fee) passed its in-browser check. Main's signed record rejects it |

**In-browser check vs server verification** (pure on random ledgers, and live against the real
server after tampering rows with the triggers disabled): they agree on every case. Two
documented classes:

- The client additionally checks the head the response claims; the server never states a head
  it did not compute.
- Deleting the newest entries, or stripping every signature, leaves an internally consistent
  record. Truncation is only detectable against a head the client already holds; stripped
  signatures read as legacy "unsigned" records. The review page now shows "Fingerprints match ·
  not signed" for such records instead of "Verified in your browser".

## Running locally

```bash
npm run test:props
# with Postgres (scopeflow_test), the auth fixture and `next start` on :5173 running:
npm run test:live
npm run test:e2e   # needs a freshly started auth fixture (it signs up golden-owner@example.test)
```

`PLAYWRIGHT_CHROMIUM_PATH` points Playwright at a system Chromium when its own browser is not
installed.
