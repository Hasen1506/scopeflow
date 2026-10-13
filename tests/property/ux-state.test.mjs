// UX code critique, UI state bugs: the pure rules behind the Qty field (UX-C37) and the Payment step's
// state (UX-C20), plus CSS guards for the controls that had no rule (UX-C59, UX-C50, UX-C16). Seeded, no network.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fc} from '../support/property.mjs';

const {parseQty, QTY_MAX} = await import('../../lib/editor.ts');
const {paymentPanelState} = await import('../../lib/ledger.ts');
const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('UX-C37: an empty or non-numeric Qty is "not yet typed", not 1', () => {
  assert.equal(parseQty(''), null);
  assert.equal(parseQty('  '), null);
  assert.equal(parseQty('abc'), null);
  assert.equal(parseQty('3'), 3);
  assert.equal(parseQty('0'), 1);
  assert.equal(parseQty('-4'), 1);
  assert.equal(parseQty('2.6'), 3);
  assert.equal(parseQty('99999'), QTY_MAX);
});

test('UX-C37: any typed number becomes a whole quantity in [1, QTY_MAX]', () => {
  fc.assert(fc.property(fc.double({noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6}), n => {
    const q = parseQty(String(n));
    assert.ok(Number.isInteger(q) && q >= 1 && q <= QTY_MAX, String(n));
  }));
});

test('UX-C20: an approved version never shows the "until approval" quote while the ledger loads or fails', () => {
  assert.equal(paymentPanelState({approved: false, loaded: false, agreement: false, error: ''}), 'quote');
  assert.equal(paymentPanelState({approved: false, loaded: false, agreement: false, error: 'boom'}), 'quote');
  assert.equal(paymentPanelState({approved: true, loaded: false, agreement: false, error: ''}), 'loading');
  assert.equal(paymentPanelState({approved: true, loaded: false, agreement: false, error: 'Network down'}), 'error');
  assert.equal(paymentPanelState({approved: true, loaded: true, agreement: true, error: ''}), 'agreement');
  assert.equal(paymentPanelState({approved: true, loaded: true, agreement: false, error: ''}), 'quote');
});

test('UX-C59 / C50 / C16: radio rows, the revision bank row and signer chips have their own rules', () => {
  assert.match(css, /\.radio-row\{display:flex/);
  assert.match(css, /\.radio-row input\{width:auto/);
  assert.match(css, /input\[type=radio\]/);
  assert.match(css, /\.bank-row\{grid-template-columns:140px 1fr 1fr 34px\}/);
  assert.match(css, /\.cosign-list \.tag\{white-space:normal/);
});
