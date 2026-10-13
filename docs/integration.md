# Integration branch: WS-01..WS-09 + WS-10

Branch `hark/integration`, cut from `hark/ws-00-contracts`. Each workstream branch was merged with `--no-ff`, in this order:
WS-01 money core, WS-10 platform ops, WS-02 trust/identity, WS-05 ledger/retainers, WS-04 payments, WS-03 invoicing/compliance,
WS-06 messaging/capture, WS-08 modes/onboarding, WS-07 client page, WS-09 workspace shell.

Rule used for every conflict: keep both sides' behaviour (union of tests, exemptions, exports and routes). Migrations stay as separate
files (0015..0024; 0023 is unused and 0022a belongs to WS-08). Where two sides touched the same slot component, the owning WS's real
implementation wins over the Phase 0 placeholder. No feature or test was dropped. Do not merge this branch yet.

## Conflicts and how they were resolved

WS-01, WS-10 and WS-02 merged without conflicts.

| Merge | File | Resolution |
|---|---|---|
| WS-05 | `tests/property/ws-00-contracts.test.mjs` (OpenAPI fragments) | Kept WS-10's general form ("every fragment is a `{paths, schemas}` object; base keys stay first"). It also covers WS-05's filled fragment (index 4). WS-05's "all but index 4 empty" check no longer holds once other owners fill theirs. |
| WS-05 | same file (slot placeholders) | Implemented-slot set = union of WS-02 (`cosigner-editor`, `contact-change`) and WS-05 (`co-card`, `retainer-counter`, `rate-card-picker`). |
| WS-04 | `tests/property/ws-00-contracts.test.mjs` | Took WS-04's `*.tsx`-only directory listing (slots may have a colocated `.module.css`). Added `pay-block` and `payment-settings` to the union. Implemented slots must still export a default function; the others must still render null. |
| WS-04 | `tests/support/auth-service.mjs` | `trustedOrigins` = union of the configurable `appOrigin` (HEAD), `http://localhost:5173`, and WS-04's provider server `http://localhost:5734`. |
| WS-03 | `tests/property/ws-00-contracts.test.mjs` | WS-03 detected a "Phase 0 placeholder" comment instead of listing implemented slots. Folded this into the explicit union (`tds-field`, `msmed-terms`), with the same assertions. |
| WS-06 | `tests/property/ws-00-contracts.test.mjs` | Added `whatsapp-share` to the union. |
| WS-08 | `tests/property/ws-00-contracts.test.mjs` | Added `timezone-select` to the union. WS-08 carries WS-03's version of the hunk, resolved the same way. |
| WS-07 | `tests/property/ws-00-contracts.test.mjs` | Fragment check takes WS-07's stricter form (object and not an array). Added `data-notice` and `language-picker` to the union. |
| WS-07 | `tests/e2e/golden-flow.spec.ts` | After the creator deletes their account and the client reloads, WS-07 expected its LT-10 link-problem page. That was WS-07's rewrite of the old "link not found" assertion. WS-08 (H10) already replaced it: the decided record stays readable (the API returns 200). Kept the HEAD/WS-08 assertion (no raw `.error[role=alert]`) and added a comment explaining why. **Check in CI e2e.** |
| WS-09 | `tests/property/ws-00-contracts.test.mjs` | Folded WS-09's separate `IMPLEMENTED` set (`theme-switcher`) into the union. All 14 slots are now implemented. |

## Type fixes from the combination (`// integration:`)

- `app/review/[token]/agreement.tsx`: `ClientLedger.retainer` was `unknown`, which matched the placeholder's `Record<string, unknown>`
  props. WS-05's real `RetainerCounter` needs `RetainerView`, so the field is now `RetainerView | null` (type-only import from `@/lib/retainer`).
  This fixed the one TS2739 error. `npm run typecheck` now passes.

## Test fixes from the combination

- `tests/property/ws-07-client-money.test.mjs` (LT-01): WS-01 heads now carry `name` next to `label`, so the expected head is
  `{name: 'GST', label: 'GST', rate: 18, amount: 585009}`.

## Local verification (per RESUME_RULES)

- `npm run typecheck` passes.
- `node --test tests/property tests/golden tests/differential`: 374 tests, all pass after the fix above.
- eslint is clean on the changed files.
- `next build`, e2e and server suites were not run locally. GitHub Actions CI on the draft PR verifies them.

