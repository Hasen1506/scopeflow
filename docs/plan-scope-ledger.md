# Plan: Scope Ledger (structured scopes → change orders → scope checks)

Working branch: `claude/confident-mayer-wh38uo`. This file is the source of truth for
this effort. Update the status checkboxes and the log at the bottom after every
phase so work can resume after a context reset.

## Why

A form, a link and an approve button are trivially cloned. Scope creep happens
*after* approval, and today Scopeflow stops at approval. The defensible core is a
correct model of an agreement over time:

baseline (approved version) + change orders + consumed revision rounds +
client-side delays + absorbed goodwill = the current agreement, with a record the
client can check.

## Design decisions (do not re-litigate)

1. **Backwards compatible content.** `scopeSchema` gains optional `items` and
   `client_inputs`. Old API/MCP clients that send only `deliverables` keep working
   and their stored content is unchanged. When `items` is present the server
   rewrites `deliverables` from the items so both stay consistent.
   `itemsOf(scope)` derives items from `deliverables` lines for legacy content.
2. **Item IDs are stable across versions** (editor generates `i_xxxxxx`, preserves
   on edit). Semantic diff matches by id, then by title.
3. **Versions remain the negotiation phase; the ledger is the execution phase.**
   The baseline is the latest version when it is approved. Ledger entries carry
   `baseline_version`; entries for an older baseline are history only.
4. **The ledger is append-only and event sourced.** Table `ledger_entries`; rows
   are never updated. A change-order decision or withdrawal is its own entry with
   `ref = 'settle:<seq>'` and a unique `(project_id, ref)` index, so a change
   order is settled at most once. Status is folded by `computeAgreement()`.
5. **Hash chain.** Each entry stores `prev_hash` and
   `hash = sha256(prev_hash + canonical entry)`. The genesis hash is
   derived from the approved baseline (project, version, canonical content,
   decision). The review page recomputes the chain in the client's browser.
6. **Clients act on change orders through the review link they already have**
   (the baseline version's token). No new secret to share. Decisions reuse the
   existing `review:<version id>` rate-limit key (covered by account deletion).
7. **The scope check is honest.** In-app quick check is a deterministic heuristic
   labelled as such. The MCP tools give the user's own agent the structured
   baseline (item ids, exclusion clause ids) to make the real judgment, keeping
   Scopeflow free of model costs (see pricing-economics.md).
8. **New code is readable** (normal formatting, separate files). Existing dense
   files get minimal edits only.

## Phases

### Phase 0 — Setup ✅
- [x] Install deps, run dev server, apply local migrations (`scripts/dev-migrate.mjs`), baseline `tests/core.mjs` green (25/25).

### Phase 1 — Structured line items + semantic diff ✅
- [x] `lib/scope.ts`: `itemSchema` {id, title, qty, unit, price?, acceptance}, `clientInputSchema` {id, title, due}, `itemsOf()`, `canonicalScope()`.
- [x] Server create/revise canonicalize content (deliverables derived from items).
- [x] `lib/diff.ts`: `semanticDiff(prev, next)` → item added/removed/changed (field-level), scalar changes, fee delta.
- [x] Editor: line-item editor component (`app/items-editor.tsx`) + client inputs.
- [x] Paper renders qty/unit/price/acceptance and "Client provides".
- [x] Review page shows semantic diff instead of whole-field before/now.
- [x] MCP + OpenAPI schemas accept optional `items`/`client_inputs`.
- [x] `tests/unit.mjs` for pure libs; core tests still green.

### Phase 2 — Scope linter ✅
- [x] `lib/lint.ts`: vague language, missing quantities/acceptance, priced items ≠ fee, missing category exclusions (website→hosting etc.), no exclusions, unlimited revisions, client inputs without dates. Returns issues + clarity score 0–100.
- [x] Live lint panel in editor (`app/lint-panel.tsx`).
- [x] MCP tool `lint_scope` (no auth, pure).

### Phase 3 — Scope ledger (change orders, rounds, delays, goodwill)
- [ ] Migration: `ledger_entries` (id, project_id, seq, kind, baseline_version, payload, ref, prev_hash, hash, actor, created) + unique (project_id, seq), unique (project_id, ref).
- [ ] `lib/ledger.ts`: payload schemas per kind, `computeAgreement(baseline, entries)`, hashing helpers (isomorphic WebCrypto).
- [ ] API: `GET/POST /api/scopes/[id]/ledger` (owner): change_order, withdraw, goodwill, revision_round, client_input.
- [ ] API: `GET /api/review/[token]` includes ledger + agreement when the version is the approved baseline; `POST /api/review/[token]/change-order` client decision.
- [ ] Workspace ledger panel (`app/ledger-panel.tsx`): current agreement summary, entries timeline, forms; "extra round → change order" prompt when rounds exhausted.
- [ ] Review page: agreement summary + pending change orders to approve/decline + chain verification.
- [ ] Account deletion removes ledger entries; counts include them.
- [ ] `tests/ledger.mjs` integration test.

### Phase 4 — "Is this in scope?"
- [ ] `lib/check.ts`: heuristic classifier → verdict (in_scope | out_of_scope | revision | ambiguous), citations to item ids / exclusion clauses, suggested reply, prefilled change order.
- [ ] Workspace panel (`app/scope-check.tsx`) → "Draft change order from this".
- [ ] MCP tools: `get_agreement` (structured baseline + ledger), `check_request` (heuristic + baseline for the agent), `propose_change_order` (user_confirmed, request_id idempotent).

### Phase 5 — Insights + docs + release
- [ ] `GET /api/insights`: rounds used vs sold, change-order revenue, goodwill absorbed, per-client creep.
- [ ] README, OpenAPI, submission.md tool list, connect page notes, version bump 0.3.0.
- [ ] Full test pass; lint clean for new files; push; draft PR.

## How to resume

```
npm ci                                   # if node_modules missing
npm run dev &                            # http://localhost:5173 (mock sign-in)
node scripts/dev-migrate.mjs             # apply drizzle/*.sql to the local dev D1
node tests/core.mjs && node tests/unit.mjs && node tests/ledger.mjs
npm run typecheck
```
Baseline lint has 17 pre-existing errors in old files; new files must be clean
(`npx eslint <new files>`).

## Log
- Phase 0 done. Baseline core tests 25/25.
- Phase 1 done. Canonicalisation lives in the `scopeSchema` transform, so every write path (API, MCP, WebMCP, import) gets it without route changes. Unit 11/11, core 25/25. Visual check via Playwright (global install at /opt/node-tools/node_modules/playwright).
- Phase 2 done. `lint_scope` is a public MCP tool (`publicTools` in lib/mcp.ts). Exclusions are not scanned for vague words (open-ended exclusions protect the freelancer). Unit 19/19. TODO at release: tests/integration.mjs asserts the MCP tool count (currently 5), so update it once Phase 4 tools land.
