'use client';
// Slot: PayBlock. Owner: WS-04 (implements it). Mounted by: WS-07 (client page).
// How the client pays: UPI QR / pay link / checkout, no operator custody.
// Phase 0 placeholder: renders nothing, so mounting it changes no page. The owner replaces the
// props type and the body; the file path and the default export name stay.

export type PayBlockProps = Record<string, unknown>;

export default function PayBlock(_props: PayBlockProps) {
  return null;
}