## Step 2: e2e fixes on the combined branch

CI on 92f093b failed 13 e2e tests. Every one passed on its own WS branch, so each was caused by combining branches.

- **Client page change-order cards (WS-05 × WS-07).** WS-05 shipped `CoCard`. On WS-07's client page it was mounted through
  `SlotOr`, which renders the page's own card first and then swaps in CoCard after the first paint. That swap detached
  the form under the test ("element was detached"). CoCard also has none of the page's contracts: no `#co-N.change-order`
  anchors, no `co-impact` lines (M7), no translations, and lowercase status ("approved", where tests expect "Approved").
  `agreement.tsx` now renders the page's translated pending and decided cards directly. The pending card sends WS-05's
  H17 proof: `acknowledged: true` and `co_sha256 = coSha256(co, scope.content)`, the same hash CoCard sends and the
  route checks (409 `co_changed`). It sends the proof when the reviewer ticked the review box. A decline without the tick
  goes in the pre-WS-05 shape, which the route still accepts.
  **Left over:** under `SCOPEFLOW_CO_PROOF=strict`, an un-ticked decline would get a 400. Before turning strict on, make the
  tick required for declines too, or merge CoCard's client mode into the page card. CoCard stays in use for the owner
  workspace (WS-09).
- **One seal chip (WS-02 × WS-07).** WS-02's `EvidenceBlock` showed its server chip ("Verified · sealed by ScopeFlow").
  The agreement view showed the chip it verifies in the browser ("Verified · sealed by Scopeflow"). That made two chips,
  and the tests failed on a strict-mode error. The page keeps WS-02's `EvidenceBlock` as its one evidence block: seal line,
  the honest C5 line ("Approved by whoever held this link, code-verified to a masked address"), code-to, fingerprint and
  verify link. When the agreement view is on the page, `EvidenceBlock` leaves out its chip (`sealShown`).
- **Data notice (WS-07 × WS-08).** WS-08's `/api/account/notice/<token>` always serves `retention_days`, plus `data_notice`,
  an English summary of the same facts. DataNotice already states those facts, translated, from `retention_days`, so
  the client page no longer shows the endpoint's `data_notice` line. A `data_notice` in the review payload itself is
  still shown. M32 now checks the honest "kept while the creator keeps this project" line with the notice endpoint
  returning 404. It then checks the real WS-08 wiring ("kept for N days, then removed", shown once).
- **Tests.** `ws-03-invoicing` and `ws-all-live-scenarios` (businessProfile) now use the valid checksum GSTIN `33ABCDE1234F1Z7` (WS-08 LT-17). `…F1Z5` fails the check
  character. `ws-05-ledger` now expects the WS-07 §6.1 chip wording "Verified · sealed by Scopeflow" (it was "Verified in your browser").
- **LT-13 golden.** `tests/golden/ws-07-client-copy.golden.txt` was regenerated from CI output. The new copy is intended:
  the WS-08 retention period now appears in the notice, and the repeated server line is gone.
- **Golden export (golden-flow).** The client's settle entry now carries the H17 proof (`acknowledged`, `co_sha256` and
  `total_incl_tax_minor`), so `tests/e2e/__golden__/export.json` was updated to match. The hash is deterministic because
  the golden flow seeds its ids.
- **ws-all-live-scenarios #2.** This test was written in WS-09 and first ran once every WS was merged. Its CO-2 decline
  now fills in a reason, which both the WS-07 card and CoCard require.
- **Overview paid after a supersede (WS-04 × WS-05).** `/api/overview` counted payments only on the current baseline. Under C4
  (WS-04), money belongs to the project, so after a supersede the ₹3,000 paid on v1 showed as 0. The overview's `paid` now
  comes from every ledger entry on the project. The agreement itself still comes from the current version
  (ws-all-live-scenarios #4).
- **ws-all-live-scenarios runs serially.** Each failure hid the tests after it, so this suite surfaced its failures one round at a time.

- Round 5: change-order POST on a revoked/closed link returns 403 link_readonly (resolveReviewToken first), matching the review and OTP routes.
- Round 6: client invoice and statement GETs no longer filter revoked=0, so a revoked/closed link still serves the record (scenario 7).
- Round 7: live scenario 10 checks deposit_due after approval; overview has always reported it only for approved scopes.
- Round 8: contact-change writes the old-address notice to the dev mail log in dev mode even when the WS-06 router reports delivery.
