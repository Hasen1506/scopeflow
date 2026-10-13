// UX round 3: the first load lands on Projects only when the owner has not navigated or edited since it
// began (a "New scope" click during loading used to be bounced to the project list), and the workspace
// state hook stays split into modules. Pure helper and source checks; no browser, no network.
import '../support/fc-setup.mjs';
import {fc} from '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const {navGuard} = await import('../../lib/nav-guard.ts');

test('navGuard: a mark stays unchanged exactly while nothing bumps after it', () => {
  fc.assert(fc.property(fc.nat(20), fc.nat(5), (before, after) => {
    const g = navGuard();
    for (let i = 0; i < before; i++) g.bump();
    const m = g.mark();
    assert.equal(g.unchanged(m), true);
    for (let i = 0; i < after; i++) g.bump();
    assert.equal(g.unchanged(m), after === 0);
  }));
});

test('refresh lands on Projects only if the owner did not navigate or edit meanwhile', () => {
  const state = src('app/workspace/state.tsx');
  // The mark is taken when refresh starts, before /api/me and /api/scopes are awaited.
  assert.match(state, /const refresh=useCallback\(async function refresh\(\)\{const navAt=nav\.current\.mark\(\);/);
  assert.match(state, /if\(!landed\.current\)\{landed\.current=true;if\(!new URLSearchParams\(location\.search\)\.get\('project'\)&&nav\.current\.unchanged\(navAt\)\)setTabState\('home'\);\}/);
  // Every owner tab switch (New scope, opening a project, Projects…) and every draft edit counts.
  assert.match(state, /const setTab=useCallback\(\(t:'home'\|'project'\)=>\{nav\.current\.bump\(\);setTabState\(t\);\},\[\]\);/);
  for (const f of ['function field<K extends keyof Scope>(k:K,value:Scope[K]){nav.current.bump();', 'function setItems(items:Item[]){nav.current.bump();']) assert.ok(state.includes(f), f);
  assert.match(state, /function optional<[^{]*\{nav\.current\.bump\(\);/);
  // newScope goes through the counting setTab, not the raw state setter.
  const fn = state.slice(state.indexOf('async function newScope'), state.indexOf('// Open /?project='));
  assert.ok(fn.includes("setTab('project')") && !fn.includes('setTabState'));
});
