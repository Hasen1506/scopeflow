/** Pure debounce & scheduling rules for Account page auto-save ('Your wording' and 'Business details'). */
export const ACCOUNT_AUTOSAVE_DEBOUNCE_MS = 2000;

export type AutoSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export function shouldScheduleAutoSave(input: {
  dirty: boolean;
  hasData: boolean;
  signedOut: boolean;
  checking: boolean;
  blocked?: boolean;
}): boolean {
  return Boolean(input.dirty && input.hasData && !input.signedOut && !input.checking && !input.blocked);
}

/**
 * Pure debounced scheduler used by Account auto-save and directly unit-tested with fake timers.
 * Resets its 2-second countdown on every call to `schedule()`, cancels cleanly on manual save or unmount.
 */
export function createDebouncedSaver(
  saveFn: () => void | Promise<void>,
  delayMs = ACCOUNT_AUTOSAVE_DEBOUNCE_MS,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void saveFn();
      }, delayMs);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    isPending() {
      return timer !== null;
    },
  };
}
