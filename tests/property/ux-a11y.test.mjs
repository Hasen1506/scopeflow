// UX code critique, accessibility and QoL: field-error linkage (UX-C36), in-app dialogs instead of native
// prompt/confirm (UX-C41), a clarity check that announces only a change of verdict (UX-C42), single-key shortcuts
// that can be turned off (UX-C45), focus that follows forms (UX-C46) and the move-button focus rule (UX-C44).
// Pure rules plus source guards. Seeded, no network.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fc} from '../support/property.mjs';

const a11y = await import('../../lib/a11y.ts');
const src = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('UX-C36: errorId is a stable, valid id; describedBy keeps only the messages on screen', () => {
  assert.equal(a11y.errorId('title'), 'err-title');
  assert.equal(a11y.errorId('price-i 1/x'), 'err-price-i-1-x');
  fc.assert(fc.property(fc.string(), s => { const id = a11y.errorId(s); assert.match(id, /^err-[A-Za-z0-9_-]*$/); assert.equal(id, a11y.errorId(s)); }));
  assert.equal(a11y.describedBy(false, null, undefined, ''), undefined);
  assert.equal(a11y.describedBy('err-fee', false, 'fee-note'), 'err-fee fee-note');
  assert.equal(a11y.describedBy('a', 'a'), 'a');
});

test('UX-C36: editor inputs point at their error text and inline errors no longer interrupt (no role=alert)', () => {
  const editor = src('app/workspace/editor.tsx'), items = src('app/items-editor.tsx');
  for (const f of ['title', 'client', 'fee', 'revisions', 'client_email']) {
    assert.ok(editor.includes(`errorId('${f}')`), `${f} error has an id`);
  }
  assert.ok(!/className="error-text" role="alert"/.test(editor), 'editor field errors are plain text');
  assert.ok(!/className="error-text" role="alert"/.test(items), 'item price errors are plain text');
  assert.ok(items.includes("aria-describedby={describedBy(!!amountProblem(item.price, currency) && errorId('price-' + item.id))}"));
});

