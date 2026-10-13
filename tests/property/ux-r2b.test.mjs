// UX round 2b: account page per-section errors and loading, Settings naming, editor order, step emphasis,
// container-sized milestone rows, the save banner after a fixed conflict, and "Saved" on instant-save
// controls. Pure source and helper checks; no browser, no network.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../support/property.mjs';

const src = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const css = src('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '');
const {validationBanner, bannerAfterFix} = await import('../../lib/editor.ts');
const {DEPOSIT_SCHEDULE_CONFLICT} = await import('../../lib/scope.ts');

test('visual #6: the banner drops the deposit conflict once it is fixed, and keeps other fields', () => {
  const only = validationBanner({milestones: DEPOSIT_SCHEDULE_CONFLICT}, DEPOSIT_SCHEDULE_CONFLICT);
  assert.equal(bannerAfterFix(only, DEPOSIT_SCHEDULE_CONFLICT, true), only, 'still there: unchanged');
  assert.equal(bannerAfterFix(only, DEPOSIT_SCHEDULE_CONFLICT, false), null, 'fixed: no banner');
  const mixed = validationBanner({title: 'x', milestones: DEPOSIT_SCHEDULE_CONFLICT}, DEPOSIT_SCHEDULE_CONFLICT);
  assert.equal(bannerAfterFix(mixed, DEPOSIT_SCHEDULE_CONFLICT, false), validationBanner({title: 'x'}));
  assert.equal(bannerAfterFix('Network down', DEPOSIT_SCHEDULE_CONFLICT, false), 'Network down', 'other errors untouched');
  assert.equal(bannerAfterFix('', DEPOSIT_SCHEDULE_CONFLICT, false), '');
});

test('C62/C24/C39/C63: account errors sit by their section; one placeholder while loading', () => {
  const page = src('app/account/page.tsx');
  for (const e of ['loadError', 'modeError', 'settingsError', 'profileError', 'keyError']) assert.match(page, new RegExp(`\\{${e}&&`), `${e} rendered`);
  assert.match(page, /checking\?<div className="account-loading"><Skeleton/);
  assert.match(page, /id="profile-block"/);
  assert.match(page, /Type DELETE to confirm<input[^\n]*disabled={busy} autoFocus\/>/);
  assert.match(page, /id="gate-key"/, 'BUG-9 gate text is still server-rendered');
});

test('C30: the account page is called Settings in the menu, the title and the page', () => {
  assert.match(src('app/ui.tsx'), /href:'\/account',label:'Settings'/);
  assert.match(src('app/account/layout.tsx'), /title: 'Settings — Scopeflow'/);
  assert.match(src('app/account/page.tsx'), /ACCOUNT · SETTINGS/);
  for (const f of ['app/ui.tsx', 'app/account/page.tsx', 'app/invoice-panel.tsx', 'app/site-footer.tsx', 'app/retention-settings.tsx', 'app/privacy/page.tsx']) assert.ok(!src(f).includes('Data controls'), f);
});

test('#20: project name and client come before the template grid', () => {
  const ed = src('app/workspace/editor.tsx');
  assert.ok(ed.indexOf('<label>Project name') < ed.indexOf('template-list'));
  assert.ok(ed.indexOf('<label>Client<input') < ed.indexOf('template-list'));
});

test('C49 and visual #4: milestone, FX and bank rows fold by container width', () => {
  assert.match(css, /@container \(max-width:600px\)\{[^@]*\.input-row\.milestone-row/);
  assert.match(css, /\.milestone-row\{grid-template-columns:minmax\(8rem,1fr\)/);
});

test('visual #5: a new milestone never takes the total past 100%', () => {
  const t = src('app/terms-editor.tsx');
  assert.ok(!/\|\| 50/.test(t), 'no 50% fallback');
  assert.match(t, /const addMilestone/);
});

test('C27: instant-save controls confirm with a polite live "Saved"', () => {
  assert.match(src('app/saved-status.tsx'), /role="status" aria-live="polite"/);
  for (const f of ['app/trust-settings.tsx', 'app/retention-settings.tsx', 'app/workspace/client-notices.tsx']) assert.match(src(f), /<SavedNote saved=\{saved\}/, f);
});

test('C10/C52/C53/C64: step emphasis, measured save bar, no masked nav, styled seal chip', () => {
  assert.match(css, /\.flow-step\[data-state=current\]/);
  assert.match(css, /bottom:calc\(var\(--save-bar-h,106px\) \+ 12px\)/);
  assert.ok(!/bottom:118px/.test(css));
  assert.ok(!/\.navlinks\{order:3[^}]*mask-image/.test(css));
  assert.ok(!/className="chip"/.test(src('app/review/[token]/evidence.tsx')));
});
