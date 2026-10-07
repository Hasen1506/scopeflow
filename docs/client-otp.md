# Client email one-time code before signing

Owner setting per project (`PATCH /api/scopes/<id>` with `{"require_otp": true}`, or the checkbox under
Client email in the workspace). It needs a client email on the project and a way to deliver codes.

Flow on the review link:

1. `GET /api/review/<token>` returns `identity_check: {method: "email_otp", to: "a******@example.com"}` (masked).
2. `POST /api/review/<token>/otp {"action":"send"}` emails a 6-digit code to the project's client email (never an
   address the reviewer types). 3 sends per 10 minutes per version.
3. `POST /api/review/<token>/otp {"action":"verify","code":"123456"}` returns a one-time `otp_session`.
   Codes expire after 10 minutes, allow 5 attempts, and are stored only as salted SHA-256 hashes.
4. The decision `POST /api/review/<token>` must include `otp_session` (30-minute window) or it is refused
   with 403 `otp_required`.

What is recorded: `decision_context.identity = {method, email, verified_at, otp_id}` and
`decision_context.identity_signature`, an Ed25519 signature over
`scopeflow-evidence-v1:<anchor>:<sha256(JSON {method,email,verified_at,otp_id})>`. The decision anchor format is
unchanged, so every existing receipt still verifies; the evidence is bound to the same anchor by its own
signature, and is immutable with the rest of the decision (database trigger). The client's receipt includes
`identity` and `identity_signature` when the check was used.

Delivery: Resend (`RESEND_API_KEY`, `SCOPEFLOW_MAIL_FROM`). Without them the setting cannot be turned on, except
in local dev mode: `SCOPEFLOW_OTP_DEV=1` (refused unless `APP_URL` is localhost) logs codes instead of emailing
them, and `SCOPEFLOW_OTP_DEV_LOG=<file>` also appends them to a file, which CI uses for `tests/otp.mjs`.
