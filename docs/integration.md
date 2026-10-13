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
