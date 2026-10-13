// UX-C28: copy text and report success only once the clipboard write has settled. Resolves false when
// the Clipboard API is missing (non-secure context, older browser) or the write is refused, so the
// caller can show an error instead of a success message that did not happen.
type ClipboardLike = {writeText(text: string): Promise<void>} | undefined | null;

export async function copyText(text: string, clipboard: ClipboardLike = typeof navigator === 'undefined' ? undefined : navigator.clipboard): Promise<boolean> {
  if (!clipboard || typeof clipboard.writeText !== 'function') return false;
  try { await clipboard.writeText(text); return true; } catch { return false; }
}

export const COPY_FAILED = 'Copy failed. Select the text and copy it.';
