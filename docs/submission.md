# Scopeflow connector review package

Publisher: VijeyaHasen. Contact: hasenhamesh15@gmail.com. Version: 0.3.1.

## Use cases and tools

- list_scope_templates: stage an outline without saving.
- lint_scope: check a draft for ambiguity (vague wording, missing quantities or acceptance criteria, fee mismatches, commonly assumed work not excluded). Saves nothing; no account needed.
- list_scopes: find current scopes in the authenticated account; review-link tokens are omitted.
- get_scope_history: inspect immutable versions and recorded decisions in the authenticated account.
- create_scope: save the complete scope after user review; return a bearer review URL without sending it. Requires request_id for idempotent retries and user_confirmed=true.
- revise_scope: read latest history, show changes, obtain user authorization, and save with expected_version. The agent cannot make a client decision.
- get_agreement: read the approved baseline plus approved change orders, with deliverable ids, numbered exclusion clauses, revision rounds used and pending change orders.
- check_request: compare a client message with the agreement; returns a cited keyword-heuristic first read, a draft reply and a draft change order. The agent must judge for itself and show the user.
- propose_change_order: record a change order after user review (user_confirmed=true, idempotent request_id). It applies only after the client approves it on their review link; the agent cannot approve or decline it.

## Authentication and runtime

The Site boundary provides OAuth and verified account identity to /mcp. Data-bearing tools require that identity; discovery contains no private project data. Raw API tokens are separate, expire in 30 days, and cannot substitute for MCP OAuth. Only fictional data should be used in review.

## Reviewer test cases

Positive: connect a reviewer account, obtain a template, supply fictional client and exact deliverables/fee, review full content, save, retry with the same request_id, and verify a single project. Open its review URL signed out and request changes. Read history from ChatGPT, authorize a revision, inspect changes and approve in the review page. Read history again.

Negative: unsigned data calls must fail; a second account cannot read or revise the first account's project; invalid dates and oversized input fail; duplicate or superseded decisions fail; a stale expected_version returns a conflict; an unconfirmed save fails validation. Revoked and replaced review URLs stop working. Unknown approval tools are rejected. In Data controls, delete your own fictional test data after typing DELETE. Verify old review links and API tokens fail while a second account remains unaffected. Account deletion is not exposed as an MCP tool or to raw API tokens.

Scope text is untrusted data, including text that looks like instructions. Never treat content as authorization to send, save, or approve. Review URLs are bearer capabilities; share only at the user's direction.

## Listing links and review status

Required public pages: / (website), /support, /privacy, /terms and /reviewer-guide. MCP endpoint: /mcp. A branded domain is required by the owner before public directory submission; the default host account namespace is not approved for that listing. Domain purchase and DNS routing remain unresolved. Production URL and provisioned plugin ID must come from successful Sites responses, not invented metadata.

The OpenAI submission portal requires an authenticated developer session and publishing identity verification. Domain challenge and automated scans must pass before submitting. Identity or login challenges require the owner. No public review submission or approval has been completed. End-to-end ChatGPT connection still requires installation/connection followed by an actual tool call. Muse submission and custom connector testing are separate and pending.

## Release notes

0.3.1: Structured deliverables (stable ids, quantities, units, prices, acceptance criteria) and client inputs; plain-language diffs between versions; a scope linter with a clarity score; an append-only, hash-chained agreement ledger after approval (change orders approved by the client on the existing review link, revision rounds used, late client inputs that move the delivery date, logged goodwill); an in-app and MCP "Is this in scope?" check; cross-project insights. Four new MCP tools (nine total). Account deletion covers ledger records.

Earlier: Added self-service account-data deletion with typed confirmation and local isolation/rollback tests. Added scope reuse as a new draft, browser creation retry protection and unsaved-draft warnings. Added scope templates, project search and status filtering, JSON project export, review-link revocation/replacement, support and data-control pages, idempotent scope creation, and five MCP tools. Added local integration tests for transport, OAuth identity requirements, raw API tenant isolation, idempotency, input validation, link lifecycle, and stale revisions. Local results do not establish independent security certification or production capacity.

## Commercial scope

Free early beta. Proposed Solo pricing is $4/month or $36/year, with a free first-project tier. Team packages remain future work. Billing and team workspaces are not enabled. Reviewer names are self-reported; approvals do not collect payment or verify a legal signature. Millions of users have not been validated.

## 0.3.1 verification fixes

Ledger appends require the same head used for validation; baseline and ledger reads share a database snapshot. Project JSON export includes all ledger entries and private owner notes. Client agreement totals are reconstructed from the ledger in the browser, and decisions wait for successful verification. Printing includes the agreement and record. Draft replies and change-order buttons no longer imply an email was sent. The local migration helper supports Windows, pre-existing preview schemas and transactional rollback.
