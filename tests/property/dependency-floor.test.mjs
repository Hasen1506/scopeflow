// Dependency floor (8 Oct 2026 audit, F1). Offline: reads the committed lockfile only.
// next < 16.3.8 is affected by GHSA-vcvr-r3jv-pc5j (critical, next/og RCE, < 16.3.6),
// GHSA-cjq9-62q9-8jv4 (high, Image Optimization SSRF, < 16.3.8) and the self-hosted
// SSG/ISR cache-poisoning advisories GHSA-4jqv-mc3x-m676 and GHSA-mcj8-r9mp-w47p.
// sharp < 0.35.5 carries a high libvips/librsvg advisory. `npm audit` is the live check;
// this test stops the lockfile from sliding back below the fixed versions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root = new URL('../../', import.meta.url);
const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const parse = (v) => v.split(/[.+-]/).slice(0, 3).map(Number);
const atLeast = (v, floor) => {
  const a = parse(v), b = parse(floor);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};
const installed = (name) => Object.entries(lock.packages)
  .filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`))
  .map(([path, meta]) => [path, meta.version]);

const FLOORS = {next: '16.3.8', sharp: '0.35.5', 'js-yaml': '4.3.2'};

for (const [name, floor] of Object.entries(FLOORS)) {
  test(`every locked copy of ${name} is at least ${floor}`, () => {
    const copies = installed(name);
    assert.ok(copies.length > 0, `${name} missing from package-lock.json`);
    for (const [path, version] of copies) assert.ok(atLeast(version, floor), `${path}@${version} < ${floor}`);
  });
}

test('next and eslint-config-next are pinned to the same patched release', () => {
  assert.ok(atLeast(pkg.dependencies.next, FLOORS.next), `package.json next ${pkg.dependencies.next}`);
  assert.equal(pkg.devDependencies['eslint-config-next'] ?? pkg.dependencies['eslint-config-next'], pkg.dependencies.next);
});
