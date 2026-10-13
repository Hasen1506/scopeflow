// Project stage model behind the Projects home and the project page (pure, no server).
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const {stageOf, baseStage, trackerSteps, nextStep, STAGE_LABEL} = await import('../../lib/stage.ts');

test('each record state maps to one stage', () => {
  assert.equal(stageOf({saved: false}), 'draft');
  assert.equal(stageOf({saved: true, status: 'pending'}), 'awaiting');
  assert.equal(stageOf({saved: true, status: 'pending', revoked: 1}), 'draft', 'no live link: nobody can approve it');
  assert.equal(stageOf({saved: true, status: 'changes_requested'}), 'changes_requested');
  assert.equal(stageOf({saved: true, status: 'approved'}), 'approved');
  assert.equal(stageOf({saved: true, status: 'approved', pendingChanges: 2}), 'change_pending');
  assert.equal(stageOf({saved: true, status: 'approved', archived: '2026-10-08T00:00:00.000Z'}), 'archived');
  assert.equal(baseStage({saved: true, status: 'approved', archived: 'x', pendingChanges: 1}), 'change_pending', 'archive keeps the underlying stage for the tracker');
  assert.equal(stageOf({saved: false, archived: 'x'}), 'draft', 'an unsaved draft is never archived');
});

const input = fc.record({saved: fc.boolean(), status: fc.constantFrom('pending', 'approved', 'changes_requested'), revoked: fc.boolean(), archived: fc.option(fc.constant('2026-10-08'), {nil: null}), pendingChanges: fc.nat(5), client: fc.string({maxLength: 20})});

test('property: the tracker always has the four steps in order, with exactly one place to look', () => {
  fc.assert(fc.property(input, i => {
    const steps = trackerSteps(i);
    assert.deepEqual(steps.map(s => s.id), ['scope', 'approval', 'changes', 'payment']);
    assert.ok(steps.filter(s => s.state === 'current').length <= 1, 'at most one current step');
    assert.ok(steps.some(s => s.state === 'current' || s.state === 'attention'), 'something is always highlighted');
    // Steps are done left to right: nothing after a not-done step is done.
    const firstOpen = steps.findIndex(s => s.state !== 'done');
    if (firstOpen >= 0) assert.ok(steps.slice(firstOpen).every(s => s.state !== 'done'));
    for (const s of steps) assert.ok(s.note.length > 0 && s.note.length <= 24, 'notes stay short enough for a phone');
  }));
});

test('property: every stage has a label and a next step, and it never claims a link was sent', () => {
  fc.assert(fc.property(input, i => {
    const stage = stageOf(i), next = nextStep(i);
    assert.ok(STAGE_LABEL[stage]);
    assert.ok(next.title && next.detail);
    assert.doesNotMatch(next.title + next.detail + STAGE_LABEL[stage], /\bsent\b/i, 'Scopeflow does not know whether a link was delivered');
    if (i.saved && i.archived) assert.equal(next.kind, 'restore');
    if (stage === 'change_pending') assert.equal(next.kind, 'copy_link');
    if (stage === 'changes_requested') assert.equal(next.kind, 'revise');
  }));
});
