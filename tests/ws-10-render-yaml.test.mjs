// H15/H16/OP-01/OP-02/OP-03/L10: the deploy configuration (render.yaml, next.config.ts, CI). Pure: reads files.
// Run by tests/run-local.mjs (tests/ws-*.mjs) and directly with `node --test`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

/** Minimal reader for render.yaml's shape: a list of services with scalar fields and envVars entries. */
function services(text) {
  const blocks = text.split(/\n(?=  - type: )/).slice(1);
  return blocks.map(block => {
    const scalar = key => { const m = new RegExp(`^    ${key}:\\s*(.+?)\\s*(?:#.*)?$`, 'm').exec(block); return m ? m[1].replace(/^"(.*)"$/, '$1') : undefined; };
    const env = {};
    for (const m of block.matchAll(/^      - key: (\S+)\n((?:        .+\n?)*)/gm)) env[m[1]] = m[2];
    return {type: /^  - type: (\S+)/.exec(block)[1], name: scalar('name'), plan: scalar('plan'), buildCommand: scalar('buildCommand'), startCommand: scalar('startCommand'), preDeployCommand: scalar('preDeployCommand'), schedule: scalar('schedule'), env};
  });
}
const all = services(read('render.yaml'));
const web = all.find(s => s.type === 'web');
const crons = all.filter(s => s.type === 'cron');

// @covers H15 OP-02
test('web service: no migrations at boot, migrations once per deploy as the owner role, not on the free plan', () => {
  assert.ok(web, 'a web service');
  assert.doesNotMatch(web.startCommand, /db:migrate|migrate/, 'startCommand must not migrate');
  assert.equal(web.startCommand, 'npm start');
  assert.match(web.preDeployCommand ?? '', /db:migrate/, 'preDeployCommand runs the migrations');
  assert.notEqual(web.plan, 'free');
  assert.ok(web.plan, 'plan is explicit');
  assert.ok('DATABASE_MIGRATION_URL' in web.env, 'the owner role connection is configured for preDeploy');
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['db:migrate:deploy'], /migrate-deploy\.mjs/);
  assert.match(read('scripts/migrate-deploy.mjs'), /DATABASE_MIGRATION_URL/);
  assert.equal(pkg.scripts.start.includes('migrate'), false);
});

// @covers H15 M31 OP-03
test('four separate cron services, each through the recording cron runner', () => {
  assert.equal(crons.length, 4);
  const jobs = crons.map(c => c.startCommand);
  for (const job of ['retention', 'reminders', 'reconcile', 'check-models']) assert.ok(jobs.some(cmd => new RegExp(`^node scripts/cron\\.mjs\\b.*\\b${job}\\b`).test(cmd)), job);
  for (const c of crons) {
    assert.doesNotMatch(c.startCommand, /&&/, `${c.name}: no all-or-nothing chain`);
    assert.notEqual(c.plan, 'free');
    assert.match(c.schedule ?? '', /^\S+ \S+ \S+ \S+ \S+$/);
    for (const key of ['DATABASE_URL', 'APP_URL', 'SCOPEFLOW_CRON_SECRET']) assert.ok(key in c.env, `${c.name} has ${key}`);
  }
  // Reconcile does not depend on mail: its service runs nothing else and needs no mail settings.
  const reconcile = crons.find(c => /\breconcile\b/.test(c.startCommand));
  assert.equal(reconcile.startCommand, 'node scripts/cron.mjs reconcile');
  assert.ok(!('RESEND_API_KEY' in reconcile.env));
});

// @covers H16 OP-01
test('APP_URL is set in the dashboard, never hard-coded to the onrender host', () => {
  const text = read('render.yaml');
  assert.doesNotMatch(text, /value:\s*https?:\/\/[^\s]*onrender\.com/);
  assert.match(web.env.APP_URL, /sync:\s*false/);
  for (const c of crons) assert.match(c.env.APP_URL, /fromService/);
});

// @covers L10
test('build fits a small instance: no hard-coded cpus, capped heap in CI and on Render, dev deps only at build time', () => {
  const config = read('next.config.ts');
  assert.doesNotMatch(config, /cpus:\s*\d/);
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['build:capped'], /--max-old-space-size=460/);
  assert.match(web.buildCommand, /build:capped/);
  assert.match(web.buildCommand, /npm prune --omit=dev/);
  for (const c of crons) assert.match(c.buildCommand, /--omit=dev/);
  assert.match(read('.github/workflows/ci.yml'), /npm run build:capped/);
});
