# PDF receipts and public verification

Every decided version has a server-generated PDF receipt.

| Who | Endpoint |
| --- | --- |
| Client (review link) | `GET /api/review/<token>/receipt?tz=<IANA zone>` |
| Owner (session or API token) | `GET /api/scopes/<project>/receipt?version=<n>&tz=<IANA zone>` (latest decided when `version` is omitted) |
| Anyone holding the receipt | `GET /api/verify?p=<project>&v=<version>&a=<record fingerprint>` and the page `/verify?p=…&v=…&a=…` |

The PDF (A4, standard fonts, built by `lib/pdf.ts` with no PDF dependency) carries:

- the decided scope (deliverables, fee, rounds, delivery, client inputs, exclusions, working terms, reviewer comment);
- the decision, the signer's typed name, the acknowledgement, channel, network address, browser and an
  owner-session warning when the creator's own browser submitted it;
- an identity-check line (an email one-time code when the project required one; otherwise "None");
- the content SHA-256, the record fingerprint (anchor), the Ed25519 signature with key id and public key, and the
  ledger head when change orders or other entries exist;
- timestamps in UTC **and** in the requested IANA zone with its offset (the browser's zone by default; invalid
  zones fall back to UTC);
- a QR code with the public verify URL (`APP_URL/verify?p=…&v=…&a=…`).

`/verify` recomputes the record's fingerprint from the stored row and checks the stored signature over it. It
discloses the scope title, client, signer and decision time only to a caller that already holds the 256-bit
fingerprint, and says nothing for a mismatch. It confirms integrity, not identity.

The output is deterministic (no creation date, uncompressed streams), so `tests/golden/receipt-pdf.test.mjs`
checks it byte for byte, decodes the drawn QR code with `jsqr`, and checks the PDF's object offsets.
Characters outside WinAnsi are transliterated (₹ → "Rs.") or shown as "?"; see docs/IDEAS.md for embedding a
Unicode font.
