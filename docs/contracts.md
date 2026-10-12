# Phase 0 contracts

The contracts commit (`hark/ws-00-contracts`) adds the shared types, stubs and slots that let the
ten workstreams build in parallel without editing each other's files. It changes **no behaviour**:
every route answers as before, the OpenAPI document is byte-identical, and every golden in
`tests/golden` and `tests/e2e/__golden__` is unchanged.

| Path | What it is | Owner from now on |
| --- | --- | --- |
| `lib/contracts/*.ts` | Type-only shared types: `Minor`, `GstBreakdown`, `MoneyState`, `Mode`, `NotifyEvent` (+ payload/result). Frozen: changes need every owner's agreement. | integrator |
| `lib/minor.ts` | `exponentOf`, `toMinor`, `fromMinor`, `mulPct`, `sumMinor`. Phase 0 bodies = today's `toMinorUnits`/`fromMinorUnits` (Intl exponent, `Math.round`). | WS-01 |
| `lib/agreement-totals.ts` | `agreementTotals(content, entries)` → fee, heads, tax, total, deposit, milestones in minor units. Phase 0 = today's `totals()`/`schedule()`. | WS-01 |
| `lib/money-ledger.ts` | `moneyState(entries, {baseline_version, currency, total, deposit})`. Phase 0 = today's per-baseline `paymentsOf()` fold. | WS-04 |
| `lib/ledger-hooks.ts` | `appendMoneyEntry()` (= `appendEntry()`), `onBaselineApproved(project, from, to)` (no-op; not yet called). | WS-05 |
| `lib/identity.ts` | `signingStatus()`, `checkDecisionProof()`, `maskAddress()`, `isLinkReadonly()`: today's rules, not yet called by routes. | WS-02 |
| `lib/notify.ts` | `notify(event, payload)`: logs the event name only, sends nothing. | WS-06 |
| `lib/mode.ts` | `currentMode(owner)` (always `freelancer`), `modeDefaults(mode)`. | WS-08 |
| `lib/errors.ts` | `ValidationError`, `Conflict`, `RateLimited`, `Unavailable`, `Forbidden`, `toResponse()`. No route throws them yet. | WS-10 |
| `lib/ledger.ts` | `EntryKind` now also names the planned kinds (`plannedEntryKinds`); `entryKinds` (enabled) is unchanged; `checkEntry()` refuses a planned kind with "This kind of entry is not enabled yet." until its owner adds a payload schema. | WS-05 |
| `lib/scope.ts` | Optional fields `client_country`, `engagement`, `retainer`, `tds`, `msmed`, `language`, `items[].unit_price`, omitted when unset (hashes unchanged). | WS-01 |
| `app/components/slots/*.tsx` | 14 placeholders that render `null`; the header names owner and mounting workstream. | per header |
| `lib/openapi/ws-01.ts … ws-10.ts`, `index.ts`, `types.ts` | Empty fragments, merged after the existing paths and schemas by `app/api/openapi/route.ts`; a duplicate key throws. | each WS its own |
| `tests/run-local.mjs` | Also runs `tests/ws-*.mjs` (alphabetical) after the existing suites. | WS-10 |
| `scripts/check-coverage.mjs`, `tests/coverage-matrix.json` | Report-only `@covers <ID>` scan against the 126 matrix items (`node scripts/check-coverage.mjs [--json]`). | WS-10 |

No migration files are added (the runner checksums applied migrations).
`tests/property/ws-00-contracts.test.mjs` checks all of the above (pure, part of `npm run test:props`).
