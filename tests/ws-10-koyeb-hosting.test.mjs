// Koyeb deploy config and the GitHub Actions cron clocks. Pure, plus a loopback POST
// and `node scripts/cron.mjs --dry-run` (no database).
// Run by tests/run-local.mjs (tests/ws-*.mjs) and directly with `node --test`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {postHttp1} from '../scripts/post-http1.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

const groups = [
  {file: '.github/workflows/cron-retention.yml', cron: '30 20 * * *', jobs: 'retention heads housekeeping'},
  {file: '.github/workflows/cron-reminders.yml', cron: '30 3 * * *', jobs: 'reminders'},
  {file: '.github/workflows/cron-reconcile.yml', cron: '0 */6 * * *', jobs: 'reconcile'},
  {file: '.github/workflows/cron-check-models.yml', cron: '0 22 * * *', jobs: 'check-models analytics'},
];

function renderCrons(text) {
  return text.split(/\n(?=  - type: )/).slice(1).filter(block => /^  - type: cron/.test(block)).map(block => {
    const schedule = /^    schedule: "([^"]+)"/m.exec(block)[1];
    const start = /^    startCommand: (.+)$/m.exec(block)[1];
    return {schedule, start};
  });
}

// @covers H15 M31 OP-03
test('the four Actions workflows match render.yaml clocks and job lists', () => {
  const crons = renderCrons(read('render.yaml'));
  assert.equal(crons.length, 4);
  for (const group of groups) {
    const text = read(group.file);
    assert.match(text, new RegExp(`cron: "${group.cron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(text, new RegExp(`node scripts/cron\\.mjs ${group.jobs}\\n`));
    assert.match(text, /workflow_dispatch:/);
    assert.match(text, /cancel-in-progress:\s*false/);
    assert.match(text, /actions\/checkout@v5/);
    assert.match(text, /actions\/setup-node@v5/);
    assert.match(text, /ubuntu-24\.04/);
    assert.match(text, /node-version-file: \.node-version/);
    assert.match(text, /60 days/);
    assert.doesNotMatch(text, /run: node scripts\/cron\.mjs[^\n]*--dry-run/);
    assert.doesNotMatch(text, /postgres:\/\//);
    assert.match(text, /APP_URL: https:\/\/scope-flow\.tech/);
    assert.match(text, /secrets\.SCOPEFLOW_ERROR_WEBHOOK/);
    assert.match(text, /secrets\.DATABASE_URL/);
    const match = crons.find(cron => cron.schedule === group.cron);
    assert.ok(match, group.cron);
    assert.equal(match.start, `node scripts/cron.mjs ${group.jobs}`);
  }
  assert.doesNotMatch(read('.github/workflows/cron.yml'), /schedule:/);
  assert.match(read('.github/actions/cron-failure/action.yml'), /source:"scopeflow"/);
  assert.match(read('.github/actions/cron-failure/action.yml'), /id:\$id/);
  assert.match(read('.github/actions/cron-failure/action.yml'), /message:\$message/);
  assert.match(read('.github/actions/cron-failure/action.yml'), /at:\$at/);
  for (const file of ['.github/workflows/cron.yml', '.github/workflows/deploy-koyeb.yml', ...groups.map(group => group.file)]) {
    assert.doesNotMatch(read(file), /\/api\/health/, file);
  }
});

// @covers H15 OP-02 H16 L10
test('deploy workflow migrates before Koyeb, and the service spec is the free Frankfurt instance', () => {
  const deploy = read('.github/workflows/deploy-koyeb.yml');
  assert.match(deploy, /workflow_dispatch:/);
  assert.doesNotMatch(deploy, /^on:\s*\n(?:\s+push:|\s+schedule:)/m);
  assert.ok(deploy.indexOf('npm run db:migrate:deploy') < deploy.indexOf('koyeb services update'));
  assert.match(deploy, /DATABASE_MIGRATION_URL/);
  assert.match(deploy, /secrets\.KOYEB_TOKEN/);
  assert.match(deploy, /git-no-deploy-on-push/);
  assert.match(deploy, /git-builder docker/);
  const spec = read('scripts/koyeb-create.sh');
  for (const flag of [
    '--instance-type free',
    '--regions fra',
    '--git-builder docker',
    '--git-no-deploy-on-push',
    '--ports 8000:http',
    '--routes /:8000',
    '--checks 8000:http:/api/health',
    '--checks-grace-period 8000=180',
    '--env PORT=8000',
    '--env APP_URL=https://scope-flow.tech',
    '--env SCOPEFLOW_TRUSTED_PROXY=cloudflare',
    '--env SCOPEFLOW_TRUSTED_HOPS=1',
  ]) assert.ok(spec.includes(flag), flag);
  assert.doesNotMatch(spec, /postgres:\/\//);
  assert.doesNotMatch(spec, /--volumes/);
  const docker = read('Dockerfile');
  assert.match(docker, new RegExp('node:' + read('.node-version').trim() + '-bookworm-slim'));
  assert.match(docker, /npm run build:capped/);
  assert.match(docker, /npm prune --omit=dev/);
  assert.match(docker, /CMD \["npm", "start"\]/);
  assert.match(docker, /ARG NEXT_PUBLIC_SUPPORT_EMAIL=/);
  assert.doesNotMatch(docker, /db:migrate/);
  assert.match(read('render.yaml'), /preDeployCommand: npm run db:migrate:deploy/);
  assert.match(read('docs/DEPLOY-KOYEB.md'), /https:\/\/scope-flow\.tech/);
  assert.match(read('docs/DEPLOY-KOYEB.md'), /1–5 seconds/);
  assert.match(read('docs/DEPLOY-KOYEB.md'), /60 days/);
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

test('cron callbacks POST over HTTP/1.1 so a sleeping Koyeb instance can wake', async () => {
  const seen = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const version = req.httpVersion;
      req.resume();
      req.on('end', () => { res.writeHead(204); res.end(); server.close(() => resolve({version, method: req.method})); });
    });
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      postHttp1(`http://127.0.0.1:${port}/api/health`, {headers: {Authorization: 'Bearer test'}, timeoutMs: 5_000}).catch(reject);
    });
  });
  assert.equal(seen.method, 'POST');
  assert.equal(seen.version, '1.1');
  for (const file of ['scripts/cron-call.mjs', 'scripts/reconcile-payments.mjs', 'scripts/drain-notifications.mjs']) {
    const text = read(file);
    assert.match(text, /postHttp1/);
    assert.doesNotMatch(text, /\bfetch\(/);
  }
});
