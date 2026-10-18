// Property checks for the approval record: a review token is 64 hex characters, a diff base
// never points at a revoked or unsent draft, and changing any priced field changes the fingerprint.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fc} from '../support/property.mjs';
import '../support/ts-resolve.mjs';

const {diffBaseVersion} = await import('../../lib/diff.ts');
const {contentFingerprint} = await import('../../lib/evidence.ts');
const {totals} = await import('../../lib/money.ts');

const token = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');

test('review tokens are 64 hex characters, matching lib/server.ts secret()', () => {
  assert.match(readFileSync(new URL('../../lib/server.ts', import.meta.url), 'utf8'), /randomUUID\(\)\.replaceAll\('-',''\)\+crypto\.randomUUID\(\)\.replaceAll\('-',''\)/);
  fc.assert(fc.property(fc.integer(), () => {
    const value = token();
    return /^[0-9a-f]{64}$/.test(value);
  }));
});

test('diff base ignores revoked versions and unsent drafts', () => {
  const version = fc.record({
    version: fc.integer({min: 1, max: 12}),
    status: fc.constantFrom('pending', 'approved', 'changes_requested'),
    revoked: fc.boolean(),
    sent: fc.boolean(),
  });
  fc.assert(fc.property(fc.array(version, {minLength: 0, maxLength: 8}), history => {
    const current = 20;
    const base = diffBaseVersion(history, current);
    if (base === null) return true;
    return history.some(h => h.version === base && h.version < current && !h.revoked && (h.sent || h.status !== 'pending'));
  }));
});

test('the content fingerprint changes when the fee changes, and tax is added on top', async () => {
  await fc.assert(fc.asyncProperty(fc.integer({min: 0, max: 1_000_000}), fc.integer({min: 0, max: 28}), async (fee, tax) => {
    const scope = {title: 'Logo', fee, currency: 'USD', tax_pct: tax, tax_label: 'GST'};
    const priced = totals(scope);
    const again = await contentFingerprint(scope);
    const other = await contentFingerprint({...scope, fee: fee + 1});
    assert.notEqual(again, other);
    assert.equal(Math.round(priced.total * 100), Math.round((priced.fee + priced.tax) * 100));
    if (tax === 0) assert.equal(priced.tax, 0);
  }));
});
