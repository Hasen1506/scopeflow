# Scope-creep radar

`POST /api/scopes/<id>/radar {"message": "<client request>"}` (owner, session or API token) checks a request
against the current agreement (approved baseline + approved change orders), or the latest version before
approval, and records nothing.

- The agreement is numbered into clauses: **D** deliverables, **X** exclusions, **T** working-term sentences,
  **R1** the revision allowance (`clausesOf`, `lib/radar.ts`).
- **Keyword baseline** (always): the existing explainable checker (`lib/check.ts`) plus clause citations, e.g.
  "Could you also print the business cards?" → not covered, cites `X3 printed business cards`.
- **LLM adjudicator** (when `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is set): the model sees only the numbered
  clauses and must cite ids that exist; an answer that cites unknown clauses, or any provider failure, is
  discarded and the keyword verdict stands, with a note. The keyword verdict is mentioned when they disagree.
- **One-click change order**: the result carries a change-order draft (extra quantity of an existing deliverable,
  a new item, or an extra revision round) that the ledger accepts as-is; the workspace button opens it in the
  change-order form for review before anything reaches the client.
- MCP `check_request` now returns the same clause citations.
