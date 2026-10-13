// Small, pure accessibility rules shared by the workspace UI (UX code critique C36, C41, C42, C45).
// Kept free of React so the property tests can exercise them directly.

/** UX-C36: a stable id for a field's error message, so the input can point at it with aria-describedby. */
export function errorId(field: string): string {
  return 'err-' + field.replace(/[^A-Za-z0-9_-]+/g, '-');
}

/** UX-C36: the aria-describedby value for an input: only the ids whose message is on screen, or undefined. */
export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const out = ids.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return out.length ? [...new Set(out)].join(' ') : undefined;
}

/**
 * UX-C42: what the clarity check announces. Only the verdict (the grade) is spoken; the score moves on every
 * keystroke and would make screen readers re-read the panel while the owner types.
 */
export function clarityVerdict(grade: string): string {
  return `Clarity check: ${grade}.`;
}

/**
 * UX-C42: whether a settled message should be announced. A live region speaks whenever its text changes, so the
 * caller only hands it a new message when the settled value differs from the last one announced.
 */
export function shouldAnnounce(lastAnnounced: string | null, settled: string): boolean {
  return settled.length > 0 && settled !== lastAnnounced;
}

/** UX-C45: single-key shortcuts (N, P, /, ?, 1–4) can be turned off; the choice is kept in this browser. */
export const SHORTCUTS_KEY = 'scopeflow:shortcuts';
export function shortcutsEnabled(stored: string | null | undefined): boolean {
  return stored !== 'off';
}

/**
 * UX-C45: whether a single-character key press may run a workspace shortcut. Never while typing in a field, with a
 * modifier held, while a dialog or menu is open, or when the owner turned shortcuts off.
 */
export function singleKeyShortcutAllowed(e: {key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; inField: boolean; overlayOpen: boolean; enabled: boolean}): boolean {
  if (!e.enabled || e.inField || e.overlayOpen) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key === '/' || e.key === '?' || e.key === 'n' || e.key === 'p' || /^[1-4]$/.test(e.key);
}

/** UX-C41: the credit-note reason is printed on a legal document; the server accepts 3–300 characters. */
export const CREDIT_REASON_MIN = 3;
export const CREDIT_REASON_MAX = 300;
export function creditReasonProblem(reason: string): string | null {
  const r = reason.trim();
  if (!r) return 'Give a reason. It is printed on the credit note.';
  if (r.length < CREDIT_REASON_MIN) return `Use at least ${CREDIT_REASON_MIN} characters.`;
  if (r.length > CREDIT_REASON_MAX) return `Use at most ${CREDIT_REASON_MAX} characters.`;
  return null;
}

/** UX-C46: the first field to focus when a form opens (by tag and type), skipping hidden and disabled ones. */
export const FIRST_FIELD_SELECTOR = 'input:not([type=hidden]):not([disabled]),textarea:not([disabled]),select:not([disabled])';

/**
 * UX-C44: which move button of a moved row should hold focus. The pressed direction, unless the row is now at that
 * end of the list (that button is disabled there), then the other one; a single row keeps neither.
 */
export function moveFocusTarget(to: number, length: number, dir: 'up' | 'down'): 'up' | 'down' {
  if (dir === 'up') return to === 0 && length > 1 ? 'down' : 'up';
  return to === length - 1 && length > 1 ? 'up' : 'down';
}
