import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_AUTOSAVE_DEBOUNCE_MS,
  createDebouncedSaver,
  shouldScheduleAutoSave,
} from './account-autosave';

describe('account auto-save debounce (2s)', () => {
  it('uses a 2000ms debounce interval', () => {
    assert.equal(ACCOUNT_AUTOSAVE_DEBOUNCE_MS, 2000);
  });

  it('schedules only when dirty, signed in, loaded, and unblocked', () => {
    assert.equal(
      shouldScheduleAutoSave({ dirty: true, hasData: true, signedOut: false, checking: false, blocked: false }),
      true,
    );
    assert.equal(
      shouldScheduleAutoSave({ dirty: false, hasData: true, signedOut: false, checking: false, blocked: false }),
      false,
    );
    assert.equal(
      shouldScheduleAutoSave({ dirty: true, hasData: true, signedOut: true, checking: false, blocked: false }),
      false,
    );
    assert.equal(
      shouldScheduleAutoSave({ dirty: true, hasData: true, signedOut: false, checking: true, blocked: false }),
      false,
    );
    assert.equal(
      shouldScheduleAutoSave({ dirty: true, hasData: true, signedOut: false, checking: false, blocked: true }),
      false,
    );
  });

  it('debounces rapid keystrokes and fires once 2s after the final edit', async () => {
    let calls = 0;
    const saver = createDebouncedSaver(() => {
      calls++;
    }, 60);

    saver.schedule();
    await new Promise((r) => setTimeout(r, 30));
    saver.schedule();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(calls, 0, 'Must not fire before debounce settles');
    assert.equal(saver.isPending(), true);

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls, 1, 'Fires exactly once after debounce interval');
    assert.equal(saver.isPending(), false);
  });

  it('cancels pending auto-save cleanly on manual save or unmount', async () => {
    let calls = 0;
    const saver = createDebouncedSaver(() => {
      calls++;
    }, 50);

    saver.schedule();
    assert.equal(saver.isPending(), true);
    saver.cancel();
    assert.equal(saver.isPending(), false);
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(calls, 0);
  });
});
