# TermsLock — Planned Future Work (Rate-Managed & External Integrations)

Items deliberately saved for a later phase so the core app stays fast, predictable, and free of per-keystroke API burn:

1. **AI Live-Typing Inline Suggestions (Rate-Gated)**
   - Currently, the AI Advisor (`/api/ai/chat`) calls Gemini server-side strictly on user click to keep API costs and latency zero while typing.
   - Real-time drafting clarity checks and 1-click rewrites run 100% locally (`lib/lint.ts`) with zero API cost.
   - Future enhancement: optional debounced AI clause autocomplete (e.g., 1500ms idle debounce, opt-in toggle, per-account daily token budget).

2. **Inbound WhatsApp Reply Auto-Capture & Auto-Sealing**
   - Currently, sending a WhatsApp Soft Confirm (`wa.me`) plus sealing the counterparty's reply & UTR in TermsLock creates a verifiable SHA-256 + Ed25519 evidence record (`/check` & `/verify`), while a TermsLock 1-tap Review Link automatically records timestamped approval + SHA-256 on click.
   - Future enhancement: full WhatsApp Business Cloud API two-way webhook (`/api/whatsapp/webhook`) to automatically ingest and hash a vendor/landlord's reply without manual paste (requires verified Meta Business WABA & approved templates).

3. **Verified Aadhaar eSign / Legally Binding Digital Signatures (Phase 2)**
   - Backend adapter (`lib/esign/leegality.ts`, `lib/pades.ts`, `/api/scopes/[id]/esign`) is already wired and gated on `SCOPEFLOW_ESIGN_PROVIDER=leegality`.
   - Future enhancement: activate live Leegality / Aadhaar eSign ESP credentials + stamp-duty automation for high-value commercial leases and enterprise contracts, keeping 1-tap Review Links + WhatsApp Soft Confirm as the frictionless default for everyday rentals, weddings, and renovations.
