// The four cron groups live in GitHub Actions, at the clocks Render used to run.
// Pure, plus `node scripts/cron.mjs --dry-run` (no database).
// Run by tests/run-local.mjs (tests/ws-*.mjs) and directly with `node --test`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

const groups = [
  {file: '.github/workflows/cron-retention.yml', cron: '30 20 * * *', jobs: 'retention heads housekeeping', render: 'scopeflow-retention'},
  {file: '.github/workflows/cron-reminders.yml', cron: '30 3 * * *', jobs: 'reminders', render: 'scopeflow-reminders'},
  {file: '.github/workflows/cron-reconcile.yml', cron: '0 */6 * * *', jobs: 'reconcile', render: 'scopeflow-reconcile'},
  {file: '.github/workflows/cron-check-models.yml', cron: '0 22 * * *', jobs: 'check-models analytics', render: 'scopeflow-check-models'},
];

// @covers H15 M31 OP-03
test('four Actions workflows keep the Render clocks, guards, and failure webhook', () => {
  const doc = read('docs/CRON-ACTIONS.md');
  assert.doesNotMatch(read('render.yaml'), /type: cron/);
  assert.equal(existsSync(new URL('../Dockerfile', import.meta.url)), false);
  assert.equal(existsSync(new URL('../.github/workflows/deploy-koyeb.yml', import.meta.url)), false);
  for (const group of groups) {
    const text = read(group.file);
    const cron = group.cron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(text, new RegExp(`cron: "${cron}"`));
    assert.match(text, new RegExp(`node scripts/cron\\.mjs ${group.jobs}\\n`));
    assert.match(text, /workflow_dispatch:/);
    assert.match(text, /cancel-in-progress:\s*false/);
    assert.match(text, /concurrency:/);
    assert.match(text, /actions\/checkout@v5/);
    assert.match(text, /actions\/setup-node@v5/);
    assert.match(text, /ubuntu-24\.04/);
    assert.match(text, /node-version-file: \.node-version/);
    assert.match(text, /60 days/);
    assert.match(text, /npm ci --omit=dev/);
    assert.match(text, /cache: npm/);
    assert.match(text, /timeout-minutes: 8/);
    assert.doesNotMatch(text, /run: node scripts\/cron\.mjs[^\n]*--dry-run/);
    assert.doesNotMatch(text, /postgres:\/\//);
    assert.match(text, /APP_URL: https:\/\/scope-flow\.tech/);
    assert.match(text, /secrets\.SCOPEFLOW_ERROR_WEBHOOK/);
    assert.match(text, /secrets\.DATABASE_URL/);
    assert.match(text, /secrets\.SCOPEFLOW_CRON_SECRET/);
    assert.match(text, /secrets\.SCOPEFLOW_ADMIN_TOKEN/);
    assert.match(doc, new RegExp(group.render));
    assert.match(doc, new RegExp(group.cron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(read('.github/workflows/cron-reconcile.yml'), /RESEND_API_KEY/);
  assert.match(read('.github/actions/cron-failure/action.yml'), /source:"scopeflow"/);
  assert.match(read('.github/actions/cron-failure/action.yml'), /id:\$id/);
  assert.match(read('.github/actions/cron-failure/action.yml'), /message:\$message/);
  assert.match(read('.github/actions/cron-failure/action.yml'), /at:\$at/);
  assert.match(doc, /60 days/);
  assert.match(doc, /scopeflow-retention/);
  assert.doesNotMatch(read('.github/workflows/cron.yml'), /schedule:/);
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /cancel-in-progress: true/);
  assert.match(ci, /cache: npm/);
  assert.match(ci, /actions\/cache@v4/);
  assert.match(ci, /ms-playwright/);
  assert.match(ci, /github\.base_ref }}\" = \"main\"/);
  assert.match(ci, /docs\//);
});

test('cron --dry-run lists the scheduled jobs and does not open a database', () => {
  const env = {...process.env, DATABASE_URL: ''};
  for (const group of groups) {
    const run = spawnSync(process.execPath, ['scripts/cron.mjs', '--dry-run', ...group.jobs.split(' ')], {encoding: 'utf8', env});
    assert.equal(run.status, 0, run.stderr);
    for (const job of group.jobs.split(' ')) assert.match(run.stdout, new RegExp(`"cron":"${job}"`));
    assert.match(run.stdout, /"dry_run":true/);
  }
  const unknown = spawnSync(process.execPath, ['scripts/cron.mjs', '--dry-run', 'not-a-job'], {encoding: 'utf8', env});
  assert.equal(unknown.status, 2);
  assert.match(read('scripts/send-reminders.mjs'), /--dry-run/);
});