test('UX-C42: the clarity check speaks the verdict only, and only when it changes', () => {
  assert.equal(a11y.clarityVerdict('mostly clear'), 'Clarity check: mostly clear.');
  assert.equal(a11y.shouldAnnounce(null, 'Clarity check: clear.'), true);
  assert.equal(a11y.shouldAnnounce('Clarity check: clear.', 'Clarity check: clear.'), false);
  assert.equal(a11y.shouldAnnounce('x', ''), false);
  // Whatever sequence of settled verdicts arrives, nothing is announced twice in a row.
  fc.assert(fc.property(fc.array(fc.constantFrom('clear', 'mostly clear', 'vague'), {maxLength: 30}), grades => {
    let last = a11y.clarityVerdict('clear'); const spoken = [];
    for (const g of grades) { const m = a11y.clarityVerdict(g); if (a11y.shouldAnnounce(last, m)) { spoken.push(m); last = m; } }
    for (let i = 1; i < spoken.length; i++) assert.notEqual(spoken[i], spoken[i - 1]);
  }));
  const lint = src('app/lint-panel.tsx');
  assert.ok(!lint.includes('aria-live'), 'the lint panel is not a live region');
  assert.ok(lint.includes('<SettledStatus'), 'verdict announced through the settled status line');
  assert.ok(!/role="status">Adds up to/.test(src('app/terms-editor.tsx')), 'milestone sum is not a live region');
  assert.ok(!/warn-text" role="status"/.test(src('app/workspace/editor.tsx')), 'fee warning is not a live region');
});

test('UX-C45: single-key shortcuts can be turned off and never fire in fields, dialogs or with modifiers', () => {
  assert.equal(a11y.shortcutsEnabled(null), true);
  assert.equal(a11y.shortcutsEnabled('off'), false);
  const base = {key: 'n', inField: false, overlayOpen: false, enabled: true};
  assert.equal(a11y.singleKeyShortcutAllowed(base), true);
  assert.equal(a11y.singleKeyShortcutAllowed({...base, enabled: false}), false);
  assert.equal(a11y.singleKeyShortcutAllowed({...base, inField: true}), false);
  assert.equal(a11y.singleKeyShortcutAllowed({...base, overlayOpen: true}), false);
  assert.equal(a11y.singleKeyShortcutAllowed({...base, ctrlKey: true}), false);
  assert.equal(a11y.singleKeyShortcutAllowed({...base, key: 'x'}), false);
  fc.assert(fc.property(fc.constantFrom('n', 'p', '/', '?', '1', '2', '3', '4'), fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(), (key, enabled, inField, overlayOpen, mod) => {
    const ok = a11y.singleKeyShortcutAllowed({key, enabled, inField, overlayOpen, altKey: mod});
    assert.equal(ok, enabled && !inField && !overlayOpen && !mod);
  }));
  const shell = src('app/workspace/shell.tsx');
  assert.ok(shell.includes('setShortcutsOn(e.target.checked)'), 'the shortcuts dialog has an on/off switch');
  assert.ok(src('app/workspace/state.tsx').includes('singleKeyShortcutAllowed('), 'the key handler uses the rule');
});

test('UX-C41: credit-note reason, CO withdrawal, discard, period close and template delete use in-app dialogs', () => {
  for (const f of ['app/invoice-panel.tsx', 'app/ledger-panel.tsx', 'app/retainer-panel.tsx']) {
    assert.ok(!/window\.(prompt|confirm)\(/.test(src(f)), `${f} has no native prompt/confirm`);
  }
  assert.ok(!/deleteTemplate\(t:Tpl\)\{if\(t\.builtin\|\|!window\.confirm/.test(src('app/workspace/state.tsx')), 'template delete is not window.confirm');
  assert.equal(a11y.creditReasonProblem(''), 'Give a reason. It is printed on the credit note.');
  assert.equal(a11y.creditReasonProblem('  ab '), 'Use at least 3 characters.');
  assert.equal(a11y.creditReasonProblem('Wrong milestone'), null);
  assert.equal(a11y.creditReasonProblem('x'.repeat(301)), 'Use at most 300 characters.');
  fc.assert(fc.property(fc.string({maxLength: 320}), r => {
    const t = r.trim().length;
    assert.equal(a11y.creditReasonProblem(r) === null, t >= a11y.CREDIT_REASON_MIN && t <= a11y.CREDIT_REASON_MAX);
  }));
});

test('UX-C44: after a move, focus goes to an enabled move button of the moved row', () => {
  fc.assert(fc.property(fc.integer({min: 2, max: 30}), fc.nat(), fc.boolean(), (length, raw, up) => {
    const to = raw % length, target = a11y.moveFocusTarget(to, length, up ? 'up' : 'down');
    const disabled = target === 'up' ? to === 0 : to === length - 1;
    assert.equal(disabled, false, `${length}/${to}/${up}`);
  }));
  assert.equal(a11y.moveFocusTarget(0, 4, 'up'), 'down');
  assert.equal(a11y.moveFocusTarget(1, 4, 'up'), 'up');
  assert.equal(a11y.moveFocusTarget(3, 4, 'down'), 'up');
});

test('UX-C46: ledger and invoice forms take focus when they open and give it back when they close', () => {
  const ledger = src('app/ledger-panel.tsx'), invoice = src('app/invoice-panel.tsx');
  assert.ok(ledger.includes('focusFirstField(formArea.current)'));
  assert.ok(ledger.includes('restoreFocus(opener.current'));
  assert.ok(invoice.includes('focusFirstField(formRef.current)'));
  assert.ok(invoice.includes('restoreFocus(opener.current'));
  assert.match(a11y.FIRST_FIELD_SELECTOR, /input:not\(\[type=hidden\]\)/);
});
