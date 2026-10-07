# Money, terms and time zones

- **Currencies** come from `config/currencies.ts` (ISO 4217 code, formatting locale, name); 29 are offered,
  including the original USD/INR/GBP/EUR (never remove a code that saved scopes use). Amounts are formatted in
  each currency's own locale by `formatMoney` (`lib/currency.ts`): INR uses lakh grouping (₹1,80,000.00), JPY has
  no minor unit. The insights panel and the items editor no longer hardcode `en-US`.
- **Terms in the signed content** (all optional, omitted when unset so older content keeps its exact hash):
  `tax_label` (e.g. GST, VAT), `tax_pct` (added to the fee), `deposit_pct` (of the tax-inclusive total, due on
  signature), `payment_terms` (free text). The scope paper shows tax, total, deposit and terms; MCP and OpenAPI
  schemas list them. Lint adds `deposit-no-terms` and `tax-no-label`.
- **Fee vs items**: `feeCheck` (`lib/money.ts`) compares item prices with the fee and the editor shows the
  mismatch inline (under / over / partially priced) with a "Use itemised total" action.
- **Project time zone**: owner-set IANA zone (`PATCH /api/scopes/<id> {"timezone": "Asia/Kolkata"}`, set to the
  browser's zone when a project is created). The review page receives `time_zone`; every timestamp in the
  workspace history, ledger timeline, review page and client agreement is shown with its offset, e.g.
  "7 Oct 2026, 14:30 GMT+5:30" (UTC when unset).
